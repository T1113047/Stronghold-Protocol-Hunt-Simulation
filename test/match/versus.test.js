// test/match/versus.test.js — 2V2 ('versus') match layer, step 2.1: the team abstraction and the team-scoped
// "teammates" effects. A versus match must never let a player's effects/联防 reach the opposing team.
//
// Runs a whole versus match on the fake battle engine (test/match/fakeBattle.js) and checks it reaches RESULT with
// no engine errors, so the team plumbing never breaks the round loop.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { PHASE, ERR, VERSUS_CONFRONT, teamOfSeat, VERSUS_LOW_LP, VERSUS_INFO_SECONDS, opponentRevealed } from '../../shared/constants.js';
import { confrontPool } from '../../server/match/match/confront.js';
import { buildNormalWave } from '../../server/match/waves.js';
import { generateVersusDrafts } from '../../server/match/choices.js';
import { validateC2S } from '../../shared/protocol.js';

/** 4 seats laid out as two teams of two (0,1 → team 0; 2,3 → team 1). */
const vsSeats = () => ([
  { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
  { seat: 1, playerId: 'ai_1', name: 'A1', isBot: true, connected: true, team: 0 },
  { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
  { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
]);

/**
 * The cheapest monster that fits `budget`, across all 6 groups, with its 1-based group index (null when nothing fits).
 * The groups hold the same TOTAL value but not the same cheapest card, and the budget moves with the round's wave
 * value — so a test that must actually place something has to look everywhere (on a small wave the last group can hold
 * nothing affordable).
 * @returns {{ rec: { key: string, value: number }, group: number }|null}
 */
const affordablePick = (m, budget) => {
  let best = null;
  m.confrontGroups().forEach((g, i) => {
    for (const r of g.rows) if (r.value <= budget && (!best || r.value < best.rec.value)) best = { rec: r, group: i + 1 };
  });
  return best;
};

describe('versus (2V2) match: team model', () => {
  test('a versus match exposes its teams and scopes allies to one team', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'NORMAL', seats: vsSeats(), seed: 7, fake: true }).start();
    const m = h.m;
    assert.equal(m.mode, 'versus');
    assert.equal(m.isVersus, true);
    assert.equal(m.isSolo, false);
    // the versus room reuses the MULTI tuning (data/config.json is generated)
    assert.ok(String(m.modeId).startsWith('mode_multi_'), m.modeId);

    const [a0, a1, b0, b1] = ['p_0', 'ai_1', 'ai_2', 'ai_3'].map((id) => h.ps(id));
    assert.deepEqual([a0, a1, b0, b1].map((p) => p.team), [0, 0, 1, 1]);
    assert.deepEqual([0, 1, 2, 3].map(teamOfSeat), [0, 0, 1, 1]);

    // allies: the player's own team only, in seat order — never the opponents
    assert.deepEqual(m.alliesOf(a0).map((p) => p.playerId), ['p_0', 'ai_1']);
    assert.deepEqual(m.alliesOf(b1).map((p) => p.playerId), ['ai_2', 'ai_3']);
    assert.equal(m.teamIdOf(a0), 0);
    assert.equal(m.teamIdOf(b0), 1);
    assert.equal(m.teamIdOf(null), 0, 'a missing player falls back to team 0');

    // aliveAllies narrows to the living members of the same team
    a1.lp = 0; a1.eliminate(1);
    assert.deepEqual(m.aliveAlliesOf(a0).map((p) => p.playerId), ['p_0']);
    assert.deepEqual(m.aliveAlliesOf(b0).map((p) => p.playerId), ['ai_2', 'ai_3']);
  });

  test('co-op keeps its single-team behaviour (everyone is team 0)', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 3, fake: true }).start();
    const m = h.m;
    assert.equal(m.isVersus, false);
    for (const ps of m.order) assert.equal(ps.team, null);
    const [p0] = m.order;
    assert.equal(m.alliesOf(p0).length, m.order.length, 'coop: allies are the whole roster');
    assert.deepEqual(m.aliveAlliesOf(p0).map((p) => p.playerId), m.alivePlayers().map((p) => p.playerId));
  });

  test('a versus match runs to RESULT with no engine errors, and every 联防 group is single-team', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 11, fake: true }).start();
    h.autoHumans();
    const m = h.m;
    // watch every 联防 as it opens: each plan's helpers + leakers must all be on ONE team (never a cross-team 联防)
    const groups = [];
    h.onSend.push((pid, msg) => {
      if (msg.t !== 'm.public' || msg.phase !== PHASE.UNITE || !Array.isArray(m.unitePlans)) return;
      for (const pl of m.unitePlans) groups.push([...pl.helpers, ...pl.leakers].map((p) => m.teamIdOf(p)));
    });
    const done = h.drive(() => h.ended != null, { maxSteps: 3e6 });
    assert.ok(done && h.ended, `the match ended (phase ${m.phase} R${m.round})`);
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    for (const g of groups) assert.equal(new Set(g).size, 1, `a 联防 group spanned teams: ${g.join()}`);
  });

  test('versus: boss pairing stays within a team', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 5, fake: true }).start();
    h.autoHumans();
    const m = h.m;
    let checked = false;
    h.onSend.push((pid, msg) => {
      if (msg.t !== 'm.public' || (m.phase !== PHASE.FINAL_ASSAULT && m.phase !== PHASE.HIDDEN_CORE)) return;
      if (checked || !Array.isArray(m.bossPairs) || !m.bossPairs.length) return;
      checked = true;
      for (const pair of m.bossPairs) {
        const teams = new Set(pair.map((id) => m.teamIdOf(m.players.get(id))));
        assert.equal(teams.size, 1, `boss pair spans teams: ${pair.join()}`);
      }
    });
    h.drive(() => h.ended != null, { maxSteps: 3e6 });
    assert.ok(checked, 'the match reached the Final Assault');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus (client-side combat): the per-team boss pools reach the clients intact', () => {
    // 2026-10-16 production bug: b.pool leaves the scalar hp null and sends one pool per team (b.pool.pools); the
    // client read the scalar, `Number(null)` is 0, so the local pool was zeroed and the boss field reported 'cleared'
    // the moment it started — the server logged "implausible boss result … while the pool holds 8000000" and took the
    // field over. The players never saw the boss fight.
    // 4 humans: both teams' boss fields must run client-side, which is where the bug lived
    const seats = [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'p_2', name: 'B0', isBot: false, connected: true, team: 1 },
      { seat: 3, playerId: 'p_3', name: 'B1', isBot: false, connected: true, team: 1 },
    ];
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats, seed: 21, fake: true, clientCombat: true }).start();
    h.autoHumans();
    const m = h.m;
    h.drive(() => h.ended != null || m.phase === PHASE.FINAL_ASSAULT, { maxSteps: 3e6 });
    assert.equal(m.phase, PHASE.FINAL_ASSAULT, `reached the Final Assault (${m.phase} R${m.round})`);
    // b.start: a boss field names its team, so the client can pick its entry out of b.pool.pools (the round start hands
    // the fields out as it launches them)
    h.flushAll();
    for (const [id, team] of [['p_0', 0], ['p_2', 1]]) {
      const start = h.allTo(id, 'b.start').find((msg) => msg.kind === 'boss');
      assert.ok(start, `${id} received a boss b.start`);
      assert.equal(start.team, team, 'the field carries its team');
    }
    // b.pool: one entry per team, no scalars
    h.drive(() => h.bc.some((msg) => msg.t === 'b.pool' && msg.pools), { maxSteps: 2e5 });
    h.flushAll(); // the deliveries run on the scheduler, like a real socket frame
    const first = h.bc.find((msg) => msg.t === 'b.pool' && msg.pools);
    assert.ok(first, 'the boss round broadcasts one pool per team');
    assert.equal(first.hp, null, '2V2 has no scalar pool');
    assert.deepEqual(Object.keys(first.pools).sort(), ['0', '1']);
    for (const t of ['0', '1']) {
      assert.ok(first.pools[t].max > 0, `team ${t} pool has a size`);
      assert.equal(first.pools[t].hp, first.pools[t].max, `team ${t} pool starts full`);
      assert.ok(Number.isFinite(first.pools[t].teamLp), `team ${t} carries its LP`);
    }
    // the browser side (the harness's SimClient applies the same rule as public/js/battle/runner.js): the local pool
    // must keep its hp — with the bug it read 0 and the field ended as 'cleared'
    const c0 = h.clients.get('p_0');
    assert.ok(c0.pools.length, 'the client received the pool broadcast');
    const field = [...c0.battles.values()].find((e) => e.battle && e.battle.sharedBoss);
    assert.ok(field && field.battle.sharedBoss.maxHp > 0, 'the client built its team boss field');
    assert.ok(field.battle.sharedBoss.hp > 0, 'the local pool is not zeroed by the null scalar');
    h.drive(() => h.ended != null, { maxSteps: 3e6 });
    assert.deepEqual(h.logs.warn.filter((w) => /implausible boss result/.test(w)), [], 'no boss result was rejected');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    assert.ok(h.ended, 'the match ended');
  });

  // R16 was deleted outright (user 2026-10-17): the boss chain ends at the 隐秘核心 (R15).
  test('versus: the boss chain stops at R15 — clearing the 隐秘核心 settles the match', () => {
    // 4 humans with client-side combat: the pool-zero end condition is only checked for client fields, and the harness's
    // fake boss never dies on its own (the test below clears the pools explicitly).
    const seats = [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'p_2', name: 'B0', isBot: false, connected: true, team: 1 },
      { seat: 3, playerId: 'p_3', name: 'B1', isBot: false, connected: true, team: 1 },
    ];
    const h = makeMatch({ mode: 'versus', difficulty: 'NORMAL', seats, seed: 21, fake: true, clientCombat: true }).start();
    h.autoHumans();
    const m = h.m;
    // the official way in (the golden runs boost the same two things): every seat counts as fully bonded and starts rich,
    // so the 隐秘核心 threshold (Σ layers > 1200, team LP > 1) holds
    for (const ps of m.players.values()) { ps.activatedLayers = () => 999; ps.lp = 100000; }
    const clearBoss = () => { for (const t of m._teamIds()) { const p = m._poolOf(t); if (p) p.hp = 0; } m._checkFinalEnd(); };
    assert.deepEqual(Object.keys(m).filter((k) => /third/i.test(k)), [], 'the match keeps no third-boss state');
    assert.equal(m.isBossRound(16), false, 'R16 is not a boss round');
    assert.ok(h.drive(() => m.phase === PHASE.FINAL_ASSAULT, { maxSteps: 4e6 }), 'reached the Final Assault');
    assert.equal(m.round, 14, 'R14 is the Final Assault');
    clearBoss();
    assert.ok(h.drive(() => m.phase === PHASE.HIDDEN_CORE && m.round === 15, { maxSteps: 4e6 }), 'the 隐秘核心 opens');
    assert.equal(m.hiddenReached, true, 'hiddenReached');
    const pub = h.lastTo('p_0', 'm.public');
    assert.deepEqual(Object.keys(pub).filter((k) => /third/i.test(k)), [], 'the public view carries no third-boss field');
    clearBoss();
    assert.ok(h.drive(() => h.ended != null, { maxSteps: 4e6 }), 'clearing the 隐秘核心 ends the boss chain');
    assert.ok(h.ended.versus, 'the versus outcome is decided then');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: 标准 has no Hidden Core at all, and co-op keeps its official two boss rounds', () => {
    const funny = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 21, fake: true }).start();
    funny.autoHumans();
    assert.equal(funny.m.gd.hiddenRound, null, '標準 has no hidden round');
    assert.equal(funny.m.isBossRound(16), false);
    funny.drive(() => funny.ended != null, { maxSteps: 4e6 });
    assert.equal(funny.m.round, 14, 'the match still ends at R14');
    assert.ok(funny.ended.versus, 'the versus outcome');
    assert.deepEqual(funny.logs.error, [], 'no engine errors');
    // co-op: the mode has a Hidden Core, which stays the last round of its boss chain
    const coop = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 7, fake: true }).start();
    assert.ok(coop.m.gd.hiddenRound != null, 'co-op 险境 still has its Hidden Core');
    assert.equal(coop.m.isBossRound(coop.m.gd.hiddenRound), true, 'its Hidden Core stays a boss round');
  });

  test('versus: the result carries per-team scoring and a winner', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 21, fake: true }).start();
    h.autoHumans();
    h.drive(() => h.ended != null, { maxSteps: 3e6 });
    assert.ok(h.ended, 'the match ended');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    assert.ok(h.ended.versus, 'the summary carries the versus scoring');
    assert.equal(h.ended.versus.doubleLoss, false, 'both teams reached R14');
    assert.equal(Object.keys(h.ended.versus.teams).length, 2, 'both teams scored');
    assert.ok(h.ended.versus.winnerTeam === 0 || h.ended.versus.winnerTeam === 1 || h.ended.versus.winnerTeam === null, 'a valid winner');
    // the players' victory flags follow their team's win
    const winner = h.ended.versus.winnerTeam;
    for (const p of h.ended.players) {
      const want = winner != null && p.alive && (h.m.players.get(p.playerId).team === winner);
      assert.equal(p.victory, want, `${p.playerId} victory ${p.victory}, want ${want}`);
    }
    // the 4:5 boss-time record reached the payload (最终攻势 only: FUNNY has no 隐秘核心)
    assert.deepEqual(h.ended.versus.timeWeights, { r14: 4 });
    assert.equal(typeof h.ended.versus.timeTie, 'boolean');
    for (const t of [0, 1]) {
      const time = h.ended.versus.teams[t].time;
      assert.ok(time && time.r14, `team ${t}: R14's countdown was recorded`);
      assert.equal(time.r14.reached, true, `team ${t}: the Final Assault was fought`);
      assert.ok(time.r14.remain >= 0 && time.r14.remain <= time.r14.limit, `team ${t}: remain ${time.r14.remain} within 0..${time.r14.limit}`);
      assert.ok(Number.isFinite(h.ended.versus.teams[t].timeScore), `team ${t}: a time score`);
    }
  });

  test('versus: the 机变 draft gives EACH TEAM its own 4 cards with the same graded pool (the two teams take turns)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'HARD', seats: vsSeats(), seed: 31, fake: true }).start();
    const m = h.m;
    assert.ok([4, 5, 6].includes(m.contestStartRound), `contestStartRound ${m.contestStartRound}`);
    assert.ok(h.lastTo('p_0', 'm.public')?.contestStartRound === m.contestStartRound, 'published in m.public');
    let seen = false;
    h.onSend.push((pid, msg) => {
      if (msg.t === 'm.public' && msg.phase === PHASE.SP_DRAFT && m.sp) seen = true;
    });
    h.autoHumans();
    h.drive(() => h.ended != null || seen, { maxSteps: 3e6 });
    assert.ok(seen, 'reached an 机变 draft');
    const s = m.sp;
    const poolOf = (t) => s.cards.filter((c) => c.poolTeam === t);
    assert.equal(poolOf(0).length, 4, 'team 0 is offered its own 4 cards');
    assert.equal(poolOf(1).length, 4, 'team 1 is offered its own 4 cards');
    assert.equal(s.cards.length, 8, 'the two pools together hold 8 cards');
    // both sides rolled the same family and the same fixed gradient: I×2 + II×1 + III×1
    assert.equal(s.teams.get(0).family, s.teams.get(1).family, 'one family for both teams');
    const tiers = (list) => list.map((c) => c.tier).sort();
    assert.deepEqual(tiers(poolOf(0)), [1, 1, 2, 3], "team 0's tiers");
    assert.deepEqual(tiers(poolOf(1)), [1, 1, 2, 3], "team 1's tiers");
    assert.equal(new Set(s.cards.map((c) => c.id)).size, 8, 'the two boards never share a card');
    // the two teams take turns: a member of each, slot by slot
    assert.deepEqual(s.order.map((pid) => m.teamIdOf(m.players.get(pid))), [0, 1, 0, 1]);
    // a seat may only pick from its OWN team's pool
    const own = m.spCardsFor(m.players.get('p_0'));
    assert.equal(own.length, 4);
    assert.ok(own.every((c) => c.poolTeam === 0), "p_0's pool holds its own team's cards only");
    const oppIdx = poolOf(1)[0].idx;
    assert.ok(m.pickCard(m.players.get('p_0'), oppIdx).error, 'taking the other team\'s card is refused');
    // the published view is per team: own cards/order/picks only, and 'waiting' while the other team decides
    const v0 = m.spViewFor(0);
    const v1 = m.spViewFor(1);
    assert.ok(v0.cards.every((c) => poolOf(0).some((x) => x.idx === c.idx)), "team 0's view never shows team 1's cards");
    assert.equal(v0.order.length, 2, "team 0's order holds its own two members");
    assert.ok((v0.turn != null) !== (v1.turn != null), 'exactly one team holds the pick');
    if (v0.turn == null) assert.equal(v0.waiting, true, 'the waiting team says so');
    if (v1.turn == null) assert.equal(v1.waiting, true, 'the waiting team says so');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: the 机变 generator keeps one family and a fixed gradient (bounty I×2/II×1/III×1, shop 3 unchanged)', () => {
    const m = makeMatch({ mode: 'versus', difficulty: 'HARD', seats: vsSeats(), seed: 71, fake: true }).start().m;
    const opts = {
      stageId: m.stageId,
      bondAvailable: (bondId, team) => m.bondLive(bondId, team),
      itemAvailable: (id) => m.itemPool.canGain(id),
    };
    const tiers = (list) => {
      const out = {};
      for (const c of list) out[c.tier] = (out[c.tier] || 0) + 1;
      return out;
    };
    let bounties = 0;
    for (let i = 0; i < 60; i++) {
      const round = [3, 9, 11][i % 3];
      const d = generateVersusDrafts(m.gd, m.rngDraft, round, opts);
      assert.ok(d && d.teams.length === 2, `round ${round}: two boards`);
      const [a, b] = d.teams;
      if (d.family === 'shop') {
        assert.equal(a.length, 3, 'the 机密商店 keeps its official 3-card draw');
        assert.equal(b.length, 3);
        continue;
      }
      assert.equal(a.length, 4, `round ${round} (${d.family}): team 0 four cards`);
      assert.equal(b.length, 4, `round ${round} (${d.family}): team 1 four cards`);
      if (d.family === 'bounty') {
        bounties++;
        assert.deepEqual(tiers(a), { 1: 2, 2: 1, 3: 1 }, 'team 0: two I, one II, one III');
        assert.deepEqual(tiers(b), { 1: 2, 2: 1, 3: 1 }, 'team 1: two I, one II, one III');
        assert.equal(new Set([...a, ...b].map((c) => c.id)).size, 8, 'the two bounty boards never share a card');
      }
      if (d.family === 'tactic') {
        assert.equal(a.filter((c) => c.team).length, 2, 'team 0: two team-wide tactics');
        assert.equal(b.filter((c) => c.team).length, 2, 'team 1: two team-wide tactics');
      }
    }
    assert.ok(bounties > 0, 'R3 is a bounty round');
    assert.deepEqual(m.logs?.error || [], [], 'no engine errors');
  });

  test('versus: development compensation grants a 小电话 from the contest round', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 41, fake: true }).start();
    const m = h.m;
    h.autoHumans();
    h.toPrep(m.contestStartRound);
    const hasPhone = (ps) => [...ps.hand, ...ps.temp].some((p) => p && p.id === 'chess_item_2_06_e_a')
      || [...ps.board.values()].some((pc) => (pc.items || []).some((it) => it.id === 'chess_item_2_06_e_a'));
    assert.ok([...m.players.values()].some(hasPhone), 'a 小电话 was granted at the contest-round prep');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: each team shares ONE HP pool (Σ of its members\' 策略) and dies as a whole', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 91, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.round >= 1 && m.phase !== PHASE.BAND_DRAFT, { maxSteps: 3e6 }), `reached the match (${m.phase})`);
    const bandSum = (t) => [...m.players.values()].filter((p) => m.teamIdOf(p) === t).reduce((s, p) => s + m.gd.startLp(p.bandId), 0);
    const pool0 = m.teamHpPool(0);
    assert.equal(pool0, bandSum(0), "team 0's pool is the sum of its members' band HP");
    assert.equal(m.teamHpPool(1), bandSum(1), "team 1's pool is the sum of its members' band HP");
    const pub = h.lastTo('p_0', 'm.public');
    assert.ok(pub && pub.teamLps, 'm.public carries the per-team pools');
    assert.equal(pub.teamLps[0], pool0);
    const rows = pub.players.filter((r) => r.team === 0);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.lp === pool0), 'both teammates\' rows show the shared pool');
    // damage lands on the POOL, and the members' own lp stay a split of it (Σ = pool, what the invariants expect)
    m._teamLpLoss(0, 5);
    assert.equal(m.teamHpPool(0), pool0 - 5, 'the pool took the damage');
    assert.equal(m.alivePlayers().filter((p) => m.teamIdOf(p) === 0).reduce((s, p) => s + p.lp, 0), pool0 - 5, "the members' lp are a split of the pool");
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: the 寻呼模块 is granted ONCE per team, when its shared pool first drops below 21', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 93, fake: true }).start();
    const m = h.m;
    h.autoHumans();
    h.toPrep(m.contestStartRound);
    const hasPager = (ps) => [...ps.hand, ...ps.temp].some((p) => p && p.id === 'chess_item_4_01_e_a')
      || [...ps.board.values()].some((pc) => (pc.items || []).some((it) => it.id === 'chess_item_4_01_e_a'));
    // team 0 is healthy, team 1 is in trouble: only team 1 takes one
    m.teamLps.set(0, 60);
    m.teamLps.set(1, VERSUS_LOW_LP - 1);
    m._pagerGranted = new Set();
    m._versusPrepGrant();
    const t1 = [...m.players.values()].filter((p) => m.teamIdOf(p) === 1);
    const t0 = [...m.players.values()].filter((p) => m.teamIdOf(p) === 0);
    assert.ok(t1.every(hasPager), 'the low team took a 寻呼模块');
    assert.ok(!t0.some(hasPager), 'the healthy team did not');
    // it is not granted a second time, even while still low
    m.teamLps.set(1, 1);
    m._versusPrepGrant();
    assert.ok(m._pagerGranted.has(1), 'the team is marked as served');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: a strategy is unique per TEAM (both teams may run the same one)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 121, fake: true }).start();
    const m = h.m;
    m.draft = { picks: { p_0: null, ai_1: 'band_x', ai_2: 'band_x', ai_3: 'band_y' } };
    assert.equal(m.bandTaken('band_x', 'p_0'), true, "a teammate's pick blocks the strategy");
    assert.equal(m.bandTaken('band_y', 'p_0'), false, "an opponent's pick does not");
    // the same strategy may be held by one player of each team — the other team's pick never blocks
    assert.equal(m.bandTaken('band_x', 'ai_2'), false, "the opposing team's pick does not block either");
    assert.equal(m.bandTaken('band_x', 'ai_3'), true, "…but their own teammate's does");
  });

  test('versus: a setup reroll keeps the briefing countdown and never blocks the confirm', () => {
    const seats = [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
      { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
    ];
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats, seed: 151, fake: true }).start();
    const m = h.m;
    assert.equal(m.phase, PHASE.INFO_CHECK);
    const before = m.deadline;
    assert.equal(m.requestSetupReroll('p_0', m.setupRevision).ok, true);
    assert.ok(m._anySetupVote(), 'the vote is open');
    assert.equal(m.deadline, before, 'the countdown stays up while the vote runs');
    assert.equal(m.handle('p_1', { t: 'g.infoReady', setupRevision: m.setupRevision }).ok, true, 'a teammate may still confirm');
    const vote = m._anySetupVote();
    assert.equal(m.voteSetupReroll(m.players.get('p_1'), vote.id, true).ok, true, 'the teammate agrees');
    assert.equal(m.setupRevision, 1, 'the reroll landed');
    assert.ok(!m._anySetupVote(), 'the vote closed');
    assert.ok(m.deadline > h.sched.now(), 'a fresh window is armed for the re-confirmations');
    assert.equal(m.handle('p_0', { t: 'g.infoReady', setupRevision: m.setupRevision }).ok, true);
    assert.equal(m.handle('p_1', { t: 'g.infoReady', setupRevision: m.setupRevision }).ok, true);
    assert.ok(h.drive(() => m.phase !== PHASE.INFO_CHECK, { maxSteps: 3e6 }), 'the briefing advanced');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: a team reroll vote reaches its OWN team\'s view only', () => {
    const seats = [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'p_2', name: 'B0', isBot: false, connected: true, team: 1 },
      { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
    ];
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats, seed: 153, fake: true }).start();
    const m = h.m;
    assert.equal(m.requestSetupReroll('p_0', m.setupRevision).ok, true);
    const base = m.publicView();
    // The client reads the SOLO/coop scalar `rerollVote`; in 2V2 it must carry the VIEWER's team's vote, or the consent
    // buttons render for nobody and the 重刷本局 click looks like it did nothing.
    const mine = m._teamPublicView(base, 0);
    assert.ok(mine.rerollVote, 'team 0 sees its own open vote');
    assert.deepEqual(mine.rerollVote.voters.slice().sort(), ['p_0', 'p_1']);
    assert.deepEqual(Object.keys(mine.rerollVotes), ['0'], 'the per-team map is scoped to the own team');
    const foes = m._teamPublicView(base, 1);
    assert.equal(foes.rerollVote, null, 'team 1 does not see team 0\'s vote');
    assert.deepEqual(foes.rerollVotes, {}, 'nor its entry in the map');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: a reroll vote nobody answers expires and the briefing still advances', () => {
    const seats = [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
      { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
    ];
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats, seed: 152, fake: true }).start();
    const m = h.m;
    assert.equal(m.requestSetupReroll('p_0', m.setupRevision).ok, true);
    assert.ok(m._anySetupVote(), 'the vote is open');
    h.sched.advance(60_000);
    h.sched.runNext();
    assert.ok(!m._anySetupVote(), 'the window expired the vote');
    assert.equal(m.phase, PHASE.BAND_DRAFT, 'the briefing advanced instead of hanging');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: the briefing window is 45 s and can still end early', () => {
    // two humans (a lone human + AI runs untimed, so the window would not be armed at all)
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seed: 122, fake: true, seats: [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
      { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
    ] }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.INFO_CHECK, { maxSteps: 3e6 }), 'reached the briefing');
    const left = (m.deadline - h.sched.now()) / 1000;
    assert.ok(Math.abs(left - VERSUS_INFO_SECONDS) < 1, `briefing window ${left}s (want ${VERSUS_INFO_SECONDS})`);
    // every human ready → it ends at once, long before the window
    for (const ps of m.players.values()) if (!ps.isBot) m.handle(ps.playerId, { t: 'g.infoReady', setupRevision: m.setupRevision });
    assert.ok(h.drive(() => m.phase !== PHASE.INFO_CHECK, { maxSteps: 3e6 }), 'the briefing closed early');
    assert.equal(m.phase, PHASE.BAND_DRAFT);
  });

  test('versus: prep scouting is team-only (the opponent board stays hidden)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 123, fake: true }).start();
    const m = h.m;
    h.autoHumans();
    h.toPrep(1);
    const me = m.players.get('p_0');
    assert.equal(m.watch(me, 'n:ai_1').ok, true, 'a teammate may be scouted');
    assert.ok(m.watch(me, 'n:ai_2').error, 'an opponent may not (team 1)');
    assert.ok(m.watch(me, 'n:ai_3').error, 'an opponent may not (team 1)');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: EVERY round\'s 对抗期 is selectable again (a previous round must not lock it)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 124, fake: true }).start();
    const m = h.m;
    const me = () => m.players.get('p_0');
    const opp = () => [...m.players.values()].filter((p) => m.teamIdOf(p) === 1).map((p) => p.playerId);
    const playOne = () => {
      assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), `reached the 对抗期 (${m.phase} R${m.round})`);
      const view = m._teamPublicView(m.publicView(), 0).confront;
      assert.equal(view.stage, 'target');
      assert.ok(!view.targets['p_0'], `R${m.round}: no target locked yet`);
      assert.ok(!view.subs['p_0'], `R${m.round}: nothing submitted yet (a previous round must not lock it)`);
      assert.equal(m.submitConfrontTarget(me(), { targetPlayerId: opp()[0] }).ok, true);
      assert.equal(m.confrontStage, 'monster', `R${m.round}: step 2 opens`);
      const picks = [];
      let left = m.confrontBudget();
      const pick0 = affordablePick(m, left);
      for (const r of (pick0 ? m.confrontGroups()[pick0.group - 1].rows : []).slice().sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))) {
        if (r.value > left) continue;
        left -= r.value;
        picks.push({ enemyKey: r.key, gate: 'lower' });
        if (picks.length >= 2) break;
      }
      assert.equal(m.submitConfront(me(), { group: pick0.group, position: 'mid', picks }).ok, true, `R${m.round}: the monsters are accepted`);
      assert.ok(h.drive(() => m.phase !== PHASE.CONFRONT, { maxSteps: 3e6 }), 'the window closed');
      return m.round;
    };
    const r1 = playOne();
    const r2 = playOne();
    assert.ok(r2 > r1, `played two different rounds (${r1} → ${r2})`);
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: a finished 对抗期 never leaks its roster into the next PREP / wave', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 192, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 狩猎期');
    const me = m.players.get('p_0');
    const opp = [...m.players.values()].filter((p) => m.teamIdOf(p) === 1).map((p) => p.playerId);
    assert.equal(m.submitConfrontTarget(me, { targetPlayerId: opp[0] }).ok, true);
    const pick = affordablePick(m, m.confrontBudget());
    assert.ok(pick, 'an affordable monster');
    const picks = [{ enemyKey: pick.rec.key, gate: 'lower' }];
    assert.equal(m.submitConfront(me, { group: pick.group, position: 'mid', picks }).ok, true);
    const played = m.round;
    assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round > played, { maxSteps: 3e6 }), 'reached the next PREP');
    assert.equal(m.confront, null, 'the applied set is cleared at the round start');
    assert.equal(m.confrontSubs, null);
    assert.equal(m.confrontTargets, null);
    assert.equal(m.publicView().confront, undefined, 'no stale roster in m.public');
    assert.deepEqual(m.confrontFor(me), [], 'no stale intervention reaches a wave');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: a player who never submits gets the auto-selection when the window ends', () => {
    // TWO humans: with a single one the step (like the prep) is untimed — soloUntimed — and only a submission ends it
    const seats = [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
      { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
    ];
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats, seed: 141, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached step 1');
    const budget = m.confrontBudget();
    assert.equal(m.submitConfrontTarget(m.players.get('p_0'), { targetPlayerId: 'ai_2' }).ok, true);
    assert.equal(m.confrontStage, 'monster', 'step 2 opened');
    // the cap is THIS round's prep — the same time the players had to prepare — not a fixed 30 s
    assert.equal(m.deadline - m.sched.now(), m.scaled(m.gd.prepTime(m.round) * 1000), "the window is the round's prep time");
    // nobody submits: let the window run out
    assert.ok(h.drive(() => m.phase === PHASE.COMBAT, { maxSteps: 3e6 }), 'the window closed');
    const sub = m.confront && m.confront.get('p_0');
    assert.ok(sub && sub.picks.length > 0, 'the silent player got an automatic set');
    assert.ok(m.confrontSpent(sub.picks) <= budget, 'it stays within the budget');
    assert.equal(sub.position, 'mid', 'the same default the 自动选择 button uses');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: with a single human the 定制 window is untimed (it matches the untimed prep)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 192, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 狩猎期');
    assert.equal(m.submitConfrontTarget(m.players.get('p_0'), { targetPlayerId: 'ai_2' }).ok, true);
    assert.equal(m.confrontStage, 'monster', 'step 2 opened');
    // one human + three bots: no countdown at all (the prep is untimed too) — the all-submitted end closes it
    assert.equal(m.deadline, 0, 'untimed, never a fixed window');
    const budget = m.confrontBudget();
    const picks = [];
    let left = budget;
    const pick0 = affordablePick(m, budget);
    assert.ok(pick0, 'the budget affords at least one monster');
    for (const r of m.confrontGroups()[pick0.group - 1].rows.slice().sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))) {
      if (r.value > left) continue;
      left -= r.value;
      picks.push({ enemyKey: r.key, gate: 'lower' });
      if (picks.length >= 1) break;
    }
    assert.equal(m.submitConfront(m.players.get('p_0'), { group: pick0.group, position: 'mid', picks }).ok, true);
    assert.equal(m.phase, PHASE.CONFRONT, 'the roster hold follows the last submission');
    assert.equal(m.confrontStage, 'roster');
    assert.ok(h.run(() => m.phase === PHASE.COMBAT, { maxSteps: 3e5 }), 'the roster hold ends → COMBAT');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: ticker lines stay inside the team they belong to', () => {
    // four HUMANS (sendTo skips AI seats, so the recipients have to be real)
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seed: 131, fake: true, seats: [
      { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
      { seat: 1, playerId: 'p_1', name: 'A1', isBot: false, connected: true, team: 0 },
      { seat: 2, playerId: 'p_2', name: 'B0', isBot: false, connected: true, team: 1 },
      { seat: 3, playerId: 'p_3', name: 'B1', isBot: false, connected: true, team: 1 },
    ] }).start();
    const m = h.m;
    h.sent.length = 0;
    h.bc.length = 0;
    m.tickerText('team-0 line', 0, 0);       // a line of team 0's own game
    m.tickerText('team-1 line', 0, 1);
    m.tickerText('team-1 line again', 0, 1);
    m.tickerText('everyone');                // no team: a match-wide notice (broadcast to both)
    const got = (pid) => h.sent.filter(([id, msg]) => id === pid && msg.t === 'm.ticker').length;
    assert.equal(got('p_0'), 1, "team 0 hears its own line only");
    assert.equal(got('p_1'), 1, '…as does its teammate');
    assert.equal(got('p_2'), 2, "team 1 hears its two lines and never team 0's");
    assert.equal(got('p_3'), 2);
    assert.equal(h.bc.filter((msg) => msg.t === 'm.ticker').length, 1, 'the team-less line is a broadcast');
  });

  test('versus: bounty = fixed 1/1/2/2 for the first four phases, the live formula from the 5th on, R13 = fixed 25', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 161, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 狩猎期');
    assert.equal(m.submitConfrontTarget(m.players.get('p_0'), { targetPlayerId: 'ai_2' }).ok, true);
    const start = m.contestStartRound;
    assert.ok([4, 5, 6].includes(start), `the contest round was drawn (R${start})`);
    assert.equal(m.confrontHuntIndex(), 1, 'the quest round is the 1st bounty phase');
    const row = affordablePick(m, m.confrontBudget());
    assert.ok(row, 'at least one monster fits the contest-round budget');
    const four = Array.from({ length: 4 }, (_, i) => ({ enemyKey: row.rec.key, gate: i % 2 ? 'upper' : 'lower' }));
    // phases 1–4: the fixed caps, floored — full clear = cap, half = floor(cap / 2), all leaked = 0
    assert.deepEqual([...VERSUS_CONFRONT.bountyCaps], [1, 1, 2, 2]);
    for (let ph = 1; ph <= 4; ph++) {
      m.round = start + ph - 1;
      assert.equal(m.confrontHuntIndex(), ph);
      assert.equal(m.confrontFixedBountyCap(), VERSUS_CONFRONT.bountyCaps[ph - 1], `phase ${ph} cap`);
      const cap = VERSUS_CONFRONT.bountyCaps[ph - 1];
      assert.equal(m.confrontBountyOf(four), cap, `phase ${ph}: a full clear pays the cap`);
      assert.equal(m.confrontBountyAt(0, four), 0, `phase ${ph}: all leaked = 0`);
      assert.equal(m.confrontBountyAt(2, four), Math.floor(cap / 2), `phase ${ph}: half = floor(cap/2)`);
      const plan = m.confrontBountyPlan(four);
      assert.ok(plan.every((c) => Number.isInteger(c) && c >= 0), `phase ${ph}: integer coins, 0 allowed`);
      assert.equal(plan.reduce((s, c) => s + c, 0), cap, `phase ${ph}: the split sums to the cap`);
      for (let k = 0; k <= 4; k++) assert.equal(plan.slice(0, k).reduce((s, c) => s + c, 0), m.confrontBountyAt(k, four), `phase ${ph}: running total after ${k} kills`);
    }
    // the 5th phase, before R13: the live formula, NO cap and no min 1
    const live = (r, picks) => {
      m.round = r;
      assert.equal(m.confrontFixedBountyCap(), null, `R${r} runs the live formula`);
      return Math.floor((m.confrontSpent(picks) / Math.max(1, m.confrontWaveValue())) * (Number(m.gd.income(r)) || 0) * VERSUS_CONFRONT.killIncomeShare);
    };
    const expect5 = live(start + 4, four);
    assert.equal(m.confrontBountyOf(four), expect5, 'the 5th phase pays the live formula, exactly');
    assert.equal(m.confrontBountyAt(0, four), 0, 'live: all leaked = 0');
    assert.equal(m.confrontBountyAt(2, four), Math.floor((m.confrontSpent(four.slice(0, 2)) / Math.max(1, m.confrontWaveValue())) * (Number(m.gd.income(start + 4)) || 0)), 'live: half pays half the value share');
    // R13 最终狩猎: a FIXED 25, scaled by the kill ratio (full clear 25, half 12) — never the live formula, never 64
    m.round = 13;
    assert.equal(m.confrontHunt(), true);
    assert.equal(m.confrontHuntIndex(), 13 - start + 1, 'the final hunt is the 13 − start + 1 th phase (always ≥ 5)');
    assert.equal(m.confrontFixedBountyCap(), VERSUS_CONFRONT.finalHuntBounty, 'R13 is the fixed 25');
    assert.equal(m.confrontBountyOf(four), 25, 'R13 full clear = 25');
    assert.equal(m.confrontBountyAt(2, four), 12, 'R13 half = floor(25 / 2) = 12');
    assert.equal(m.confrontBountyAt(0, four), 0, 'R13 all leaked = 0');
    const plan13 = m.confrontBountyPlan(four);
    assert.deepEqual([...plan13], [6, 6, 6, 7], '25 split over 4 kills by the accumulator');
    assert.ok(plan13.every((c) => Number.isInteger(c)), 'R13 pays integers only');
    // farm: 64 of the cheapest monsters total the fixed 25 on R13 (not 64, and not the live formula) — the anti-farm holds
    const farm = Array.from({ length: VERSUS_CONFRONT.maxPicks }, (_, i) => ({ enemyKey: row.rec.key, gate: i % 2 ? 'upper' : 'lower' }));
    assert.equal(m.confrontBountyOf(farm), 25, '64 cheapest monsters on R13 still total 25');
    assert.equal(m.confrontBountyAt(1, farm), 0, 'one cheap monster out of 64 pays nothing');
    assert.ok(m.confrontBountyOf(farm) < farm.length, 'the farm can never pay per monster');
    assert.ok(m.confrontBountyPlan(farm).every((c) => Number.isInteger(c) && c >= 0), 'every kill pays an integer (0 allowed)');
    m.round = start;
    const picks = [];
    let left = m.confrontBudget();
    for (const x of m.confrontGroups()[row.group - 1].rows.slice().sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))) {
      if (x.value > left) continue; left -= x.value; picks.push({ enemyKey: x.key, gate: 'lower' }); if (picks.length >= 3) break;
    }
    assert.equal(m.submitConfront(m.players.get('p_0'), { group: row.group, position: 'mid', picks }).ok, true);
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: the bounty counts ONLY the monsters the opponent placed at that receiver — never the wave', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 165, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 狩猎期');
    const ps = m.players.get('p_0');
    assert.equal(m.submitConfrontTarget(ps, { targetPlayerId: 'ai_2' }).ok, true);
    const row = affordablePick(m, m.confrontBudget());
    const picks = Array.from({ length: 4 }, (_, i) => ({ enemyKey: row.rec.key, gate: i % 2 ? 'upper' : 'lower' }));
    assert.equal(m.submitConfront(ps, { group: row.group, position: 'mid', picks }).ok, true);
    const sub = m.confrontSubs.get('p_0');
    const tgt = m.players.get('ai_2');
    const plain = (n) => Array.from({ length: n }, (_, i) => ({ time: i, enemyKey: 'enemy_1005_yokai', count: 1, routeIndex: 0, interval: 0 }));
    // the wave's OWN monsters never carry a confront bounty: killing all of them pays nothing
    const big = m.applyConfront(plain(40), sub, tgt);
    assert.ok(big.length > sub.picks.length, 'the wave really holds its own monsters too');
    for (const s of big) if (s.confrontSeat == null) assert.ok(!s.bounty, 'a wave monster carries NO placed-monster bounty');
    assert.equal(big.reduce((n, s) => n + ((s.bounty && s.bounty.coins) || 0), 0), m.confrontBountyOf(sub.picks), 'the wave contributes 0 — only the placed batch pays');
    // the denominator is the placed batch, not the wave: a 1-monster wave and a 60-monster wave pay the same
    const coinsOf = (arr) => arr.filter((s) => s.confrontSeat != null).map((s) => s.bounty.coins);
    const small = m.applyConfront(plain(1), sub, tgt);
    assert.deepEqual(coinsOf(small), coinsOf(big), 'the wave size can never move the bounty');
    const placed = big.filter((s) => s.confrontSeat != null);
    assert.equal(placed.every((s) => s.bounty.total === sub.picks.length), true, 'total = the monsters placed at this receiver');
    // two receivers, different batch sizes: each denominator is its own batch, and neither leaks into the other
    const other = m.players.get('ai_3');
    const sA = { target: tgt.playerId, picks: [picks[0]], position: 'mid', ratio: sub.ratio, seat: 0 };
    const sB = { target: other.playerId, picks: picks.slice(1), position: 'mid', ratio: sub.ratio, seat: 0 };
    m.confront = new Map([['a', sA], ['b', sB]]);
    const outA = m.applyConfront(plain(1), sA, tgt).filter((s) => s.confrontSeat != null);
    const outB = m.applyConfront(plain(1), sB, other).filter((s) => s.confrontSeat != null);
    assert.deepEqual(outA.map((s) => s.bounty.total), [1], "receiver A: the denominator is A's 1 monster");
    assert.deepEqual(outB.map((s) => s.bounty.total), [3, 3, 3], "receiver B: the denominator is B's 3 monsters");
    assert.equal(outA.reduce((n, s) => n + s.bounty.coins, 0), m.confrontBountyOf(sA.picks), 'A pays only its own batch');
    assert.equal(outB.reduce((n, s) => n + s.bounty.coins, 0), m.confrontBountyOf(sB.picks), 'B pays only its own batch');
    // two interventions at the SAME receiver: the batch is their union, indexed in submission order
    const union = new Map([['a', { target: tgt.playerId, picks: [picks[0]], position: 'mid', ratio: sub.ratio, seat: 0 }],
      ['b', { target: tgt.playerId, picks: picks.slice(1), position: 'mid', ratio: sub.ratio, seat: 0 }]]);
    m.confront = union;
    const uA = m.applyConfront(plain(1), union.get('a'), tgt).filter((s) => s.confrontSeat != null);
    const uB = m.applyConfront(plain(1), union.get('b'), tgt).filter((s) => s.confrontSeat != null);
    assert.deepEqual([...uA, ...uB].map((s) => s.bounty.total), [4, 4, 4, 4], 'one shared denominator = the union (4)');
    assert.deepEqual([...uA, ...uB].map((s) => s.bounty.index), [0, 1, 2, 3], 'each slot of the union is distinct');
    assert.equal([...uA, ...uB].reduce((n, s) => n + s.bounty.coins, 0), m.confrontBountyOf(picks), 'the union pays the whole batch once');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: an over-budget / oversized placement is refused with its own error code', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 163, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 狩猎期');
    const ps = m.players.get('p_0');
    assert.equal(m.submitConfrontTarget(ps, { targetPlayerId: 'ai_2' }).ok, true);
    const rows = m.confrontGroups().flatMap((g) => g.rows);
    const key = rows[0].key;
    // more monsters than the protocol / UI cap (64): its own code, not BAD_TARGET
    const tooMany = Array.from({ length: VERSUS_CONFRONT.maxPicks + 1 }, (_, i) => ({ enemyKey: key, gate: i % 2 ? 'upper' : 'lower' }));
    assert.equal(m.submitConfront(ps, { group: 1, position: 'mid', picks: tooMany }).error, ERR.CONFRONT_COUNT);
    // over this round's value budget: its own code too
    const budget = m.confrontBudget();
    const dearest = rows.slice().sort((a, b) => b.value - a.value)[0];
    const n = Math.max(1, Math.floor(budget / Math.max(1, dearest.value)) + 1);
    assert.ok(n <= VERSUS_CONFRONT.maxPicks, `the over-budget list fits the count cap (${n})`);
    const over = Array.from({ length: n }, (_, i) => ({ enemyKey: dearest.key, gate: i % 2 ? 'upper' : 'lower' }));
    assert.ok(m.confrontSpent(over) > budget, 'it really is over the budget');
    assert.equal(m.submitConfront(ps, { group: 1, position: 'mid', picks: over }).error, ERR.CONFRONT_BUDGET);
    assert.equal(m.confrontSubs.has(ps.playerId), false, 'nothing was stored');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus 狩猎: placed monsters leak for free, pay a bounty, and the lists are revealed after the phase', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 171, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 狩猎期');
    assert.equal(m.submitConfrontTarget(m.players.get('p_0'), { targetPlayerId: 'ai_2' }).ok, true);
    const budget = m.confrontBudget();
    const pick = affordablePick(m, budget);
    assert.ok(pick, "at least one monster fits the round's budget");
    const g = m.confrontGroups()[pick.group - 1].rows.slice().sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
    const picks = [];
    let left = budget;
    for (const x of g) { if (x.value > left) continue; left -= x.value; picks.push({ enemyKey: x.key, gate: 'lower' }); if (picks.length >= 2) break; }
    // while the phase runs the opponent's board stays hidden (checked before the last submission closes it)
    const during = m._teamPublicView(m.publicView(), 0).confront;
    assert.ok(!during.subs['ai_2'], 'the opponent is hidden during the 狩猎期');
    assert.equal(m.submitConfront(m.players.get('p_0'), { group: pick.group, position: 'mid', picks }).ok, true);
    assert.equal(m.phase, PHASE.CONFRONT, 'everyone submitted → the roster hold');
    assert.equal(m.confrontStage, 'roster');
    assert.ok(h.run(() => m.phase === PHASE.COMBAT, { maxSteps: 3e5 }), 'the roster hold ends → COMBAT');
    // the applied wave: placed monsters are free (no LP, no 完美作战 break) and carry a kill bounty
    const sub = m.confrontSubs.get('p_0');
    const out = m.applyConfront([{ time: 0, enemyKey: 'enemy_1005_yokai', count: 1, routeIndex: 0, interval: 0 }], sub, m.players.get('ai_2'));
    const placed = out.filter((s) => s.confrontSeat != null);
    assert.ok(placed.length > 0, 'the placed monsters are in the wave');
    assert.ok(placed.every((s) => s.countInTotal === false), 'a leaked placed monster costs no target HP');
    assert.ok(placed.every((s) => s.bounty && Number.isInteger(s.bounty.coins) && s.bounty.coins >= 0), `each carries an integer bounty (0 allowed): ${placed.map((s) => s.bounty && s.bounty.coins).join(',')}`);
    assert.equal(placed.every((s) => s.bounty.total === placed.length), true, 'the placement total rides along on every bounty');
    assert.equal(placed.reduce((n, s) => n + s.bounty.coins, 0), m.confrontBountyOf(sub.picks), 'a full clear pays exactly the shown total');
    assert.equal(m.confrontBountyOf(sub.picks), m.confrontBountyPlan(sub.picks).reduce((n, c) => n + c, 0), 'the shown total is the sum of the kills');
    // once the phase closes, BOTH teams' boards are revealed (the 悬赏名单)
    assert.ok(h.drive(() => m.phase === PHASE.COMBAT, { maxSteps: 3e6 }), 'the window closed');
    const after = m._teamPublicView(m.publicView(), 0).confront;
    assert.ok(after.subs['ai_2'] && after.subs['ai_2'].coins >= 1, "the opponent's board and bounty are revealed");
    assert.ok(after.subs['p_0'].coins >= 1, 'and so is the own one');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: each team has its own disabled core bonds (3 available)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'NORMAL', seats: vsSeats(), seed: 51, fake: true }).start();
    const m = h.m;
    assert.ok(m.pools instanceof Map && m.pools.size === 2, 'one chess pool per team');
    const coreIds = new Set(Object.values(DATA.bonds).filter((b) => b && b.isCore && b.weight > 0).map((b) => b.bondId));
    const bansOf = (t) => m.bansOf(t).drawn.filter((b) => coreIds.has(b));
    assert.equal(bansOf(0).length, 5, `team 0 bans ${bansOf(0).length} core bonds`);
    assert.equal(bansOf(1).length, 5, `team 1 bans ${bansOf(1).length} core bonds`);
    assert.notDeepEqual([...bansOf(0)].sort(), [...bansOf(1)].sort(), 'the two teams ban different core bonds');
  });

  test('versus: a team reroll changes only its own disabled core bonds (stage/boss shared)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'NORMAL', seats: vsSeats(), seed: 61, fake: true }).start();
    const m = h.m;
    const stage0 = m.stageId;
    const boss0 = m.bossId;
    const bans0 = m.bansOf(0).drawn.slice().sort();
    const bans1 = m.bansOf(1).drawn.slice().sort();
    // team 0 has a single human (p_0): its proposal completes at once
    const r = m.requestSetupReroll('p_0', m.setupRevision);
    assert.equal(r && r.ok, true, JSON.stringify(r));
    assert.equal(m.stageId, stage0, 'stage stays shared');
    assert.equal(m.bossId, boss0, 'boss stays shared');
    assert.notDeepEqual(m.bansOf(0).drawn.slice().sort(), bans0, "team 0's bans changed");
    assert.deepEqual(m.bansOf(1).drawn.slice().sort(), bans1, "team 1's bans unchanged");
  });

  test('versus: the opponent is hidden before R14 and revealed at the Final Assault', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 71, fake: true }).start();
    const m = h.m;
    h.autoHumans();
    h.toPrep(1);
    const pub = h.lastTo('p_0', 'm.public');
    assert.ok(pub, 'p_0 got an m.public');
    const teamOf = (r) => m.teamIdOf(m.players.get(r.playerId));
    const opp = pub.players.filter((r) => teamOf(r) === 1);
    assert.ok(opp.length > 0 && opp.every((r) => r.hidden === true), 'opponent rows hidden before R14');
    // ... but they still carry their TEAM's shared HP pool, so the panel shows a bar on both sides
    assert.ok(opp.every((r) => Number.isFinite(r.lp) && r.lp > 0), `hidden rows carry their team pool: ${opp.map((r) => r.lp).join('/')}`);
    assert.ok(pub.players.filter((r) => teamOf(r) === 0).every((r) => !r.hidden), 'own rows visible');
    // reached the Final Assault: everything is revealed
    h.drive(() => m.phase === PHASE.FINAL_ASSAULT, { maxSteps: 3e6 });
    const pub2 = h.lastTo('p_0', 'm.public');
    assert.ok(pub2 && pub2.players.filter((r) => teamOf(r) === 1).every((r) => r.hidden !== true), 'opponent revealed at R14');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: the reveal rule is ONE function (R13 closed, R14 / R15 open); co-op has no opponent', () => {
    // shared/constants.js opponentRevealed — the only place the round lives
    assert.equal(opponentRevealed(0), false);
    assert.equal(opponentRevealed(13), false, 'the R13 最终狩猎 is still closed');
    assert.equal(opponentRevealed(14), true, 'R14 最终攻势 opens');
    assert.equal(opponentRevealed(15), true, 'R15 隐秘核心 stays open');
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 3, fake: true }).start();
    const m = h.m;
    h.autoHumans();
    h.toPrep(1);
    assert.equal(m.opponentRevealed, false, 'the match getter follows the function');
    const keep = m.round;
    m.round = 14;
    assert.equal(m.opponentRevealed, true, 'R14: the getter opens');
    m.round = keep;
    // co-op: no opponent at all (the getter is vacuously true; the boss-group rule still comes from finalAssault.test.js)
    const c = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 2, seed: 3, fake: true }).start();
    assert.equal(c.m.isVersus, false);
    assert.equal(c.m.opponentRevealed, true, 'co-op is never restricted by the 2V2 reveal');
    m.dispose();
    c.m.dispose();
  });

  test('versus: the opponent is a stub with no intel and an unwatchable board through R4–R13, both open at R14', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 111, fake: true }).start();
    const m = h.m;
    h.autoHumans();
    const me = m.players.get('p_0');
    const teamOf = (r) => m.teamIdOf(m.players.get(r.playerId));
    for (let r = 4; r <= 13; r++) {
      h.toPrep(r);
      const pub = h.lastTo('p_0', 'm.public');
      const opp = pub.players.filter((row) => teamOf(row) === 1);
      assert.equal(opp.length, 2, `R${r}: both opponents listed`);
      for (const row of opp) {
        assert.equal(row.hidden, true, `R${r}: opponent row is a stub`);
        assert.ok(!Object.hasOwn(row, 'shopLevel') && !Object.hasOwn(row, 'boardCount'), `R${r}: no shop level / board count`);
        assert.ok(Number.isFinite(row.lp) && row.lp > 0, `R${r}: the stub still carries the team's shared pool`);
      }
      assert.ok(m.watch(me, 'n:ai_2').error, `R${r}: an opponent board is refused`);
      assert.equal(m.watch(me, 'n:ai_1').ok, true, `R${r}: a teammate board is allowed`);
    }
    // R14 最终攻势: the real rows, the opponent's prep board and the whole `[OVERVIEW]` intel
    h.toPrep(14);
    const pub14 = h.lastTo('p_0', 'm.public');
    const opp14 = pub14.players.filter((row) => teamOf(row) === 1);
    assert.equal(opp14.length, 2);
    for (const row of opp14) {
      assert.notEqual(row.hidden, true, 'R14: a real row, not a stub');
      assert.ok(Number.isFinite(row.shopLevel) && row.shopLevel >= 1, 'R14: shop level published');
      assert.ok(Number.isFinite(row.boardCount), 'R14: board count published');
    }
    assert.equal(m.opponentRevealed, true, 'R14: revealed');
    assert.equal(m.watch(me, 'n:ai_2').ok, true, 'R14: the opponent board opens');
    const scout = h.lastTo('p_0', 'm.field');
    assert.equal(scout.fieldId, 'n:ai_2', 'the opponent prep board was sent');
    assert.equal(scout.prep, true);
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    m.dispose();
  });

  test('versus: at R15 (隐秘核心) a fighting player may watch the other team\'s boss field', () => {
    const h = makeMatch({
      mode: 'versus', difficulty: 'NORMAL', seats: vsSeats(), seed: 21, fake: true,
      script: (b) => (b.kind === 'boss' ? { bossDps: 1e9 } : {}),
    }).start();
    const m = h.m;
    h.autoHumans();
    // the official way into the 隐秘核心: fully-bonded seats (Σ layers > 1200) and a team pool > 1
    for (const ps of m.players.values()) ps.activatedLayers = () => 999;
    assert.ok(h.drive(() => m.phase === PHASE.HIDDEN_CORE && m.round === 15, { maxSteps: 4e6 }), 'the 隐秘核心 opens');
    assert.equal(m.opponentRevealed, true, 'R15: revealed');
    const me = m.players.get('p_0');
    const own = m.fields.find((f) => f.players.includes('p_0'));
    const other = m.fields.find((f) => f.kind === 'hidden' && !f.players.includes('p_0'));
    assert.ok(own && other, 'both teams fight their own hidden-core field');
    assert.equal(m.teamIdOf(m.players.get(other.players[0])), 1, 'the other field is team 1\'s');
    assert.deepEqual(m.watch(me, other.fieldId), { ok: true }, 'the opponent boss field opens at R15');
    const pub = h.lastTo('p_0', 'm.public');
    assert.ok(pub.players.filter((row) => m.teamIdOf(m.players.get(row.playerId)) === 1).every((row) => row.hidden !== true), 'real rows at R15');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    m.dispose();
  });

  test('versus: a spectator seat is outside the team restriction — full public, any board, any field', () => {
    const S = 's_spec';
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), spectators: [S], seed: 121, fake: true }).start();
    const m = h.m;
    h.autoHumans();
    h.toPrep(4);
    const pub = h.lastTo(S, 'm.public');
    assert.ok(pub, 'the spectator receives m.public');
    assert.equal(pub.players.filter((row) => row.hidden === true).length, 0, 'no hidden stub in a spectator\'s public view');
    assert.ok(pub.players.every((row) => Number.isFinite(row.shopLevel) && Number.isFinite(row.boardCount)), 'every row carries its intel');
    const spec = m.spectators.get(S);
    assert.equal(m.watch(spec, 'n:ai_2').ok, true, 'R4: the spectator scouts a team 1 board');
    assert.equal(h.lastTo(S, 'm.field').fieldId, 'n:ai_2');
    assert.equal(m.watch(spec, 'n:p_0').ok, true, 'and a team 0 board');
    assert.equal(h.lastTo(S, 'm.field').fieldId, 'n:p_0');
    assert.equal(m.watch(spec, 'n:ai_3').ok, true, 'any opponent');
    // the Final Assault: both teams' boss fields are open to the spectator
    assert.ok(h.drive(() => m.phase === PHASE.FINAL_ASSAULT, { maxSteps: 4e6 }), 'reached the Final Assault');
    const other = m.fields.find((f) => f.players.every((pid) => m.teamIdOf(m.players.get(pid)) === 1));
    assert.ok(other, 'team 1 has its own boss field');
    assert.equal(m.watch(spec, other.fieldId).ok, true, 'the spectator watches the other team\'s boss field');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    m.dispose();
  });

  test('versus: the 对抗期 runs from the contest round and the opponent\'s wave is sabotaged', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 81, fake: true }).start();
    const m = h.m;
    const ok = h.drive(() => m.phase === PHASE.CONFRONT, { maxSteps: 3e6 });
    assert.ok(ok && m.phase === PHASE.CONFRONT, `reached the 对抗期 (phase ${m.phase} R${m.round})`);
    assert.equal(m.round, m.contestStartRound, 'at the contest round');
    assert.equal(m.confrontStage, 'target', 'step 1 (who do I attack) comes first');
    const groups = m.confrontGroups();
    // the groups are the OFFICIAL 特训敌人 types (data/factions.json), in the data's order — NOT equal-value buckets
    const typeIds = Object.keys(DATA.factions.types);
    assert.deepEqual(groups.map((g) => g.id), typeIds, 'one group per 特训敌人 type');
    assert.equal(groups.length, typeIds.length, `${typeIds.length} type groups`);
    assert.ok(groups.every((g) => g.rows.length > 0), 'no empty type');
    assert.ok(groups.every((g) => g.name && g.icon), 'every group carries the official name and icon');
    // every pool enemy is offered by at least one type (the template-slot enemies are hand-assigned: CONFRONT_GROUP_EXTRA)
    const offered = new Set(groups.flatMap((g) => g.rows.map((r) => r.key)));
    for (const k of confrontPool(m.data.factions)) assert.ok(offered.has(k), `${k} is offered by no type`);
    // the types are NOT equal-valued any more (that rule is gone with the type grouping): 特异 is the big one
    const totals = groups.map((g) => g.rows.reduce((s, r) => s + r.value, 0));
    assert.ok(Math.max(...totals) / Math.min(...totals) - 1 > 0.2, `type sizes differ: ${totals.join('/')}`);
    // step 1: the human names one opponent; the teammate is given the other (first come, first served)
    const me = m.players.get('p_0');
    const opp = [...m.players.values()].filter((p) => m.teamIdOf(p) === 1).map((p) => p.playerId);
    assert.equal(opp.length, 2);
    assert.equal(m.submitConfrontTarget(me, { targetPlayerId: opp[0] }).ok, true);
    assert.equal(m.confrontStage, 'monster', 'both sides paired → step 2');
    assert.equal(m.confrontTargets.get('p_0'), opp[0]);
    assert.equal(m.confrontTargets.get('ai_1'), opp[1], 'the teammate got the opponent that was left');
    // step 2: the cap is the round's per-player VALUE BUDGET (not a count): the whole group does not fit, a few monsters do
    const budget = m.confrontBudget();
    assert.ok(budget > 0, 'a positive budget');
    const pick = affordablePick(m, budget);
    assert.ok(pick, "at least one monster fits the round's budget");
    const whole = groups[pick.group - 1].rows.map((x) => ({ enemyKey: x.key, gate: 'lower' }));
    assert.ok(m.confrontSpent(whole) > budget, 'the whole group exceeds the contest round budget');
    assert.ok(m.submitConfront(me, { group: pick.group, position: 'mid', picks: whole }).error, 'an over-budget submission is refused');
    const picks = [];
    let left = budget;
    for (const r of groups[pick.group - 1].rows.slice().sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))) {
      if (r.value > left) continue;
      left -= r.value;
      picks.push({ enemyKey: r.key, gate: 'lower' });
      if (picks.length >= 3) break;
    }
    assert.ok(picks.length > 0, 'at least one monster fits the budget');
    assert.ok(m.confrontSpent(picks) <= budget, 'the picks stay within the budget');
    const r = m.submitConfront(me, { group: pick.group, position: 'mid', picks });
    assert.equal(r && r.ok, true, JSON.stringify(r));
    // the placed monsters carry the SENDER's seat for the client's marker (display only)
    assert.equal(m.confrontSubs.get('p_0').seat, me.seat, 'the submission remembers who sent it');
    // the three bots submitted when step 2 opened, so the last submission ends the step at once (no waiting out a window)
    assert.equal(m.phase, PHASE.CONFRONT, 'everyone submitted → the roster hold');
    assert.equal(m.confrontStage, 'roster', 'the 悬赏名单 is announced before combat');
    assert.ok(h.run(() => m.phase === PHASE.COMBAT, { maxSteps: 3e5 }), 'combat starts after the hold');
    // an intervention lands on ITS TARGET's wave only
    const hit = m.confrontFor(m.players.get(opp[0]));
    assert.ok(Array.isArray(hit) && hit.length === 1 && hit[0].picks.length === picks.length, "team 0's set lands on its own target");
    assert.ok(hit[0].picks.every((p) => p.enemyKey && (p.gate === 'upper' || p.gate === 'lower')), 'every placed monster carries a gate');
    const other = m.confrontFor(m.players.get(opp[1]));
    assert.ok(Array.isArray(other) && other.every((s) => s.target === opp[1]), "the other target only takes its own attacker's set");
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: the intervention share is 5 % at R_contest, +2 %/round, 15 % cap, 50 % on the 最终狩猎 (R13)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 81, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT, { maxSteps: 3e6 }), 'reached the 狩猎期');
    const start = m.contestStartRound;
    const ratioAt = (round) => { const keep = m.round; m.round = round; const v = m.confrontRatio(); m.round = keep; return v; };
    assert.equal(ratioAt(start), 0.05, 'the contest round replaces 5 %');
    assert.ok(Math.abs(ratioAt(start + 1) - 0.07) < 1e-9, '+2 % the round after');
    assert.ok(Math.abs(ratioAt(start + 2) - 0.09) < 1e-9, '+2 % again');
    assert.ok(Math.abs(ratioAt(start + 10) - 0.15) < 1e-9, 'capped at 15 %');
    assert.equal(ratioAt(13), 0.5, 'R13 is the 最终狩猎 — a flat 50 %');
    // the share IS the budget's factor: budget = the wave value × the share × budgetMul (2), per player
    assert.equal(m.confrontBudget(), Math.round(m.confrontWaveValue() * m.confrontRatio() * 2));
    assert.equal(m.confrontHunt(), m.round === 13, 'the hunt flag follows the round');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: the intervention replaces the NOMINAL share — originals priced with 特性 (5 % at R_contest, 50 % on R13)', () => {
    // The panel announces "本轮替换 5 %" (50 % on R13). `applyConfront` must therefore value the originals with the SAME
    // currency as confrontWaveValue (stats + the graded 特性 score, confrontValueOf), not the stat half (confrontValue):
    // with the stat price alone the dropped value came out ~30 % short of the share. The drop also picks the candidate
    // set closest to the target, instead of stopping at the first unit that no longer fits.
    const budgetSeed = (m) => {
      const wave = m.confrontWaveValue();
      const nominal = m.confrontRatio();
      const row = m.confrontGroups().flatMap((g) => g.rows).sort((a, b) => a.value - b.value)[0];
      const target = m.alivePlayers().find((p) => m.teamIdOf(p) === 1);
      const sub = { target: target.playerId, picks: [{ enemyKey: row.key, gate: 'lower' }], position: 'mid', ratio: nominal, seat: 0 };
      const budget = m.confrontBudget();
      const bounty = m.confrontBountyOf(sub.picks);
      const out = m.applyConfront(m.wave.spawns, sub, target);
      assert.equal(m.confrontBudget(), budget, 'the budget still = wave value × share × budgetMul');
      assert.equal(m.confrontBudget(), Math.round(wave * nominal * VERSUS_CONFRONT.budgetMul), 'the budget formula did not move');
      assert.equal(m.confrontBountyOf(sub.picks), bounty, 'the bounty of the same picks did not move with the drop');
      let kept = 0;
      for (const s of out) {
        if (s.confrontSeat != null) continue;
        kept += m.confrontValueOf(s.enemyKey, s.mods) * Math.max(1, Math.floor(Number(s.count) || 1));
      }
      return { actual: (wave - kept) / wave, bounty };
    };
    // 5 %: the drawn contest round (R4 / R5 / R6 depending on the seed)
    for (const seed of [3, 5, 7, 11, 12, 23]) {
      const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed, fake: true }).start();
      const m = h.m;
      assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), `seed ${seed}: reached the 狩猎期`);
      assert.equal(m.round, m.contestStartRound, 'the drawn contest round');
      const r = budgetSeed(m);
      assert.ok(Math.abs(r.actual - 0.05) <= 0.02, `seed ${seed}: replaced ${(r.actual * 100).toFixed(2)} % of the wave, nominal 5 %`);
      assert.equal(r.bounty, 1, 'the 1st bounty phase still pays the fixed cap 1 on a full clear');
      assert.deepEqual(h.logs.error, [], `seed ${seed}: no engine errors`);
      m.dispose();
      // R13 最终狩猎: a fresh match swapped onto the hunt round's wave (the scaling / ratio / seeded drop all agree)
      const h13 = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed, fake: true }).start();
      const m13 = h13.m;
      m13.round = 13;
      m13.wave = buildNormalWave(m13.gd, m13.rngWaves, m13.factions, 13);
      assert.equal(m13.confrontRatio(), 0.5, 'R13 is the flat 50 %');
      const r13 = budgetSeed(m13);
      assert.ok(Math.abs(r13.actual - 0.5) <= 0.02, `seed ${seed}: R13 replaced ${(r13.actual * 100).toFixed(2)} % of the wave, nominal 50 %`);
      assert.equal(r13.bounty, VERSUS_CONFRONT.finalHuntBounty, 'R13 still pays the fixed 25 on a full clear');
      assert.deepEqual(h13.logs.error, [], `seed ${seed}: no engine errors on R13`);
      m13.dispose();
    }
  });

  test('versus: a submission may MIX 特训敌人 types (the budget is the only cap)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 192, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 狩猎期');
    assert.equal(m.submitConfrontTarget(m.players.get('p_0'), { targetPlayerId: 'ai_2' }).ok, true);
    assert.equal(m.confrontStage, 'monster', 'step 2 opened');
    const groups = m.confrontGroups();
    const budget = m.confrontBudget();
    const cheap = groups.flatMap((g, i) => g.rows.map((r) => ({ ...r, type: i })))
      .sort((a, b) => a.value - b.value || a.key.localeCompare(b.key));
    const first = cheap[0];
    const second = cheap.find((r) => r.type !== first.type && r.value + first.value <= budget);
    assert.ok(first && second, `two cheap monsters of DIFFERENT types fit ${budget}: ${first && first.value} + ${second && second.value}`);
    const picks = [{ enemyKey: first.key, gate: 'lower' }, { enemyKey: second.key, gate: 'upper' }];
    assert.ok(m.confrontSpent(picks) <= budget, 'within the budget');
    // an enemy no type offers is still refused
    assert.ok(m.submitConfront(m.players.get('p_0'), { group: 1, position: 'mid', picks: [{ enemyKey: 'enemy_not_offered', gate: 'lower' }] }).error, 'an unknown monster is refused');
    assert.equal(m.submitConfront(m.players.get('p_0'), { group: 1, position: 'mid', picks }).ok, true, 'a cross-type submission is accepted');
    const sub = m.confrontSubs.get('p_0');
    assert.deepEqual(sub.picks.map((p) => p.enemyKey), [first.key, second.key], 'both types land');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });

  test('versus: the 狩猎期 payload passes the wire schema (every type tab, cross-type lists, big lists)', () => {
    const pick = { enemyKey: 'enemy_1000_gopro_2', gate: 'lower' };
    // every 特训敌人 tab, plus the null the client sends when no tab was opened
    for (const group of [1, 2, 3, 4, 5, 6, 7, null]) {
      assert.equal(validateC2S({ t: 'g.confront', group, position: 'mid', picks: [pick] }), null, `group ${group} is accepted`);
    }
    // picking across types may place a LOT of monsters (the budget, not a count, is the cap)
    assert.equal(validateC2S({ t: 'g.confront', group: 7, position: 'mid', picks: Array.from({ length: 30 }, () => ({ ...pick })) }), null, '30 monsters are accepted');
    assert.ok(validateC2S({ t: 'g.confront', group: 7, position: 'mid', picks: Array.from({ length: 65 }, () => ({ ...pick })) }), 'a silly 65-monster list is still refused');
    assert.ok(validateC2S({ t: 'g.confront', group: 0, position: 'mid', picks: [pick] }), 'group 0 is refused');
    assert.ok(validateC2S({ t: 'g.confront', group: 17, position: 'mid', picks: [pick] }), 'group 17 is refused');
  });

  test('co-op keeps the 6-card 机变 draft and draws a 同盟狩猎 start round', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 1, bots: 1, seed: 33, fake: true }).start();
    const m = h.m;
    // 同盟狩猎: the co-op 狩猎期 start round is drawn like the 2V2 contest round (the opponent-based 对抗期 stays 2V2-only)
    assert.ok([4, 5, 6].includes(m.contestStartRound), `co-op hunt start ${m.contestStartRound}`);
    assert.equal(m.confrontActive(), false, 'co-op never opens the player-run 对抗期');
    let spCards = null;
    h.onBroadcast.push((msg) => {
      if (msg.t === 'm.public' && msg.phase === PHASE.SP_DRAFT && m.sp && Array.isArray(m.sp.cards) && spCards == null) spCards = m.sp.cards.length;
    });
    h.autoHumans();
    h.drive(() => h.ended != null || spCards != null, { maxSteps: 3e6 });
    assert.ok(spCards == null || spCards > 3, `co-op 机变 cards ${spCards} should stay > 3`);
  });
});

// ---- the settlement's 4:5 boss-time decision (user 2026-10-17) ------------------------------------------------------
// score(team) = 4 × remain(R14)/limit(R14) + 5 × remain(R15)/limit(R15), a round a team never reached counting 0.
// The winner: time score first, then the shared LP, then the original leader scoring (_versusDecide). The remainder is
// recorded when a team's boss run ends (_noteBossTime), separately for R14 and R15.

describe('versus settlement: the 4:5 boss-time decision', () => {
  // a started versus match with hand-made pools / pools' teams / per-round time records (no boss fight needed)
  const decideMatch = ({ times = {}, lp = [10, 20], pools = [{ hp: 50, maxHp: 100 }, { hp: 100, maxHp: 100 }] } = {}) => {
    const h = makeMatch({ mode: 'versus', difficulty: 'NORMAL', seats: vsSeats(), seed: 61, fake: true }).start();
    const m = h.m;
    m.teamLps = new Map([[0, lp[0]], [1, lp[1]]]);
    m.bossPools = new Map(pools.map((p, i) => [i, { ...p }]));
    m.bossTeamTimes = times;
    return { h, m };
  };

  test('the formula: R14 counts 4, R15 counts 5, as SHARES; a missing / unplayed round is 0 and remain is clamped', async () => {
    const { bossTimeScore, BOSS_TIME_WEIGHTS } = await import('../../server/match/results.js');
    assert.deepEqual({ ...BOSS_TIME_WEIGHTS }, { boss: 4, hidden: 5 });
    assert.equal(bossTimeScore({ r14: { remain: 120, limit: 120 }, r15: { remain: 60, limit: 120 } }).score, 6.5, '4 × 1 + 5 × 0.5');
    assert.equal(bossTimeScore({ r14: { remain: 120, limit: 120 } }).max, 4, 'only the rounds in play carry weight');
    assert.equal(bossTimeScore({ r14: { remain: 120, limit: 120 }, r15: { remain: 0, limit: 120 } }).pct, (100 * 4) / 9);
    assert.equal(bossTimeScore({ r14: { remain: -5, limit: 120 }, r15: { remain: 999, limit: 120 } }).score, 5, 'clamped to [0, limit]');
    assert.equal(bossTimeScore(null).score, 0);
    assert.equal(bossTimeScore({ r14: { remain: 5, limit: 0 } }).max, 0, 'a round without a limit contributes nothing');
  });

  test('R14 lead but R15 behind: the 4:5 weights flip the winner (time first, LP second)', () => {
    // team 0 leads R14 (full countdown) but lost R15's time; team 1 the reverse — and team 0 would win on the OLD rule
    // (it holds the whole pool, more LP); the weighted time (6.5 vs 7) gives it to team 1
    const { h, m } = decideMatch({
      lp: [20, 10],
      pools: [{ hp: 0, maxHp: 100 }, { hp: 50, maxHp: 100 }],
      times: {
        14: { 0: { remain: 120, limit: 120, elapsed: 0 }, 1: { remain: 60, limit: 120, elapsed: 60 } },
        15: { 0: { remain: 60, limit: 120, elapsed: 60 }, 1: { remain: 120, limit: 120, elapsed: 0 } },
      },
    });
    const out = m._versusDecide();
    assert.equal(out.winnerTeam, 1, 'team 1: 4×0.5 + 5×1 = 7 beats 4×1 + 5×0.5 = 6.5');
    assert.equal(out.timeTie, false);
    assert.equal(out.teams[0].timeScore, 6.5);
    assert.equal(out.teams[1].timeScore, 7);
    assert.deepEqual(out.teams[1].time.r14, { remain: 60, limit: 120, reached: true });
    assert.deepEqual(out.teams[1].time.r15, { remain: 120, limit: 120, reached: true });
    assert.equal(out.teams[1].timePct, (100 * 7) / 9);
    h.m.dispose();
  });

  test('a squad that never reached R15 counts 0 there; clearing R14 faster still wins on time', () => {
    const { h, m } = decideMatch({
      lp: [5, 40],
      pools: [{ hp: 20, maxHp: 100 }, { hp: 90, maxHp: 100 }],
      times: { 14: { 0: { remain: 120, limit: 120, elapsed: 0 }, 1: { remain: 60, limit: 120, elapsed: 60 } } },
    });
    const out = m._versusDecide();
    assert.deepEqual(out.teams[1].time.r15, { remain: 0, limit: 120, reached: false }, '未打到的轮次按 0 计');
    assert.equal(out.teams[0].timeScore, 4);
    assert.equal(out.teams[1].timeScore, 2);
    assert.equal(out.winnerTeam, 0, 'team 0 has less LP and a weaker pool, but the R14 time wins');
    h.m.dispose();
  });

  test('time tie → the shared LP decides; a full tie → no winner and `timeTie` marks it', () => {
    const equal = { 15: { 0: { remain: 60, limit: 120, elapsed: 60 }, 1: { remain: 60, limit: 120, elapsed: 60 } } };
    const evenPools = [{ hp: 50, maxHp: 100 }, { hp: 50, maxHp: 100 }];
    const { h, m } = decideMatch({ lp: [30, 20], pools: evenPools, times: equal });
    const byLp = m._versusDecide();
    assert.equal(byLp.winnerTeam, 0, 'equal time: the higher shared LP wins');
    assert.equal(byLp.timeTie, true, 'and the settlement names 时间同分');
    m.teamLps.set(1, 30);
    const tied = m._versusDecide();
    assert.equal(tied.timeTie, true);
    assert.equal(tied.winnerTeam, null, 'time + LP + leader scoring all equal: a draw');
    m.bossPools.set(0, { hp: 0, maxHp: 100 });
    const onBoss = m._versusDecide();
    assert.equal(onBoss.winnerTeam, 0, 'the last fallback is the original leader scoring');
    assert.equal(onBoss.timeTie, true);
    h.m.dispose();
  });

  test('_noteBossTime: the first ending wins, negative / overflowing elapsed is clamped, rounds are kept apart', () => {
    const { h, m } = decideMatch();
    m._noteBossTime(0, 14, 999999);
    assert.deepEqual(m._teamTimeOf(0).time.r14, { remain: 0, limit: 120, reached: true }, 'never negative');
    m._noteBossTime(0, 14, 0);
    assert.equal(m._teamTimeOf(0).time.r14.remain, 0, 'a later record never overwrites the ending moment');
    m._noteBossTime(1, 15, -5);
    assert.equal(m._teamTimeOf(1).time.r15.remain, 120, 'a negative elapsed is an untouched countdown');
    assert.equal(m._teamTimeOf(1).time.r14.reached, false, 'R14 and R15 are separate records');
    h.m.dispose();
  });

  test('the result payload carries timeScore / timePct / per-round remain+limit / timeTie / the weights', async () => {
    const { buildResult } = await import('../../server/match/results.js');
    const { h, m } = decideMatch({
      times: {
        14: { 0: { remain: 120, limit: 120, elapsed: 0 }, 1: { remain: 60, limit: 120, elapsed: 60 } },
        15: { 0: { remain: 120, limit: 120, elapsed: 0 }, 1: { remain: 60, limit: 120, elapsed: 60 } },
      },
    });
    m.versusOutcome = m._versusDecide();
    const res = buildResult(m, { victory: true, hiddenReached: true, hiddenCleared: false, reason: 'versus' });
    assert.equal(res.versus.winnerTeam, 0, 'the time score decides');
    assert.deepEqual(res.versus.timeWeights, { r14: 4, r15: 5 });
    assert.equal(res.versus.timeTie, false);
    const t0 = res.versus.teams[0];
    assert.equal(t0.timeScore, 9);
    assert.equal(t0.timePct, 100);
    assert.deepEqual(t0.time.r14, { remain: 120, limit: 120, reached: true });
    assert.deepEqual(t0.time.r15, { remain: 120, limit: 120, reached: true });
    const t1 = res.versus.teams[1];
    assert.equal(t1.timeScore, 4.5);
    assert.deepEqual(t1.time.r15, { remain: 60, limit: 120, reached: true });
    h.m.dispose();
  });
});

// ---- the 2V2 隐秘核心 threshold (user 2026-10-17): the 2-player share of the co-op 1200 --------------------------------
describe('versus: the 隐秘核心 threshold is the 2-player share (600 per squad)', () => {
  const versusAt = (perPlayer) => {
    const h = makeMatch({ mode: 'versus', difficulty: 'NORMAL', seats: vsSeats(), seed: 73, fake: true }).start();
    const m = h.m;
    m.teamLps = new Map([[0, 30], [1, 30]]);
    for (const ps of m.players.values()) ps.activatedLayers = () => perPlayer;
    return { h, m };
  };

  test('550 layers per squad → no R15; 650 → R15 (the 4-player 1200 scaled by TEAM_SIZE / 4)', () => {
    assert.equal(versusAt(275).m._bossChainEligible(15), false, '2 × 275 = 550 ≤ 600');
    const high = versusAt(325);
    assert.equal(high.m._bossChainEligible(15), true, '2 × 325 = 650 > 600');
    high.h.m.dispose();
  });

  test('the LP bar is untouched, and co-op keeps the official 1200', () => {
    const dry = versusAt(600); // 1200 layers per squad, but no LP
    dry.m.teamLps.set(0, 1);
    dry.m.teamLps.set(1, 1);
    assert.equal(dry.m._bossChainEligible(15), false, 'team LP must stay above 1');
    dry.h.m.dispose();
    // co-op: hiddenEligible, not the versus branch
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 73, fake: true }).start();
    const m = h.m;
    m.teamLp = 30;
    m.hiddenLayerSum = 1200;
    assert.equal(m._bossChainEligible(15), false, 'co-op: 1200 is not > 1200');
    m.hiddenLayerSum = 1201;
    assert.equal(m._bossChainEligible(15), true);
    m.teamLp = 1;
    assert.equal(m._bossChainEligible(15), false, 'co-op LP bar unchanged');
    h.m.dispose();
  });
});
