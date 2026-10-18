// server/match/match/unitePhase.js — Match methods: 联防 glue (the rules: server/match/unite.js) — the UNITE phase in
// both modes (the 联防 field from the helpers' carried state and the leakers' enemies), its end, and the leakers' live
// counts (_uniteLeft, user playtest #6 item 7; _uniteTick in the server-run mode).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, GEO } from '../../../shared/constants.js';
import { deriveSeed } from '../../sim/rng.js';
import { uniteBattleOpts, uniteSurvivors } from '../unite.js';
import { FieldRunner, timelineAt, uniteBillBounds } from '../fields.js';
import { uniteLeft } from '../../sim/spec.js';
import { FLOW_TICKER_PRIORITY, DELAYS } from './common.js';
import { msg } from '../../../shared/i18n.js';
import { onStartUnite } from '../botEmotes.js';

export class MatchUnite {
  /** `plans`: one 联防 plan per team (2V2 'versus': up to two fields, `u0`/`u1`; coop: one field, `u`). */
  startUnite(plans) {
    if (this.clientCombat) { this._startUniteClient(plans); return; }
    this.phase = PHASE.UNITE;
    this.unitePlans = plans;
    this.unitePlan = mergedUniteView(plans);
    const multi = plans.length > 1;
    const limit = this.wave ? this.wave.timeLimit : 60;
    this.fields = plans.map((plan, i) => ({
      fieldId: multi ? `u${i}` : 'u', kind: 'unite', players: plan.helpers.map((p) => p.playerId),
      battle: this.newBattle(this._uniteOpts(plan, limit, i, multi)), live: true,
    }));
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._defaultWatch();
    this.markPublic();
    this._uniteTicker(plans);
    // an AI helper says "合作愉快" once on the open of a 联防 (enabled by default; SP_BOT_EMOTES=0 silences it)
    for (const plan of plans) onStartUnite(this, plan);
    this._uniteLeftKey = null;
    this.runner = new FieldRunner(this, this.fields, {
      onTick: (runner) => this._uniteTick(runner),
      onDone: (runner) => {
        if (this.phase !== PHASE.UNITE) return;
        const results = this.fields.map((f) => {
          const res = runner.resultOf(f);
          this._collectSimErrors(f, res);
          f.live = false;
          return res;
        });
        this.deadline = 0;
        this.markPublic();
        this.later(this.scaled(DELAYS.COMBAT_END), () => this.settle(plans, results));
      },
    });
    this.runner.start();
  }

  /**
   * Battle options of the 联防 field (helpers' carried end state, the leakers' enemies) on the round's battlefield, its
   * terrain, crates, water, devices and runes included (unite.js header; the owner's decision of 2026-10-07 — 0.2.0's
   * escaped-level map is withdrawn). The field meta and the client-run spec carry the match stageId, so every viewer
   * draws the battlefield the boards stand on.
   */
  _uniteOpts(plan, limit, i = 0, multi = false) {
    const { wave, players } = uniteBattleOpts(this, plan, limit);
    return {
      seed: deriveSeed(this.seed, multi ? `u:${this.round}:${i}` : `u:${this.round}`),
      kind: 'unite',
      modeId: this.modeId,
      round: this.round,
      stageId: this.stageId,
      rect: { ...GEO.UNITE_RECT },
      timeLimit: limit,
      players,
      spawns: this._sanitizeSpawns(wave.spawns),
      routes: wave.routes,
      sharedBoss: null,
      flags: { layerGainsEnabled: false, ...this.gd.dp },
      fieldId: multi ? `u${i}` : 'u',
      // leaked enemies re-enter with the stats they had: the round template's stat overrides apply again
      enemyOverrides: this.wave && this.wave.overrides ? this.wave.overrides : {},
      waveId: wave.templateId,
    };
  }

  _startUniteClient(plans) {
    this.phase = PHASE.UNITE;
    this.unitePlans = plans;
    this.unitePlan = mergedUniteView(plans);
    const multi = plans.length > 1;
    const limit = this.wave ? this.wave.timeLimit : 60;
    const fields = plans.map((plan, i) => this._ccField({ fieldId: multi ? `u${i}` : 'u', kind: 'unite', players: plan.helpers.map((p) => p.playerId), opts: this._uniteOpts(plan, limit, i, multi) }));
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this.watchers.clear();
    this._launch(fields);
    // helpers and everyone else (as observers, spectator seats included) simulate the 联防 spec locally. 2V2: every
    // viewer runs/watches the 联防 field of its own team (a viewer with no team on the field falls back to the first).
    for (const ps of this._viewers()) {
      const f = this._uniteFieldFor(ps) || fields[0];
      if (!f) continue;
      const own = f.players.includes(ps.playerId);
      this.watchers.set(ps.playerId, f.fieldId);
      this._sendStart(ps.playerId, f, { watch: !own });
    }
    this.markPublic();
    this._uniteTicker(plans);
  }

  /** The 联防 opening line: in 2V2 each team hears only its OWN battle's helpers (the two teams are separate games). */
  _uniteTicker(plans) {
    const text = (list) => msg('联防阶段：{names} 迎战突破防线的敌人', { names: list.map((p) => p.name) });
    if (!this.isVersus) { this.tickerText(text(plans.flatMap((p) => p.helpers)), FLOW_TICKER_PRIORITY); return; }
    for (const plan of plans) {
      if (!plan.helpers.length) continue;
      this.tickerText(text(plan.helpers), FLOW_TICKER_PRIORITY, this.teamIdOf(plan.helpers[0]));
    }
  }

  /** The running 联防 field of ps's own team, or null (coop: the single field). */
  _uniteFieldFor(ps) {
    const plans = this.unitePlans || [];
    const t = this.teamIdOf(ps);
    const i = plans.findIndex((pl) => pl.team === t);
    return i >= 0 ? (this.fields[i] || null) : null;
  }

  _finishUniteClient() {
    if (this.phase !== PHASE.UNITE) return;
    const plans = this.unitePlans || [];
    const results = this.fields.map((f) => { const res = f.result; this._collectSimErrors(f, res); f.live = false; return res; });
    this._stopClientCombat();
    this.deadline = 0;
    this.markPublic();
    this.later(this.scaled(DELAYS.COMBAT_END), () => this.settle(plans, results));
  }

  /**
   * 联防 (user playtest #6 item 7; PRTS 卫戍协议/帮助 "防卫失败的玩家可通过上方信息栏确认自身所属敌人的剩余数量"): how many of
   * a leaker's enemies are still standing on the 联防 field — not spawned yet, alive, or through the objective again —
   * plus its leaks that could not re-enter: what settle() charges it (before the per-round cap) if the 联防 ended now.
   * It falls as the helpers strike them down; a split or a summon raises nothing (a 联防 field tags its runtime spawns
   * `uniteRuntime`, spawns.js — they never crossed the leaker's own goal, so they are neither billed nor shown here).
   * Live from the field (client run: the authority's b.progress `left`; server run: the headless timeline on the field
   * clock, or the streamed battle itself), clamped to what the escaped wave sent that leaker (fields.js uniteBillBounds:
   * keySourceCounts only — the same set settlement bills); exact once the field has its result (unite.js
   * uniteSurvivors; a synthetic result charges the own leaks, as settle()). null for anyone but a leaker of the running
   * 联防.
   * @returns {number|null}
   */
  _uniteLeft(ps) {
    const plans = this.unitePlans;
    if (this.phase !== PHASE.UNITE || !plans || !ps) return null;
    const idx = plans.findIndex((pl) => pl.leakers.includes(ps));
    if (idx < 0) return null;
    const plan = plans[idx];
    const pid = ps.playerId;
    const f = this.fields[idx] || this.fields.find((x) => x && x.kind === 'unite') || null;
    let res = null;
    if (f && f.cc) res = f.done ? f.result : null;
    else if (f && f.battle && f.battle.finished) { try { res = f.battle.result(); } catch { res = null; } }
    if (res && res.synthetic) {
      const own = this.lastResults.get(pid);
      return own && Array.isArray(own.leaked) ? own.leaked.filter((l) => l && l.counted !== false).length : 0;
    }
    if (res) return uniteSurvivors(plan, res).get(pid) || 0;
    const sent = plan.leaked.filter((l) => l.sourcePlayerId === pid).length;
    let live = null;
    if (f && f.cc) {
      if (f.mode === 'server' && f.timeline) {
        // the sample is [gt, killed, total, resolved(, left)]: a 联防 sample's `left` is its 5th element
        const sample = timelineAt(f.timeline, this._fieldElapsed(f));
        live = sample && sample[4] && typeof sample[4] === 'object' ? sample[4] : null;
      } else live = f.progress && f.progress.left && typeof f.progress.left === 'object' ? f.progress.left : null;
    } else if (f && f.battle) {
      try { live = uniteLeft(f.battle); } catch { live = null; }
    }
    if (!this._uniteBounds || this._uniteBounds.plan !== plan) this._uniteBounds = { plan, bounds: uniteBillBounds(plan.leaked, this.gd) };
    const bound = this._uniteBounds.bounds.get(pid) ?? sent;
    const standing = live ? Math.min(bound, Math.max(0, Math.trunc(Number(live[pid]) || 0))) : sent;
    return standing + (plan.notReentered.get(pid) || 0);
  }

  /** Server-run 联防 (streaming mode): refresh m.public about once a game second when a leaker's count moved. */
  _uniteTick(runner) {
    const fields = runner && runner.fields ? runner.fields : null;
    if (!fields || runner.ticks % 30 !== 0) return;
    let key = '';
    for (const f of fields) {
      if (!f || !f.battle) continue;
      try { key += JSON.stringify(uniteLeft(f.battle)); } catch { /* ignore */ }
    }
    if (key === this._uniteLeftKey) return;
    this._uniteLeftKey = key;
    this.markPublic();
  }
}

/**
 * The union of the round's 联防 plans (m.public `unite`, statusOf, and the `m.unitePlan` field the tests/UI read;
 * one plan in coop, one per team in 2V2). Carries the full plan shape — `leaked` and `notReentered` merged — so
 * uniteSurvivors() and existing readers keep working; `team` stays set only when there is a single plan.
 * @param {any[]} plans
 * @returns {object | null}
 */
function mergedUniteView(plans) {
  if (!plans.length) return null;
  const notReentered = new Map();
  for (const p of plans) for (const [pid, n] of p.notReentered) notReentered.set(pid, (notReentered.get(pid) || 0) + n);
  return {
    helpers: plans.flatMap((p) => p.helpers),
    leakers: plans.flatMap((p) => p.leakers),
    leaked: plans.flatMap((p) => p.leaked),
    notReentered,
    team: plans.length === 1 ? plans[0].team : null,
  };
}
