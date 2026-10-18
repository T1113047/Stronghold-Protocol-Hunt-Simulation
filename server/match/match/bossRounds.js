// server/match/match/bossRounds.js — Match methods: the Final Assault / Hidden Core (the rules:
// server/match/finalAssault.js) — the boss fields and the shared pool; client-side boss fields (plausibility budgets on
// the field clock, cumulative credits, handovers, the boss clock, the end: pool 0 → victory, team LP 0 → defeat);
// b.pool; the merged team LP and its shares; the overtime drain; bounties after a boss field; then the next boss round
// of the chain (隐秘核心) or RESULT.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, GEO, TEAM_SIZE } from '../../../shared/constants.js';
import { createRng, deriveSeed } from '../../sim/rng.js';
import { creditedKillsOf } from '../../sim/spec.js';
import { buildBossWave, bountySpawns } from '../waves.js';
import { pairPlayers, bossPoolHp, SharedBossPool, CreditPool, hiddenEligible, BOSS_HIT_STEPS } from '../finalAssault.js';
import { bossTimeScore } from '../results.js';
import { FieldRunner, HeadlessPacer, syntheticResult, BOSS_SILENCE_MS, CATCHUP_TICKS_PER_INTERVAL } from '../fields.js';
import { FLOW_TICKER_PRIORITY, BOSS_CLOCK_MS, DELAYS } from './common.js';

/** b.pool broadcasts at most this often (ms). */
const POOL_MIN_GAP_MS = 250;
/**
 * Final Assault / Hidden Core under client-side combat: m.public (boss HP, team LP, field progress) at most this often
 * (ms) — b.pool (≤ 4 Hz) already carries the exact pool / team LP, so a boss b.progress never re-marks the whole
 * public state.
 */
const BOSS_PUBLIC_MS = 1000;
/** How long the match waits for a boss field's b.result after it forced the end (real ms, × timerScale). */
const BOSS_RESULT_GRACE_MS = 6000;
/**
 * Plausibility of a boss field's client reports (b.progress bossDmg / leaks, the b.result damage), on the SERVER's
 * field clock — so no single frame decides the Final Assault: the credited pool damage of one field stays ≤ the whole
 * pool per BOSS_MIN_CLEAR_GS game seconds (20 % of the pool per game second; the balance model's fastest mean kills
 * take ≈ 18–20 s at ≈ 5 %/s per field, docs/BALANCE.md §3), the credited LP cost ≤ BOSS_LP_BURST + BOSS_LP_PER_GS per
 * game second (a leader's "扣除所有目标生命" comes after ≥ 200 s). Reports are cumulative: what exceeds the budget is
 * credited later as the budget grows (the boss clock re-applies the latest report), never lost — a 'cleared' b.result
 * whose report covers the pool waits for it too (`heldResult`; 999-layer kills take 2–4 game s), it is not handed over.
 */
const BOSS_MIN_CLEAR_GS = 5;
const BOSS_LP_BURST = 10;
const BOSS_LP_PER_GS = 1;

export class MatchBoss {
  /**
   * The boss-round pairing: the pairs that share a boss field. Solo/coop: the whole roster pairs freely (pairPlayers).
   * 2V2 ('versus'): pairs form WITHIN a team only — an opponent never shares a field. `previous` pairs carry through
   * rounds per team. Consumes no shop / wave / draft randomness.
   * @param {any[]} alive
   * @returns {any[][]}
   */
  bossPairGroups(alive) {
    if (!this.isVersus) return pairPlayers(alive, createRng(deriveSeed(this.seed, 'boss-pairs')), this.bossPairs);
    const rng = createRng(deriveSeed(this.seed, 'boss-pairs'));
    const byTeam = new Map();
    for (const p of alive) {
      const t = this.teamIdOf(p);
      if (!byTeam.has(t)) byTeam.set(t, []);
      byTeam.get(t).push(p);
    }
    const prevByTeam = new Map();
    for (const ids of this.bossPairs || []) {
      const first = this.players.get(ids[0]);
      const t = first ? this.teamIdOf(first) : 0;
      if (!prevByTeam.has(t)) prevByTeam.set(t, []);
      prevByTeam.get(t).push(ids);
    }
    const groups = [];
    for (const t of [...byTeam.keys()].sort((a, b) => a - b)) groups.push(...pairPlayers(byTeam.get(t), rng, prevByTeam.get(t) || null));
    return groups;
  }

  /** The merged team LP a player's team holds (versus: per team; solo/coop: the scalar `teamLp`). */
  _teamLpOf(team) { return this.teamLps ? (this.teamLps.get(team) ?? 0) : this.teamLp; }

  /** The shared boss pool a field's team damages (versus: per team; solo/coop: the scalar `bossPool`). */
  _poolOf(team) { return this.bossPools ? this.bossPools.get(team) : this.bossPool; }

  /** Subtract `n` from a team's merged LP (versus: per team; solo/coop: the scalar). */
  _teamLpLossOf(team, n) {
    if (!Number.isFinite(n) || !(n > 0)) return;
    if (this.teamLps) this.teamLps.set(team, Math.max(0, (this.teamLps.get(team) ?? 0) - n));
    else if (this.teamLp != null) this.teamLp = Math.max(0, this.teamLp - n);
  }

  /** The boss-round ending ('cleared' | 'forced') of a team, or null (versus: per team; solo/coop: the scalar). */
  _endingOf(team) { return this._finalEndings ? (this._finalEndings.get(team) ?? null) : this._finalEnding; }

  /** The team ids of this match's boss fight (versus: every team; solo/coop: the single team 0). */
  _teamIds() { return this.teamLps ? [...this.teamLps.keys()] : [0]; }

  /**
   * The countdown a team had left when ITS boss run of `round` ended — the 2V2 settlement's 4:5 time rule (user
   * 2026-10-17). Recorded once per team and round (the first ending wins: a cleared / LP-drained field is detected at
   * its own moment, long before the other team finishes), and never reset by the next round: `bossTeamTimes[round][team]`
   * = { remain, limit, elapsed } in the countdown's own REAL seconds. `elapsedGt` (game seconds) is the field's own
   * duration when the caller has it (a server-run battle's result); otherwise the team's field clock is read.
   * @param {number} team @param {number} round @param {number} [elapsedGt]
   */
  _noteBossTime(team, round, elapsedGt = null) {
    if (!this.isVersus || team == null) return;
    const limit = this.gd.bossLevelTime(round);
    if (!(limit > 0)) return;
    const scale = this.gd.combatTimeScale;
    const limitGt = limit * scale;
    let gt = Number.isFinite(elapsedGt) ? elapsedGt : null;
    if (gt == null) {
      const f = Array.isArray(this.fields) ? this.fields.find((x) => x && x.team === team) : null;
      gt = f ? this._fieldElapsed(f)
        : ((this.sched.now() - (this._bossStartAt ?? this.sched.now())) / 1000) * this.gameSpeed;
    }
    gt = Math.max(0, Math.min(limitGt, Number(gt) || 0));
    if (!this.bossTeamTimes) this.bossTeamTimes = {};
    if (!this.bossTeamTimes[round]) this.bossTeamTimes[round] = {};
    if (this.bossTeamTimes[round][team]) return;
    const remain = Math.max(0, Math.min(limit, (limitGt - gt) / scale));
    this.bossTeamTimes[round][team] = {
      remain: Math.round(remain * 1000) / 1000,
      limit,
      elapsed: Math.round((limit - remain) * 1000) / 1000,
    };
  }

  /**
   * One team's 4:5 boss-time record for the settlement: `time.r14` / `time.r15` = { remain, limit, reached } (0 left
   * for a round the team never fought), their weighted score and share (results.js bossTimeScore).
   * @param {number} team
   */
  _teamTimeOf(team) {
    const time = {};
    const add = (key, round) => {
      if (round == null) return;
      const limit = this.gd.bossLevelTime(round) || 0;
      const rec = this.bossTeamTimes && this.bossTeamTimes[round] ? this.bossTeamTimes[round][team] : null;
      const remain = rec && Number.isFinite(rec.remain) ? Math.max(0, Math.min(rec.remain, limit)) : 0;
      time[key] = { remain, limit, reached: !!rec };
    };
    add('r14', this.gd.bossRound);
    add('r15', this.gd.hiddenRound);
    return { time, ...bossTimeScore(time) };
  }

  /** Whether `r` is a boss round of the chain (最终攻势 / 隐秘核心). */
  isBossRound(r) {
    return r === this.gd.bossRound || r === this.gd.hiddenRound;
  }

  /** The boss id fought in boss round `r`. */
  bossIdOfRound(r) { return r === this.gd.bossRound ? this.bossId : this.hiddenBossId; }

  startFinalAssault(hidden) {
    const alive = this.alivePlayers();
    if (!alive.length) { this.finish({ victory: false, reason: 'eliminated' }); return; }
    this.phase = hidden ? PHASE.HIDDEN_CORE : PHASE.FINAL_ASSAULT;
    this.lastResults = new Map();
    if (!hidden) this._openTeamLp();
    const bossId = hidden ? this.hiddenBossId : this.bossId;
    // BOSS_HIT tickers ("对敌方领袖造成的伤害超过20% / 50% / 80%"): the player's damage to THIS leader over its pool —
    // the pool's own per-player tally, one pool per boss round (2V2: one pool per team). stats.bossDamage (the result's
    // 领袖伤害) adds up both rounds, so it would credit the Final Assault's damage to the hidden leader.
    const hitSteps = new Map();
    const makePool = (count) => {
      const p = new SharedBossPool(bossPoolHp(this.gd, bossId, count), {});
      p.onHit = (pid, dmg) => {
        const ps = this.players.get(pid);
        if (!ps) return;
        ps.stats.bossDamage += dmg;
        const share = (p.byPlayer.get(pid) || 0) / p.maxHp;
        const done = hitSteps.get(pid) || 0;
        let reached = done;
        BOSS_HIT_STEPS.forEach((s, i) => { if (share >= s) reached = Math.max(reached, i + 1); });
        if (reached > done) {
          hitSteps.set(pid, reached);
          this.tickerFor('BOSS_HIT', [ps.name], { playerId: pid, param: String(BOSS_HIT_STEPS[reached - 1]) });
        }
      };
      return p;
    };
    if (this.isVersus) {
      // 2V2: each team fights its own leader on its own pool (design 2026-10-16: 各打各的 Boss).
      this.bossPools = new Map();
      const byTeam = new Map();
      for (const ps of alive) { const t = this.teamIdOf(ps); if (!byTeam.has(t)) byTeam.set(t, []); byTeam.get(t).push(ps); }
      for (const [t, members] of byTeam) this.bossPools.set(t, makePool(members.length));
      this.bossPool = null;
      this._finalEndings = new Map();
      this._finalEnding = null;
    } else {
      this.bossPools = null;
      this.bossPool = makePool(alive.length);
      this._finalEndings = null;
      this._finalEnding = null;
    }
    const groups = this.bossPairGroups(alive);
    this.bossPairs = groups.map(g => g.map(p => p.playerId));
    const reuse = this.bossWaves && this.bossWaves.length === groups.length && this.bossWaves.every((w, i) => w.players.join() === groups[i].map((p) => p.playerId).join());
    this.fields = groups.map((g, i) => {
      const solo = this.isSolo || g.length === 1;
      const team = this.teamIdOf(g[0]);
      const wave = reuse ? this.bossWaves[i].wave : buildBossWave(this.gd, this.rngWaves, this.factions, this.round, { bossId, solo });
      // one spawn list per field, shared by the field's players' onBattleStart handlers (edit it in place)
      const spawns = wave.spawns.map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
      // bounties with battles left (a multi-round card lasts MULTI_ROUND_BOUNTY_BATTLES) follow their player into the
      // boss field, on the player's half
      g.forEach((ps, j) => {
        for (const b of bountySpawns(this.gd, this.round, wave, ps.bounties, ps.playerId, { solo: this.isSolo, side: j === 0 ? 'L' : 'R' })) spawns.push(b);
      });
      const inputs = g.map((ps, j) => {
        const input = ps.battleInput({ side: j === 0 ? 'L' : 'R', colOffset: j === 0 ? 0 : 8 });
        input.lpForBoss = this._teamLpOf(team);
        // `side` + `routes`: the player's half of a pair field (spawn-list edits for one player, e.g. 鸭爵's swap)
        const ev = { input, kind: hidden ? 'hidden' : 'boss', round: this.round, spawns, routes: wave.routes, side: g.length > 1 ? (j === 0 ? 'L' : 'R') : null };
        this.dispatch(ps, 'onBattleStart', ev);
        return ev.input && typeof ev.input === 'object' ? ev.input : input;
      });
      const fieldId = `b${i + 1}`;
      const bopts = {
        seed: deriveSeed(this.seed, `${fieldId}:${this.round}`),
        kind: hidden ? 'hidden' : 'boss',
        modeId: this.modeId,
        round: this.round,
        stageId: this.stageId,
        rect: { ...GEO.BOSS_RECT },
        timeLimit: Infinity,
        players: inputs,
        spawns: this._sanitizeSpawns(spawns),
        routes: wave.routes,
        sharedBoss: this._poolOf(team),
        // the round's enemy effects for the leaders' mid-fight summons (server/sim/content/bosses.js summonMods)
        flags: { layerGainsEnabled: false, ...this.gd.dp, enemyScale: this.gd.enemyScale(this.round) },
        fieldId,
        enemyOverrides: wave.overrides,
        waveId: wave.templateId,
        bossId,
      };
      if (this.clientCombat) return { fieldId, team, kind: hidden ? 'hidden' : 'boss', players: g.map((p) => p.playerId), opts: bopts, battle: null, live: true };
      const battle = this.newBattle(bopts);
      try {
        battle.on('enemyLeak', (ctx) => this._bossLeak(ctx && ctx.enemy, team), { priority: -1000, owner: 'match' });
        // leader "扣除目标生命" effects (boss_7 Doom, 斥退 …: server/sim/content/bosses.js lpLoss) hit the team pool
        battle.on('lpLoss', (ctx) => this._teamLpLoss(team, ctx && ctx.amount), { priority: -1000, owner: 'match' });
      } catch (e) { this.reportError('boss leak hook', e); }
      return { fieldId, team, kind: hidden ? 'hidden' : 'boss', players: g.map((p) => p.playerId), battle, live: true };
    });
    this.overtimeApplied = 0;
    this._bossStartAt = this.sched.now();
    // HUD: the boss level's countdown (maxPlayTime, 120 real s — the battle goes on past it) and the moment the
    // overtime drain starts (150 real s), both on the field clock
    const onClock = (realS) => this.sched.now() + Math.round(((realS * this.gd.combatTimeScale) / this.gameSpeed) * 1000);
    const levelTime = this.gd.bossLevelTime(this.round);
    // Maintainer 2026-10-10: only teams with an AI teammate keep the extra grace after the visible countdown.
    // Freeze this choice for the fight; a disconnect / host transfer cannot change its LP clock midway.
    const team = this.order.filter((p) => !p.left);
    this.bossOvertimeStartReal = team.length > 1 && team.some((p) => p.isBot)
      ? this.gd.bossOvertimeAfterReal : (levelTime || this.gd.bossOvertimeAfterReal);
    this.deadline = this.sched.instant || !levelTime ? 0 : onClock(levelTime);
    this.overtimeAt = this.sched.instant ? 0 : onClock(this.bossOvertimeStartReal);
    if (this.clientCombat) { this._startFinalClient(hidden); return; }
    this._defaultWatch();
    this.markPublic();
    this.runner = new FieldRunner(this, this.fields, {
      onTick: (runner) => this._bossTick(runner),
      onDone: (runner) => this._finalDone(runner, hidden),
    });
    this.runner.start();
  }

  /**
   * Merged team LP at the moment a Final Assault first opens. The Hidden Core keeps whatever is left;
   * it does not call this again. A test jump straight into the hidden round calls it once when the
   * assault that would have opened the pool was skipped. [ASSUMED] that sum is the alive players'
   * current LP, not a leftover after a fight that did not happen.
   * 2V2: each team merges its own LP (`teamLps`); the scalar `teamLp` stays the sum, for the existing readers of
   * m.public.teamLp / the results. Solo/coop: the single pool, as before.
   */
  _openTeamLp() {
    const alive = this.alivePlayers();
    for (const ps of alive) ps.lpAtFinal = Math.max(0, ps.lp);
    if (this.isVersus) {
      this.teamLps = new Map();
      for (const ps of alive) {
        const t = this.teamIdOf(ps);
        this.teamLps.set(t, (this.teamLps.get(t) || 0) + Math.max(0, ps.lp));
      }
      this.teamLp = [...this.teamLps.values()].reduce((s, v) => s + v, 0);
    } else {
      this.teamLps = null;
      this.teamLp = alive.reduce((s, p) => s + Math.max(0, p.lp), 0);
    }
  }

  _startFinalClient(hidden) {
    const recs = this.fields.map((x) => {
      const pool = this._poolOf(x.team);
      const rec = this._ccField({ fieldId: x.fieldId, kind: x.kind, players: x.players, opts: x.opts, boss: { poolHp: pool.hp, poolMax: pool.maxHp } });
      rec.team = x.team;
      return rec;
    });
    this._finalEnding = null;
    this._bossStartAt = this.sched.now();
    this.watchers.clear();
    if (!recs.some((f) => this._authorityFor(f))) {
      // nobody to simulate on a client: the server runs every boss field (FieldRunner, no streaming)
      this.fields = recs;
      for (const f of recs) {
        f.mode = 'server';
        // a CreditPool with nothing acknowledged credits everything; it counts this field's damage for b.pool `acked`
        const pool = this._poolOf(f.team);
        f.credit = new CreditPool(pool);
        f.battle = this._specBattle(f.spec, { sharedBoss: f.credit });
        try {
          f.battle.on('enemyLeak', (ctx) => this._bossLeak(ctx && ctx.enemy, f.team), { priority: -1000, owner: 'match' });
          f.battle.on('lpLoss', (ctx) => this._teamLpLoss(f.team, ctx && ctx.amount), { priority: -1000, owner: 'match' });
        } catch (e) { this.reportError('boss leak hook', e); }
      }
      this._watchBossFields(recs);
      this.markPublic();
      this.runner = new FieldRunner(this, recs, {
        onTick: (runner) => this._bossTick(runner),
        onDone: (runner) => this._finalDone(runner, hidden),
        emit: false,
      });
      this.runner.start();
      return;
    }
    this._launch(recs);
    this._watchBossFields(recs);
    this.markPublic();
    this._broadcastPool(true);
    this._bossClockOn = true;
    this._bossClock = this.later(BOSS_CLOCK_MS, () => this._bossClockTick());
  }

  /** The most shared-pool damage a boss field's client reports may have credited by now (server field clock). */
  _bossDmgBudget(f) {
    const pool = this._poolOf(f.team);
    return pool ? (pool.maxHp * this._fieldElapsed(f)) / BOSS_MIN_CLEAR_GS : 0;
  }

  /** The most team LP a boss field's client reports may have cost by now (server field clock). */
  _bossLpBudget(f) {
    return BOSS_LP_BURST + BOSS_LP_PER_GS * this._fieldElapsed(f);
  }

  /**
   * A boss field's shared-pool damage, as reported cumulatively by its client (`by`: per player) — credited up to the
   * plausibility budget of the field clock; the rest is credited by later reports / the boss clock (`bossReported`).
   */
  _creditBoss(f, cum, by) {
    const pool = this._poolOf(f.team);
    const reported = Number(cum);
    // the team LP ran out first: the run failed at that moment (PRTS "…使目标生命值扣除至0，则无视倒计时直接失败"), so
    // damage reported afterwards — in flight, or rounded up in the final b.result — changes nothing (user playtest #6)
    if (!pool || !Number.isFinite(reported) || this._endingOf(f.team) === 'forced') return;
    if (!f.bossReported || reported > f.bossReported.cum) f.bossReported = { cum: reported, by: by && typeof by === 'object' ? { ...by } : null };
    const c = Math.min(reported, this._bossDmgBudget(f));
    if (!(c > f.bossAcked)) return;
    const delta = c - f.bossAcked;
    f.bossAcked = c;
    let attributed = 0;
    if (by && typeof by === 'object') {
      for (const pid of f.players) {
        const v = Number(by[pid]);
        const prev = f.bossBy[pid] || 0;
        if (!Number.isFinite(v) || v <= prev) continue;
        const d = Math.min(delta - attributed, v - prev);
        if (d > 0) { f.bossBy[pid] = prev + d; pool.damage(pid, d); attributed += d; }
      }
    }
    if (delta - attributed > 0) {
      const pid = by ? null : f.players[0];
      if (pid) f.bossBy[pid] = (f.bossBy[pid] || 0) + (delta - attributed);
      pool.damage(pid, delta - attributed);
    }
  }

  /** A boss field's LP cost (leaks × lpr + leader LP effects): `cumulative` totals from its client, deltas from the server run. */
  _creditLp(f, amount, cumulative = false) {
    let n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    if (cumulative) {
      // a client's cumulative report: credited up to the field clock's plausibility budget (the rest later)
      if (n > f.lpReported) f.lpReported = n;
      n = Math.min(n, this._bossLpBudget(f));
      if (n <= f.lpAcked) return;
      const d = n - f.lpAcked;
      f.lpAcked = n;
      this._teamLpLoss(f.team, d);
      return;
    }
    const before = f.lpCum;
    f.lpCum += n;
    const credit = Math.max(0, f.lpCum - Math.max(before, f.lpAcked));
    if (credit > 0) this._teamLpLoss(f.team, credit);
  }

  /**
   * The authority's per-player split of the LP its field's enemy leaks cost (b.progress `leaksBy`: cumulative, per player,
   * the leader's own LP effects not in it) — the highest value seen per player. The field's perfect-payout bounties are
   * paid only where the final result agrees with it (`_bossLeaksAgree`).
   */
  _noteLeaksBy(f, by) {
    if (!by || typeof by !== 'object') return;
    if (!f.leaksBy) f.leaksBy = {};
    for (const pid of f.players) {
      const v = Number(by[pid]);
      if (Number.isFinite(v) && v > (f.leaksBy[pid] || 0)) f.leaksBy[pid] = v;
    }
  }

  /**
   * Whether a boss field's b.result may be believed about one player's leaks before a perfect-payout bounty pays: the
   * result comes from a client (a server run is the truth itself) and does not contradict what that client reported while
   * it fought — LP it asked the team to pay must have been split into the players' own leaks and the leader's effects
   * (b.progress `leaksBy`; reports without the split explain nothing), and the player's leaked list must show at least the
   * leak LP reported for it (a leak is never moved to the other seat or dropped). A modified authority can still lie in
   * both; what the server cannot see it cannot check (the boss path never re-simulates).
   */
  _bossLeaksAgree(f, res, pid) {
    if (!f.cc || f.resultSource !== 'client') return true;
    if (f.lpReported > 1e-9 && !f.leaksBy) return false;
    const shown = ((res.perPlayer[pid] && res.perPlayer[pid].leaked) || []).reduce((n, l) => n + (Number.isFinite(l.lpr) && l.lpr >= 0 ? l.lpr : 1), 0);
    return shown + 1e-6 >= ((f.leaksBy && f.leaksBy[pid]) || 0);
  }

  /** The server runs a boss field in real time (no client left): credits only what exceeds the client's reports. */
  _bossServerRun(f) {
    const credit = new CreditPool(this._poolOf(f.team), { acked: f.bossAcked, ackedBy: f.bossBy });
    const battle = this._specBattle(f.spec, { sharedBoss: credit });
    f.battle = battle;
    f.credit = credit;
    f.lpCum = 0;
    try {
      battle.on('enemyLeak', (ctx) => { const e = ctx && ctx.enemy; if (e) this._creditLp(f, Number.isFinite(e.lpr) && e.lpr >= 0 ? e.lpr : 1); }, { priority: -1000, owner: 'match' });
      battle.on('lpLoss', (ctx) => this._creditLp(f, ctx && ctx.amount), { priority: -1000, owner: 'match' });
    } catch (e) { this.reportError('boss leak hook', e); }
    if (!this.pacer) this.pacer = new HeadlessPacer(this);
    const entry = this.pacer.add({
      battle,
      onDone: () => {
        if (f.done) return;
        let res = null;
        try { res = battle.result(); } catch (e) { this.reportError('boss result', e); }
        f.result = res && res.perPlayer ? res : syntheticResult(f.players, { bossBy: f.bossBy });
        f.resultSource = 'server';
        this._fieldDone(f);
        this._checkFinalEnd();
      },
      onTick: () => this._checkFinalEnd(),
    });
    const gt = this._fieldElapsed(f);
    // the fast-forward to the field clock is spread over the pacing intervals on a real host (virtual time: at once)
    if (gt > 0 && !entry.done) this.pacer.skipTo(entry, gt, { budgetTicks: this.sched.virtual ? Infinity : CATCHUP_TICKS_PER_INTERVAL });
  }

  /**
   * A boss field's authority left, went silent or sent an implausible result (`demote`: never its authority again):
   * its partner (a replica already running) takes over, else the server.
   */
  _bossHandover(f, why, { demote = false } = {}) {
    if (f.done || f.mode !== 'client' || f.heldResult) return; // a held 'cleared' result is in: nothing left to run
    const prev = f.authority;
    if (demote && prev) f.demoted.add(prev);
    const next = this._authorityFor(f, prev);
    if (next) {
      f.authority = next;
      f.lastProgressAt = this.sched.now();
      if (prev) this.sendTo(prev, { t: 'b.end', battleId: f.battleId, fieldId: f.fieldId, reason: 'takeover' });
      this._sendStart(next, f);
      return;
    }
    this._runOnServer(f, why);
  }

  _bossClockTick() {
    this._bossClock = null;
    if (this.phase !== PHASE.FINAL_ASSAULT && this.phase !== PHASE.HIDDEN_CORE) return;
    if (this.paused) return; // re-armed by _resume
    const now = this.sched.now();
    this._applyOvertime(((now - this._bossStartAt) / 1000) * this.gameSpeed);
    for (const f of this.fields) {
      // reports held back by the plausibility budget are credited as the field clock advances
      if (f.cc && !f.done && f.mode === 'client') {
        if (f.bossReported && f.bossReported.cum > f.bossAcked) this._creditBoss(f, f.bossReported.cum, f.bossReported.by);
        if (f.lpReported > f.lpAcked) this._creditLp(f, f.lpReported, true);
      }
      if (f.cc && !f.done && f.mode === 'client' && !f.heldResult && now - f.lastProgressAt > BOSS_SILENCE_MS) {
        this.log.info?.(`[match ${this.roomCode}] ${f.fieldId}: no progress from ${f.authority} — handing the field over`);
        this._bossHandover(f, 'silent');
      }
    }
    this._checkFinalEnd();
    this._broadcastPool(false);
    if (this.fields.some((f) => f.cc && !f.done)) this._bossClock = this.later(BOSS_CLOCK_MS, () => this._bossClockTick());
    else this._bossClockOn = false;
  }

  /** Pool depleted → victory; team LP 0 → defeat. 2V2: per team; the fight ends once every team has one. */
  _checkFinalEnd() {
    if (this.phase !== PHASE.FINAL_ASSAULT && this.phase !== PHASE.HIDDEN_CORE) return;
    if (!this.fields.some((f) => f.cc)) return;
    if (this.isVersus && this._finalEndings) {
      for (const t of this._teamIds()) {
        if (this._finalEndings.has(t)) continue;
        const pool = this._poolOf(t);
        // the moment a team's run ends is also its remaining countdown (the settlement's 4:5 time rule)
        if (pool && pool.hp <= 0) { this._finalEndings.set(t, 'cleared'); this._noteBossTime(t, this.round); }
        else if (this._teamLpOf(t) <= 0) { this._finalEndings.set(t, 'forced'); this._noteBossTime(t, this.round); }
      }
      if (this._teamIds().every((t) => this._finalEndings.has(t))) this._endFinal();
      return;
    }
    if (this._finalEnding) return;
    const pool = this._poolOf(0);
    if (!pool) return;
    if (pool.hp <= 0) this._endFinal('cleared');
    else if (this._teamLpOf(0) != null && this._teamLpOf(0) <= 0) this._endFinal('forced');
  }

  _endFinal(reason) {
    if (this.isVersus) {
      // 2V2: _checkFinalEnd records each team's ending and calls _endFinal() once every team has one.
      if (this._teamIds().some((t) => !this._finalEndings.has(t))) return;
      if (this._finalEnding) return;
      this._finalEnding = 'done'; // sentinel: the boss fight is over, credit nothing further
    } else {
      if (this._finalEnding) return;
      this._finalEnding = reason;
    }
    this._broadcastPool(true);
    for (const f of this.fields) {
      if (!f.cc || f.done) continue;
      const fReason = this.isVersus ? (this._finalEndings.get(f.team) || 'forced') : reason;
      if (f.mode === 'server' && f.battle) {
        try { f.battle.forceEnd(fReason); } catch (e) { this.reportError('boss forceEnd', e); }
        let res = null;
        try { res = f.battle.result(); } catch (e) { this.reportError('boss result', e); }
        f.result = res && res.perPlayer ? res : syntheticResult(f.players, { bossBy: f.bossBy });
        f.resultSource = 'server';
        continue; // _fieldDone below (after every field was told)
      }
      for (const pid of this._humansShowing(f)) this.sendTo(pid, { t: 'b.end', battleId: f.battleId, fieldId: f.fieldId, reason: fReason });
      if (f.heldResult) {
        // its authority already reported 'cleared' (_onResult): that result completes the field
        f.result = f.heldResult;
        this._bossResultDamage(f, f.result);
        f.resultSource = 'client';
        continue; // _fieldDone below
      }
      f.waitTimer = this.later(this.scaled(BOSS_RESULT_GRACE_MS), () => {
        f.waitTimer = null;
        if (f.done) return;
        f.result = syntheticResult(f.players, { bossBy: f.bossBy, time: this._fieldElapsed(f) });
        this._fieldDone(f);
      });
    }
    if (this.pacer) { this.pacer.stop(); this.pacer = null; }
    for (const f of this.fields) if (f.cc && !f.done && (f.mode === 'server' || f.heldResult)) this._fieldDone(f);
  }

  /** b.pool { hp, max, teamLp, acked } to everyone (≤ 4 Hz; `force` skips the dedupe, never the rate). 2V2: `pools`. */
  _broadcastPool(force) {
    if (this.disposed || (!this.isVersus && !this.bossPool)) return;
    const now = this.sched.now();
    if (now - this._lastPoolAt < POOL_MIN_GAP_MS) {
      if (!this._poolTimer) {
        this._poolTimer = this.later(Math.max(1, POOL_MIN_GAP_MS - (now - this._lastPoolAt)), () => { this._poolTimer = null; this._broadcastPool(force); });
      }
      return;
    }
    // exact numbers: a client shows `hp − (its cumulative damage − acked)` and ends its battle as 'cleared' when that
    // reaches 0 — rounded values could show 0 while the server's pool still holds a fraction of a point
    // a server-run field (no client left, or none at all): what its battle has put into the pool so far — a display
    // replica (a reconnecting / watching human) subtracts only its local damage beyond that from the server hp
    const acked = {};
    for (const f of this.fields) if (f.cc) acked[f.fieldId] = f.mode === 'server' && f.credit ? Math.max(f.bossAcked, f.credit.cum) : f.bossAcked;
    const msg = { t: 'b.pool', acked };
    if (this.isVersus) {
      // 2V2: one entry per team; the per-team view the client shows (the scalar hp/max/teamLp are null)
      msg.hp = null; msg.max = null; msg.teamLp = null; msg.pools = {};
      for (const t of this._teamIds()) {
        const pool = this._poolOf(t);
        msg.pools[t] = { hp: Math.max(0, pool.hp), max: pool.maxHp, teamLp: Math.max(0, Math.round(this._teamLpOf(t))) };
      }
    } else {
      msg.hp = Math.max(0, this.bossPool.hp);
      msg.max = this.bossPool.maxHp;
      msg.teamLp = this.teamLp == null ? null : Math.max(0, Math.round(this.teamLp));
    }
    const key = JSON.stringify(msg);
    if (!force && key === this._lastPoolKey) return;
    this._lastPoolKey = key;
    this._lastPoolAt = now;
    this.broadcast(msg);
  }

  /**
   * Bounties after a boss field: kill-bounty coins and — when `perfect` — the coins of every perfect-payout bounty (a
   * 战术特训 card: PRTS "若各自行动阶段就达成完美作战，获得N资金", the same sum SETTLE pays after a normal battle) go to
   * pending funds (spent in the Hidden Core's prep), and every bounty used one of its battles, exactly like SETTLE does
   * for normal rounds.
   * @param {boolean} perfect the player's own field was perfect and the team won (`_finishFinal`)
   */
  _settleBossBounties(ps, pp, perfect) {
    let coins = Math.max(0, Math.trunc(Number(pp.coins) || 0));
    if (perfect) for (const b of ps.bounties) if (b.card.payout === 'perfect') coins += b.card.coin;
    if (coins > 0) { ps.pendingFunds += coins; ps.stats.fundsGained += coins; }
    if (!ps.bounties.length) return;
    for (const b of ps.bounties) b.roundsLeft--;
    ps.bounties = ps.bounties.filter((b) => b.roundsLeft > 0);
    ps.dirty();
  }

  _bossLeak(enemy, team = 0) {
    const lp = this._teamLpOf(team);
    if (!enemy || lp == null) return;
    // lifePointReduce from data: 0 for harmless enemies (e.g. 装置 / unharmful escorts), 1 when absent
    const lpr = Number.isFinite(enemy.lpr) && enemy.lpr >= 0 ? enemy.lpr : 1;
    this._teamLpLoss(team, lpr);
  }

  _teamLpLoss(team, amount) {
    // upstream contract: _teamLpLoss(n) — solo/coop's single pool; the 2V2 callers pass (team, n)
    if (amount === undefined) { amount = team; team = 0; }
    const n = Number(amount);
    if (this._teamLpOf(team) == null || !Number.isFinite(n) || !(n > 0)) return;
    this._teamLpLossOf(team, n);
    if (this._bossLazyPublic()) { this._bossPublic(); return; }
    this._syncTeamLp();
    this.markPublic();
  }

  /** Boss rounds under client-side combat: m.public / the per-player LP shares refresh at ~1 Hz (b.pool is live). */
  _bossLazyPublic() {
    return this.clientCombat && (this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE) && this.fields.some((f) => f.cc);
  }

  /** Throttled (BOSS_PUBLIC_MS) refresh of m.public and the players' LP shares during a boss round. */
  _bossPublic() {
    if (this._bossPubTimer || this.disposed || this.ended) return;
    const wait = Math.max(0, BOSS_PUBLIC_MS - (this.sched.now() - this._bossPubAt));
    this._bossPubTimer = this.later(wait, () => {
      this._bossPubTimer = null;
      this._bossPubAt = this.sched.now();
      this._syncTeamLp();
      this.markPublic();
    });
  }

  /**
   * The merged team LP (Final Assault / Hidden Core, research 01 §9) written back to the alive players as shares of
   * what each brought in (`lpAtFinal`, largest remainder, ties → seat), so m.public / m.private / m.result never show
   * the pre-merge LP of a team that lost LP in the boss fight (Σ alive lp = round(teamLp)). 2V2: per team.
   */
  _syncTeamLp() {
    for (const t of this._teamIds()) this._syncTeamLpOf(t);
  }

  _syncTeamLpOf(team) {
    const teamLp = this._teamLpOf(team);
    if (teamLp == null) return;
    // Weight: the LP the player brought into the merge (the Final Assault sets lpAtFinal); before that — 2V2 shares its
    // pool from round 1 on — the 策略 HP it started the match with. Σ of the shares stays the pool either way.
    const weightOf = (p) => Math.max(0, p.lpAtFinal ?? this.gd.startLp(p.bandId));
    const alive = this.alivePlayers().filter((p) => this.teamIdOf(p) === team);
    if (!alive.length) return;
    const total = Math.max(0, Math.round(teamLp));
    const base = alive.reduce((s, p) => s + weightOf(p), 0);
    const rows = alive.map((p) => {
      const v = base > 0 ? (total * weightOf(p)) / base : total / alive.length;
      const n = Math.floor(v + 1e-9);
      return { p, n, frac: v - n };
    });
    let left = total - rows.reduce((s, x) => s + x.n, 0);
    for (const x of rows.slice().sort((a, b) => b.frac - a.frac || a.p.seat - b.p.seat)) {
      if (left <= 0) break;
      x.n++;
      left--;
    }
    for (const x of rows) if (x.p.lp !== x.n) { x.p.lp = x.n; x.p.dirty(); }
  }

  /**
   * Overtime drain on the boss field clock (`gt` game seconds): 1 team LP per real second from the 150 real-second mark
   * (bossTurnHpReduceTime, gamedata.js bossOvertimeDue). 2V2: each team pays its own drain.
   */
  _applyOvertime(gt) {
    const due = this.gd.bossOvertimeDue(gt, this.bossOvertimeStartReal);
    if (!(due > this.overtimeApplied)) return;
    const loss = due - this.overtimeApplied;
    this.overtimeApplied = due;
    for (const t of this._teamIds()) this._teamLpLoss(t, loss);
  }

  _bossTick(runner) {
    this._applyOvertime(runner.time);
    // 2V2: force only a team whose LP ran out while its boss still stands (the other team keeps fighting)
    for (const f of runner.fields) {
      const team = f.team ?? 0;
      const pool = this._poolOf(team);
      if (pool && pool.hp > 0 && this._teamLpOf(team) <= 0) runner.forceField(f, 'forced');
    }
    // client-side combat with every boss field on the server: humans that reconnect / watch run display replicas
    // whose LocalBossPool follows b.pool
    if (this.fields.some((f) => f.cc)) { this._broadcastPool(false); this._bossPublic(); }
    else if (runner.ticks % 6 === 0) this.markPublic();
    if (runner.ticks % 30 === 0) this.flush();
  }

  _finalDone(runner, hidden) { this._finishFinal(hidden, (f) => runner.resultOf(f)); }

  /**
   * 2V2 final scoring (design 2026-10-16): first compare each team's boss damage as a share of its OWN pool, then the
   * converted time (remaining seconds + remaining LP × 2s). `remainingTime` is the boss countdown remaining on the
   * shared field clock (both teams fight on it, so it is the same for both).
   */
  _versusDecide() {
    const entries = this._teamIds().map((t) => {
      const pool = this._poolOf(t);
      const maxHp = pool ? pool.maxHp : 1;
      const dealt = pool ? Math.max(0, maxHp - pool.hp) : 0;
      const bossPct = dealt / maxHp;
      const lp = Math.max(0, Math.round(this._teamLpOf(t)));
      const elapsed = this._bossStartAt != null ? Math.max(0, (this.sched.now() - this._bossStartAt) / 1000) : 0;
      const remainingTime = Math.max(0, (this.gd.bossLevelTime(this.round) || 0) - elapsed);
      const score = lp * 2 + remainingTime;
      // the 4:5 boss-time record of this team (_noteBossTime / bossTimeScore): R14 (最终攻势) counts 4 and R15
      // (隐秘核心) counts 5, as SHARES of each round's own countdown — a round the team never reached counts 0
      const time = this._teamTimeOf(t);
      return { t, bossPct, score, lp, remainingTime, time };
    });
    // User 2026-10-17 (the settlement's own rule): the 4:5 weighted remaining time decides FIRST, the shared LP pool
    // second, and only then the leader scoring of the original _versusDecide (damage share, then converted time).
    entries.sort((a, b) => (b.time.score - a.time.score) || (b.lp - a.lp) || (b.bossPct - a.bossPct) || (b.score - a.score));
    const near = (x, y) => Math.abs(x - y) <= 1e-9;
    const timeTie = entries.length >= 2 && near(entries[0].time.score, entries[1].time.score);
    const tie = entries.length >= 2 && timeTie
      && entries[0].lp === entries[1].lp
      && near(entries[0].bossPct, entries[1].bossPct)
      && near(entries[0].score, entries[1].score);
    const teams = {};
    for (const e of entries) {
      teams[e.t] = {
        bossPct: e.bossPct, score: e.score, lp: e.lp, remainingTime: e.remainingTime,
        timeScore: e.time.score, timeMax: e.time.max, timePct: e.time.pct, time: e.time.time,
      };
    }
    return { winnerTeam: tie ? null : (entries[0]?.t ?? null), doubleLoss: false, timeTie, teams };
  }

  /** Every boss field is over: stats, bounties, then the Hidden Core or RESULT. */
  _finishFinal(hidden, resultOf) {
    if (this.phase !== (hidden ? PHASE.HIDDEN_CORE : PHASE.FINAL_ASSAULT)) return;
    this._stopClientCombat();
    // the end condition the server registered first decides (client-side combat: _endFinal — pool 0 → victory, team LP 0
    // → defeat); a boss field's final result may never turn a defeat into a victory (user playtest #6 item 5)
    const victory = this.isVersus
      ? this._teamIds().every((t) => (this._poolOf(t)?.hp ?? 0) <= 0) // every team cleared its own boss
      : this._finalEnding ? this._finalEnding === 'cleared' : this.bossPool.hp <= 0;
    for (const f of this.fields) {
      const res = resultOf(f);
      this._collectSimErrors(f, res);
      f.live = false;
      for (const pid of f.players) {
        const pp = res.perPlayer && res.perPlayer[pid];
        const ps = this.players.get(pid);
        if (pp) this.lastResults.set(pid, pp);
        if (pp && ps) {
          ps.stats.dmgDealt += Number(pp.damageDealt) || 0;
          ps.stats.kills += Number(pp.killed) || 0;
          ps.creditedKills += creditedKillsOf(pp);
          ps.dirty(); // m.private.stats
          this._charDamageTickers(ps, pp);
        }
        if (pp && ps) {
          // the own battle counts as perfect when the team won, the result is a real one (not the stand-in of a field that
          // never reported) and the player's own field let no counted enemy through [ASSUMED: the boss battle is a battle
          // of the player's own — "下场作战" — so a perfect-payout card pays as after a normal one]
          const perfect = victory && !res.synthetic && pp.perfect === true && !(pp.leaked || []).some((l) => l && l.counted !== false)
            && this._bossLeaksAgree(f, res, pid);
          this._settleBossBounties(ps, pp, perfect);
        }
        if (pp && ps) this.dispatch(ps, 'onBattleResult', { result: pp, lpLoss: 0, perfect: !!pp.perfect, boss: true });
      }
    }
    // 2V2 settlement time rule (user 2026-10-17): a field's own battle duration fills in a team the client clock never
    // saw end (server-run battles); a record taken at the exact ending moment always wins (_noteBossTime, first write).
    for (const f of this.fields) {
      const gt = f && f.result && Number.isFinite(f.result.time) ? f.result.time : null;
      this._noteBossTime(f ? f.team : null, this.round, gt);
    }
    this._syncTeamLp();
    this.deadline = 0;
    this.overtimeAt = 0;
    this.markPublic();
    this.runner = null;
    // The boss CHAIN (design 2026-10-17): 最终攻势 (R14) → 隐秘核心 (R15). A cleared round opens the next one when the
    // layers / LP also qualify; when the chain ends the match settles (2V2 decides its winner then).
    const ahead = hidden ? null : this.gd.hiddenRound;
    // 2V2: the round is SHARED and both teams fight their own leader, so one team's clear opens the next round for the
    // match (requiring both would make the 隐秘核心 practically unreachable) — [ASSUMED].
    const advanced = this.isVersus ? this._anyTeamCleared() : victory;
    this.later(this.scaled(DELAYS.SETTLE), () => {
      if (advanced && ahead != null && !!this.hiddenBossId && this._bossChainEligible(ahead)) {
        this.hiddenReached = true;
        this.tickerText('隐秘核心已解锁', FLOW_TICKER_PRIORITY);
        this.bossPool = null;
        this.startRound(ahead);
        return;
      }
      if (this.isVersus) {
        // per-player victory comes from this.versusOutcome in results.js
        this.versusOutcome = this._versusDecide();
        this.finish({ victory: true, reason: 'versus' });
        return;
      }
      if (!hidden) this.finish({ victory, reason: victory ? 'victory' : 'defeat' });
      else this.finish({ victory: true, hiddenCleared: victory, reason: 'victory' });
    });
  }

  /** 2V2: at least one team cleared its own leader this boss round. */
  _anyTeamCleared() { return this._teamIds().some((t) => (this._poolOf(t)?.hp ?? 1) <= 0); }

  /**
   * Whether the boss chain may continue into `round`. Solo / co-op: the official `hiddenEligible` (hidden-core layers +
   * team LP). 2V2 [ASSUMED]: the same rule per TEAM (the round is shared, so the best team opens it), at the 2-player
   * share of the co-op threshold (user 2026-10-17): `hiddenCore.multi × TEAM_SIZE / 4` = 600 layers per squad instead
   * of the 1200 of the upstream 4-player co-op team. The LP bar (`minTeamLpExclusive`) and `checkedAfterRound` are
   * unchanged; data/config.json stays as generated (AGENTS.md).
   */
  _bossChainEligible(round) {
    if (round == null) return false;
    if (!this.isVersus) return hiddenEligible(this.gd, { layerSum: this.hiddenLayerSum, teamLp: this.teamLp });
    const hc = this.gd.hiddenCore;
    const threshold = (hc.multi * TEAM_SIZE) / 4;
    for (const t of this._teamIds()) {
      const layerSum = this.alivePlayers().filter((p) => this.teamIdOf(p) === t).reduce((s, p) => s + p.activatedLayers(), 0);
      if (layerSum > threshold && this._teamLpOf(t) > hc.minTeamLpExclusive) return true;
    }
    return false;
  }
}
