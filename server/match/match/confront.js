// server/match/match/confront.js — Match methods: the 狩猎期. Two modes share this module:
//
//   2V2 ('versus') — PHASE.CONFRONT. From the drawn contest round on, after each side's prep, every ALIVE player
//   intervenes once, against ONE opposing player:
//
//   step 1 (targets, VERSUS_CONFRONT.targetSeconds): each player names the opponent they attack. Inside a team it is
//     first come, first served — whoever submits first picks, and the teammate is given the opponent that is left (A
//     takes C, B gets D), so the two teams are paired one-to-one and every player both attacks and is attacked. The step
//     ends once every alive player holds a target (both sides — a side that finished early waits) or its window runs out.
//   step 2 (monsters): each player fills their own VALUE BUDGET with monsters of ONE of the 6 groups, each on a gate
//     (上路 'upper' / 下路 'lower') and all inserted at one place in the wave (position: front / mid / back = 25 / 50 /
//     75 % of the round's monster count). The step has no fixed length of its own: its window is THIS round's prep time
//     (untimed when the prep is) and it is a CAP only — submitting ends it as soon as EVERY alive player has
//     (maybeFinishConfront), so the sides never wait on a player who is already done.
//
//   同盟狩猎 (co-op, COOP_HUNT) — no phase, no submissions: the SYSTEM fills each alive player's 狩猎期 with its own
//   deployment (coopHuntPlans), using the same rhythm / budget / bounty tables (huntCfg). The prey is INSERTED into that
//   player's wave and its kills are banked at 坎诺特.
//
//   事件期 boss 格 (user 2026-10-21): on the 事件期 rounds only (match.eventRounds = E1 / E2 / R13 — the R4 / R8 / R13 of a
//   R4 start) step 2 adds ONE more slot offering the whole 机变悬赏 monster pool (data/choices.json `bountyDrafts`: every
//   drafted card's enemyKey and its adds[].enemyKey, ~81 monsters, each priced at the highest coin tier its cards give
//   it). A boss costs NO budget and counts against no maxPicks, one pick per monster per submission (sub.bosses); it is
//   placed on the TARGET's wave AFTER every other spawn and pays its killer the pool coin DIRECTLY as gold
//   (`bounty.bank: false` — economy.js addCoins), never the 坎诺特 赏金 account. [ASSUMED] bots / 托管 never use the
//   slot (botConfront stays deterministic and boss-free).
//
// After the 2V2 roster is complete the 悬赏名单 is held for VERSUS_CONFRONT.rosterMs (CONFRONT_ROSTER_MS) before COMBAT.
//
// The budget (confrontBudget) = the round's own wave value × the 5→15 % share (50 % on the R13 最终狩猎 round) ×
// VERSUS_CONFRONT.budgetMul, per PLAYER (each counts on its own) — both teams face the same (synced) wave, so both get
// the same number. The groups are the OFFICIAL 特训敌人 types (特异 / 飞行 / 频次 / 元素 / 持续 / 隐匿 / 折射), NOT equal
// value buckets: the player picks a flavour (user decision 2026-10-17). A monster's cost and the wave's value are one
// unit: the formula carries the round's hp/atk scaling (confrontValue) AND the monster's graded 特性 score
// (confrontTraits.js, 30 % of the whole table — confrontValueOf / confrontTraitStep).
//
// Applying: the placed monsters of an intervention land on ITS TARGET's wave only (confrontFor), replacing originals
// worth `share × the wave value` picked at random (as close to that value as whole monsters allow, priced with
// confrontValueOf), inserted at the chosen position. The opponent never sees who is aiming at whom (m.public isolation)
// — the panel shows the opponents as '?'. 同盟狩猎 is the one difference: its prey REPLACES nothing (the wave keeps
// every original) and lands in the owning player's own wave (applyCoopHunt).
// Installed on Match.prototype like the other method containers.
import { PHASE, ERR, VERSUS_CONFRONT, COOP_HUNT, merchantRateFor, merchantCapFor } from '../../../shared/constants.js';
import { confrontTraitGrade } from './confrontTraits.js';
import { gateOf, roundMods, previewInfo } from '../waves.js';
import { OK, fail } from './common.js';

/**
 * value(enemy, scale) — the 对抗期 STAT scoring formula: HP-primary, attack ×2, defence ×2, resistance ×15, the leader
 * (lpr > 1) HP bonus and 60 per block. FLYING enemies count as 2 blocks (the user's rule): a ground blocker cannot stop
 * them, so they are worth an extra block. `scale` is the round's hp/atk multiplier (gd.enemyScale), which makes a card's
 * value and the round's wave value comparable.
 *
 * This is the STAT half only. The 特性 (trait) half is an absolute addend added by Match.confrontValueOf from the graded
 * table (confrontTraits.js) — so a pure stat stick keeps exactly this number, and the graded part takes
 * VERSUS_CONFRONT.traitShare (30 %) of the whole value table.
 * @param {any} e data/enemies.json record
 * @param {{ hpMul?: number, atkMul?: number }|null} scale
 */
export function confrontValue(e, scale = null) {
  const s = (e && e.stats) || {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const hp = num(s.maxHp) * (Number.isFinite(scale && scale.hpMul) ? scale.hpMul : 1);
  const atk = num(s.atk) * (Number.isFinite(scale && scale.atkMul) ? scale.atkMul : 1);
  const blocks = e && e.isFlyEnemy ? 2 : num(s.blockCnt);
  const stat = hp + atk * 2 + num(s.def) * 2 + num(s.res) * 15 + Math.max(0, num(s.lpr) - 1) * hp * 0.6 + blocks * 60;
  // 远程怪 (applyWay RANGED) 能越过阻挡输出，价值按 1.5 倍计价（维护者 2026-10-18）。
  // 与特性分同处一个价值表：confrontTraitStep 用同一个 confrontValue 标定，所以特性仍占整表 30%。
  const ranged = e && e.applyWay === 'RANGED' ? 1.5 : 1;
  return Math.round(stat * ranged);
}

/** The enemies normal waves really spawn: factions.json `templateSlots` + every type's `pool` / `entries`. */
export function confrontPool(factions) {
  const pool = new Set();
  for (const v of Object.values((factions && factions.templateSlots) || {})) if (typeof v === 'string') pool.add(v);
  for (const t of Object.values((factions && factions.types) || {})) {
    for (const k of t.pool || []) pool.add(k);
    for (const k of t.entries || []) pool.add(k);
  }
  return [...pool];
}

/**
 * The 狩猎期 groups are the OFFICIAL 特训敌人 types (data/factions.json `types`), one group per type in the data's own
 * order — the player picks a FLAVOR (隐匿 / 折射 / 飞行 …), never a strength (user decision 2026-10-17; the groups are
 * deliberately NOT equal-valued any more — the type sizes differ: 特异 35 enemies, 频次 10).
 *
 * An enemy may be offered by SEVERAL types when the data lists it in both (宿主士兵 is 特异 AND 隐匿) — it then shows
 * up in each of them. These template-slot enemies carry NO type in the data at all, so they are hand-assigned
 * (CONFRONT_GROUP_EXTRA) to keep the promise that every pool enemy is offered somewhere (test/match/versus.test.js).
 *
 * @param {object} factions data/factions.json
 * @param {(key: string) => { key: string, name: string, value: number }} rowOf
 * @returns {Array<{ id: string, name: string, icon: string|null, desc: string, rows: object[] }>}
 */
export function confrontTypeGroups(factions, rowOf, extra = CONFRONT_GROUP_EXTRA) {
  const types = (factions && factions.types) || {};
  const inPool = new Set(confrontPool(factions));
  const out = [];
  for (const [id, t] of Object.entries(types)) {
    const keys = new Set([...(t.pool || []), ...(t.entries || []), ...(extra[id] || [])]);
    const rows = [...keys].filter((k) => inPool.has(k)).map((k) => rowOf(k))
      .sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)));
    out.push({ id, name: t.name || id, icon: t.icon || null, desc: t.desc || '', rows });
  }
  return out;
}

/**
 * The template-slot enemies the official type lists leave out (they are a wave's guaranteed spawns, not 特训): assigned
 * by mechanic — 灵幛 hits everything around it (特异), 暴鸰 is a flying bomber (飞行), 枯朽前锋 / 孽罪奇美拉 spread
 * 源石污染 (持续).
 */
const CONFRONT_GROUP_EXTRA = Object.freeze({
  SPECIAL: ['enemy_1427_lrnazg'],
  FLY: ['enemy_1040_bombd'],
  DOT: ['enemy_1422_lrsldr', 'enemy_1425_lrcmra'],
});

/**
 * The 事件期 boss 格's monster pool and prices (user 2026-10-21): every monster the 机变悬赏 card pool can put on a card —
 * each card of choices.json `bountyDrafts` (initial / boss / hunter) contributes its `enemyKey` AND its `adds[].enemyKey`
 * (~81 monsters today). A monster's coin is the HIGHEST tier it ever appears at across ALL the cards (adds included):
 * eight monsters are priced at several tiers (e.g. 2 / 1 / 3) and pay the top one.
 * @param {object} choices gd.choices (data/choices.json, the same source server/match/choices.js reads)
 * @returns {Map<string, number>} enemyKey → its highest coin tier (0 when no card prices it)
 */
export function confrontBossCoins(choices) {
  const cards = Array.isArray(choices && choices.cards && choices.cards.bounty) ? choices.cards.bounty : [];
  const byId = new Map(cards.map((c) => [c.effectId, c]));
  const drafts = (choices && choices.bountyDrafts) || {};
  const pool = new Set();
  for (const kind of ['initial', 'boss', 'hunter']) {
    for (const g of (drafts[kind] && drafts[kind].groups) || []) {
      for (const id of g.cards || []) {
        const c = byId.get(id);
        if (!c) continue;
        if (c.enemyKey) pool.add(c.enemyKey);
        for (const a of c.adds || []) if (a.enemyKey) pool.add(a.enemyKey);
      }
    }
  }
  const out = new Map([...pool].map((k) => [k, 0]));
  const note = (key, coin) => {
    if (!out.has(key)) return;
    const n = Math.trunc(Number(coin) || 0);
    if (n > out.get(key)) out.set(key, n);
  };
  for (const c of cards) {
    note(c.enemyKey, c.coin);
    for (const a of c.adds || []) note(a.enemyKey, a.coin);
  }
  return out;
}

export class MatchConfront {
  /**
   * The 狩猎期 rule table of THIS match: the 2V2 table, or 同盟狩猎's (COOP_HUNT) in a co-op room. Both carry the same
   * HUNT_RHYTHM; reading through here is what lets the budget / bounty / merchant code serve both modes without a copy.
   */
  huntCfg() { return this.isVersus ? VERSUS_CONFRONT : COOP_HUNT; }

  /** The 对抗期 is active in the versus mode from the drawn contest round on, on normal (non-boss) rounds. */
  confrontActive() {
    return this.isVersus && this.contestStartRound != null
      && this.round >= this.contestStartRound && this.round < this.gd.bossRound;
  }

  /**
   * 同盟狩猎 (COOP_HUNT): the co-op room's system-run 狩猎期 — from the drawn start round on, on normal (non-boss)
   * rounds. R14/R15 are the unchanged boss rounds, so they never carry a hunt.
   */
  coopHuntActive() {
    return !this.isVersus && this.coopHuntOn && this.contestStartRound != null
      && this.round >= this.contestStartRound && this.round < this.gd.bossRound;
  }

  /** A 狩猎期 of either kind (2V2's 对抗期 or the co-op hunt) — used by the shared merchant / event gates. */
  huntActive() { return this.isVersus ? this.confrontActive() : this.coopHuntActive(); }

  /**
   * 同盟狩猎 本回合投放公示 (user 2026-10-17): after PREP ends — every seat ready or its deadline — the round holds for
   * CONFRONT_ROSTER_MS (5 s, the same constant as the 2V2 悬赏名单) before COMBAT, showing every player what the system
   * deployed at them. The phase stays PREP, `confrontStage = 'roster'` and `coopRoster` publishes m.public.confront.
   *
   * Server-timed through setDeadline → later → scaled (virtual time and goldens agree). Idempotent: while the roster is
   * open this returns false and never arms a second timer, so two engine calls (all-ready + deadline, or two hunt rounds
   * back to back) cannot stack the hold. A non-hunt round / R14 / R15 never opens it.
   * @returns {boolean} whether a roster hold was opened now
   */
  enterCoopHuntRoster() {
    if (this.phase !== PHASE.PREP || this.confrontStage === 'roster' || !this.coopHuntActive()) return false;
    const ms = Math.max(0, Number(this.huntCfg().rosterMs) || 0);
    if (!(ms > 0)) return false;
    this.confrontStage = 'roster';
    this.coopRoster = true;
    this.setDeadline(ms / 1000, () => this.finishCoopHuntRoster());
    this.markPublic();
    return true;
  }

  /** The coop 投放公示's hold expired: clear it and start the round's battles. */
  finishCoopHuntRoster() {
    if (this.phase !== PHASE.PREP || this.confrontStage !== 'roster' || !this.coopRoster) return;
    this.setDeadline(0);
    this.confrontStage = null;
    this.coopRoster = false;
    this.startCombat();
  }

  /**
   * The public plans of the coop 投放公示: ONE row per alive player, public information only — the assigned official
   * 特训敌人 category / its name, the deployment's total value, its monster count and the picks (name + priced value).
   * Never the budget, the gates / positions or the internal bounty coins.
   * @returns {Array<{ playerId: string, seat: number, category: string|null, categoryName: string, value: number, count: number, picks: Array<{ name: string, value: number }> }>}
   */
  coopHuntRosterPlans() {
    const plans = this.coopHuntPlans();
    if (!plans) return [];
    const groups = new Map(this.confrontGroups().map((g) => [g.id, g]));
    const out = [];
    for (const ps of this.alivePlayers().slice().sort((a, b) => a.seat - b.seat)) {
      const p = plans.get(ps.playerId);
      if (!p) continue;
      const g = groups.get(p.category);
      out.push({
        playerId: ps.playerId,
        seat: ps.seat,
        category: p.category,
        categoryName: g ? g.name : (p.category || ''),
        value: p.value,
        count: p.count,
        picks: p.picks.map((x) => {
          const e = this.gd.enemy(x.enemyKey);
          return { name: e ? e.name : x.enemyKey, value: this.confrontValueOf(x.enemyKey) };
        }),
      });
    }
    return out;
  }

  /**
   * The share of the opponent's original wave a team may replace (and the share of its value it may spend) this round:
   * 5 % at R_contest, +2 %/round, capped at 15 % (VERSUS_CONFRONT.ratioBase / Step / Max). R13 is the 最终狩猎 (hunt) round
   * — a flat 50 %, the one round the intervention can gut a wave.
   */
  confrontRatio() {
    const cfg = this.huntCfg();
    if (this.round === cfg.huntRound) return cfg.huntRatio;
    const r = this.round - this.contestStartRound + 1;
    return Math.min(cfg.ratioMax, cfg.ratioBase + cfg.ratioStep * (r - 1));
  }

  /** Whether THIS round is the 最终狩猎 (R13) — the one with the flat, much larger share and the fixed 25 bounty. */
  confrontHunt() { return this.round === this.huntCfg().huntRound; }

  /** The round's hp/atk scaling: card costs and the wave value are both in its unit. */
  confrontScale() { return this.gd.enemyScale(this.round); }

  /**
   * The absolute 特性 (trait) score of ONE grade step, in this round's currency: the graded part is
   * `step × (grade − 1)`, and `step` is calibrated so the graded part is exactly `VERSUS_CONFRONT.traitShare`
   * (30 %) of the whole value table — Σ(step·(g−1)) = share/(1−share) · Σ(stat value) over the confront pool
   * (confrontTraits.js holds the grades). Recomputed when the round's scaling moves the stat values.
   */
  confrontTraitStep() {
    const scale = this.confrontScale();
    const sig = `${this.round}|${scale.hpMul}|${scale.atkMul}`;
    if (this._traitStep != null && this._traitStepSig === sig) return this._traitStep;
    const en = (this.data && this.data.enemies) || {};
    const scores = this.huntCfg().traitStepScores;
    const share = Math.max(0, Math.min(0.9, Number(this.huntCfg().traitShare) || 0));
    let stat = 0;
    let steps = 0;
    const times = this.confrontTimesKeys();
    for (const k of confrontPool(this.data && this.data.factions)) {
      if (!en[k]) continue;
      // the same stat half confrontValueOf prices: 频次怪's manual 1.5× (user 2026-10-21) is part of the table's base
      stat += Math.round(confrontValue(en[k], scale) * (times.has(k) ? 1.5 : 1));
      steps += scores[confrontTraitGrade(k) - 1] || 0;
    }
    this._traitStep = steps > 0 ? Math.round((share / (1 - share)) * stat / steps) : 0;
    this._traitStepSig = sig;
    return this._traitStep;
  }

  /**
   * The value of ONE enemy in this match's currency: its stats at `scale` (default: this round's) plus its graded 特性
   * score. Every value the 狩猎期 uses — the group rows, the wave total, a submission's cost and a kill's bounty — goes
   * through here, so the traits are priced exactly once.
   * @param {string} enemyKey
   * @param {{ hpMul?: number, atkMul?: number }|null} scale
   */
  confrontValueOf(enemyKey, scale = null) {
    const en = (this.data && this.data.enemies) || {};
    const e = en[enemyKey];
    if (!e) return 0;
    const step = this.huntCfg().traitStepScores[confrontTraitGrade(enemyKey) - 1] || 0;
    // 频次怪 (factions.types.TIMES, user 2026-10-21): priced 1.5× by hand — the same 增值 treatment 远程怪 (applyWay
    // RANGED) got on 2026-10-18 (confrontValue's stat half × 1.5), so the trait half is untouched and keeps its share.
    // A monster that is BOTH 频次 and 远程 stacks the two multipliers (×2.25 on the stat half).
    const times = this.confrontTimesKeys().has(enemyKey) ? 1.5 : 1;
    return Math.round(confrontValue(e, scale || this.confrontScale()) * times) + this.confrontTraitStep() * step;
  }

  /** The 频次怪 (TIMES) type's monster keys (pool + entries), cached — confrontValueOf prices them 1.5× (user 2026-10-21). */
  confrontTimesKeys() {
    if (!this._confrontTimesKeys) {
      const types = (this.data && this.data.factions && this.data.factions.types) || {};
      const times = types.TIMES || {};
      this._confrontTimesKeys = new Set([...(times.pool || []), ...(times.entries || [])]);
    }
    return this._confrontTimesKeys;
  }

  /**
   * The four 特训敌人 types shown this round (same for both teams): two UP types + two normal, all distinct. The draw is
   * seeded per round (rngConfrontTypes) and cached, so opening the panel / a reconnect shows the same four cards.
   * `all` / `budget` let the draw guarantee that at least one offered type has a monster the round's budget can afford;
   * an empty/unplayable board would otherwise be possible from a four-type subset.
   * @param {Array<{ id: string, rows: Array<{ value: number }> }>} [all]
   * @param {number} [budget]
   * @returns {{ round: number, ids: string[], up: Set<string> }}
   */
  confrontTypeDraw(all = [], budget = null) {
    const round = this.round;
    if (this._confrontTypeDraw && this._confrontTypeDraw.round === round) return this._confrontTypeDraw;
    const ids = all.length ? all.map((g) => g.id) : Object.keys((this.data && this.data.factions && this.data.factions.types) || {});
    const pool = ids.slice();
    const up = [];
    for (let i = 0; i < 2 && pool.length; i++) {
      const k = Math.floor(this.rngConfrontTypes() * pool.length);
      up.push(pool.splice(Math.max(0, Math.min(pool.length - 1, k)), 1)[0]);
    }
    const normal = [];
    for (let i = 0; i < 2 && pool.length; i++) {
      const k = Math.floor(this.rngConfrontTypes() * pool.length);
      normal.push(pool.splice(Math.max(0, Math.min(pool.length - 1, k)), 1)[0]);
    }
    let picked = [...up, ...normal];
    // a four-type draw must still let every seat place at least one monster within this round's value budget
    const b = Number(budget);
    const selected = new Set(picked);
    if (Number.isFinite(b) && b > 0 && !all.some((g) => selected.has(g.id) && (g.rows || []).some((r) => Number(r.value) <= b))) {
      const alt = all.filter((g) => !selected.has(g.id) && (g.rows || []).some((r) => Number(r.value) <= b))
        .sort((x, y) => Math.min(...x.rows.map((r) => Number(r.value) || Infinity)) - Math.min(...y.rows.map((r) => Number(r.value) || Infinity)))[0];
      if (alt) {
        const slot = picked.findIndex((id) => !up.includes(id));
        if (slot >= 0) picked[slot] = alt.id;
      }
    }
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(this.rngConfrontTypes() * (i + 1));
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }
    this._confrontTypeDraw = { round, ids: picked, up: new Set(up) };
    return this._confrontTypeDraw;
  }

  /**
   * The groups offered in the 狩猎期: four of the official 特训敌人 types (two UP + two normal, drawn once per round),
   * each carrying its pool members priced in this round's currency (confrontValueOf). Recomputed when the round changes.
   * @returns {Array<{ id: string, name: string, icon: string|null, desc: string, up: boolean, rows: Array<{ key: string, name: string, value: number }> }>}
   */
  confrontGroups() {
    const scale = this.confrontScale();
    const sig = `${this.round}|${scale.hpMul}|${scale.atkMul}`;
    if (this._confrontGroups && this._confrontSig === sig) return this._confrontGroups;
    const en = (this.data && this.data.enemies) || {};
    const all = confrontTypeGroups(this.data && this.data.factions, (k) => ({
      key: k, name: (en[k] && en[k].name) || k, value: this.confrontValueOf(k, scale),
    }));
    const byId = new Map(all.map((g) => [g.id, g]));
    // 最终狩猎 (R13) keeps the original 7-type panel; the 4-card draw (2 UP + 2 normal) is for the earlier hunt rounds.
    if (this.confrontHunt()) {
      this._confrontGroups = all.map((g) => ({ ...g, up: false }));
    } else {
      const draw = this.confrontTypeDraw(all, this.huntDeployBudget());
      this._confrontGroups = draw.ids.map((id) => byId.get(id)).filter(Boolean)
        .map((g) => ({ ...g, up: draw.up.has(g.id) }));
    }
    this._confrontSig = sig;
    return this._confrontGroups;
  }

  /**
   * The 事件期 boss 格 is open THIS round (user 2026-10-21): the boss slot exists only on the event rounds
   * (match.eventRounds = E1 / E2 / R13 — the R4 / R8 / R13 of a R4 start), so the rounds in between never offer it and a
   * `bosses` list on such a round is refused. [ASSUMED] the submission carries the same gate as the panel.
   */
  confrontBossOpen() {
    return this.isVersus && Array.isArray(this.eventRounds) && this.eventRounds.includes(this.round);
  }

  /**
   * How many bosses ONE submission may name this round (user 2026-10-21, after playtest): the cap is the EVENT's own
   * ordinal — 1 boss on the round of the 1st event, 2 on the 2nd, 3 on the 3rd (R4 / R8 / R13 of a R4 start). Zero on
   * every round the slot does not exist on. The panel greys the rest out at the cap and the server refuses more
   * (ERR.CONFRONT_COUNT), so "不限数量" from the first draft is gone.
   */
  confrontBossCap() {
    if (!this.confrontBossOpen() || !Array.isArray(this.eventRounds)) return 0;
    return Math.max(0, this.eventRounds.indexOf(this.round) + 1);
  }

  /**
   * The boss 格's pool (confrontBossCoins), named through gd.enemy: every 机变悬赏 monster, at its highest coin tier.
   * Data, not round state — computed once and cached, sorted by key so the panel order is stable.
   * @returns {Array<{ key: string, name: string, coin: number }>}
   */
  confrontBossPool() {
    if (this._confrontBossPool) return this._confrontBossPool;
    const coins = confrontBossCoins(this.gd.choices);
    this._confrontBossPool = [...coins.entries()]
      .map(([key, coin]) => ({ key, name: (this.gd.enemy(key) && this.gd.enemy(key).name) || key, coin }))
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));
    return this._confrontBossPool;
  }

  /** The coins ONE boss pays its killer in gold when it dies (its pool's highest tier; 0 outside the pool). */
  confrontBossCoin(enemyKey) {
    if (!this._confrontBossCoins) this._confrontBossCoins = new Map(this.confrontBossPool().map((r) => [r.key, r.coin]));
    return this._confrontBossCoins.get(enemyKey) || 0;
  }

  /** The round's original wave spawns (every team faces the same synced one). */
  _confrontWaveSpawns() { return (this.wave && this.wave.spawns) || []; }

  /** The value of the round's original wave, at this round's scaling. */
  confrontWaveValue() {
    const scale = this.confrontScale();
    let v = 0;
    for (const s of this._confrontWaveSpawns()) {
      const cnt = Math.max(1, Math.floor(Number(s.count) || 1));
      v += this.confrontValueOf(s.enemyKey, s.mods || scale) * cnt;
    }
    return v;
  }

  /** The round's monster count (Σ counts) — the base of the insertion positions (25 / 50 / 75 %). */
  confrontWaveCount() {
    return this._confrontWaveSpawns().reduce((n, s) => n + Math.max(1, Math.floor(Number(s.count) || 1)), 0);
  }

  /**
   * 2V2's placement budget: the wave value × the share × VERSUS_CONFRONT.budgetMul — PER PLAYER (个算个的). The 2V2
   * placement REPLACES originals, so its ×2 keeps the net addition at the share; the co-op hunt INSERTs its prey and
   * therefore uses `wave value × share` only (coopHuntPlans).
   */
  confrontBudget() {
    return Math.round(this.confrontWaveValue() * this.confrontRatio() * this.huntCfg().budgetMul);
  }

  /**
   * What ONE seat can spend this round in the current mode — the budget the type-draw's affordability floor must use.
   * 2V2 spends `confrontBudget()` (×budgetMul = 2, per player); 同盟狩猎 inserts its prey, so a seat only gets
   * `wave value × share` (coopHuntPlans). Using the 2V2 number for co-op would let an unplayable 4-type draw through.
   */
  huntDeployBudget() {
    if (this.isVersus) return this.confrontBudget();
    return Math.round(this.confrontWaveValue() * this.confrontRatio());
  }

  /** Σ value of a set of picks, at this round's scaling. */
  confrontSpent(picks) {
    const scale = this.confrontScale();
    let v = 0;
    for (const p of picks || []) v += this.confrontValueOf(p && p.enemyKey, scale);
    return v;
  }

  /**
   * This bounty phase's 1-based index in the match — the "第几次狩猎期" of the rule below, independent of which round
   * (R4 / R5 / R6) the competition started in. Same counter confrontRatio uses.
   */
  confrontHuntIndex() {
    if (this.contestStartRound == null) return 0;
    return Math.max(0, this.round - this.contestStartRound + 1);
  }

  /**
   * The FIXED bounty of this bounty phase, or null when the phase runs the live formula:
   *   * the R13 最终狩猎: VERSUS_CONFRONT.finalHuntBounty (25), scaled by the kill ratio;
   *   * the 1st–4th phase: VERSUS_CONFRONT.bountyCaps = [1, 1, 2, 2];
   *   * from the 5th on (R13 aside): the live formula — `Σ value(killed) / wave value × the round's income ×
   *     killIncomeShare`, no cap, no per-monster floor.
   */
  confrontFixedBountyCap() {
    if (this.confrontHunt()) return this.huntCfg().finalHuntBounty;
    const caps = this.huntCfg().bountyCaps;
    const i = this.confrontHuntIndex();
    return i >= 1 && i <= caps.length ? caps[i - 1] : null;
  }

  /**
   * What a whole placement has paid once its first `killed` monsters (in insertion order) are down — always an integer:
   *   fixed phases:  floor(cap × killed / total),  cap = bountyCaps[huntIdx − 1] or finalHuntBounty on R13
   *   live phases:   floor(Σ value of those monsters / wave value × the round's income × killIncomeShare)
   * Full clear = cap (fixed) / the whole formula value (live), all leaked = 0; a single cheap monster out of many pays
   * its share, i.e. 0 unless it completes a whole coin — no `min 1` anywhere (that floor was the farm).
   * @param {number} killed
   * @param {object[]} picks the placement, in insertion order
   */
  confrontBountyAt(killed, picks) {
    const list = picks || [];
    const n = list.length;
    if (!n) return 0;
    const k = Math.max(0, Math.min(n, Math.floor(Number(killed) || 0)));
    const cap = this.confrontFixedBountyCap();
    if (cap != null) return Math.floor((cap * k) / n);
    const wave = Math.max(1, this.confrontWaveValue());
    const income = Number(this.gd.income(this.round)) || 0;
    const cfgShare = Number(this.huntCfg().killIncomeShare) > 0 ? Number(this.huntCfg().killIncomeShare) : 1;
    let v = 0;
    for (let i = 0; i < k; i++) v += this.confrontValueOf(list[i] && list[i].enemyKey);
    return Math.floor((v / wave) * income * cfgShare);
  }

  /**
   * What ONE placement pays, monster by monster: `coins[i] = B(i) − B(i−1)` (B = confrontBountyAt). Each kill adds its
   * fractional share to the accumulator, and gold is paid only when the integer part grows — a monster may pay 0 — so
   * the running total is exactly B(killed) and the sum of the array is exactly B(total): no per-kill rounding drift and
   * no way to farm: sending 64 of the cheapest monsters still totals B(64).
   * @param {object[]} picks
   * @returns {number[]} coins, one per pick (same order)
   */
  confrontBountyPlan(picks) {
    const list = picks || [];
    const n = list.length;
    const out = [];
    for (let i = 1; i <= n; i++) out.push(this.confrontBountyAt(i, list) - this.confrontBountyAt(i - 1, list));
    return out;
  }

  /**
   * The bounty ONE monster of a placement can pay its killer: the listed monsters are inserted one by one, so a
   * single-monster placement is a full clear and pays B(1). Kept as the per-monster lookup the value-table tests use;
   * the SHOWN total of a placement is `confrontBountyOf` below.
   * @param {string} enemyKey
   */
  confrontBounty(enemyKey) { return this.confrontBountyOf([{ enemyKey, gate: 'lower' }]); }

  /**
   * The bounty a whole placement pays when every monster of it dies — what the 悬赏名单 shows next to the pair
   * ("赏金 +N"), and the exact total the sim credits (see confrontBountyPlan for the per-kill split).
   */
  confrontBountyOf(picks) {
    const list = picks || [];
    return this.confrontBountyAt(list.length, list);
  }

  /**
   * 同盟狩猎 (COOP_HUNT): the system's 狩猎期 deployment — ONE plan PER ALIVE PLAYER (user addendum 2026-10-17: co-op is
   * four separate waves, so each player gets their own prey, not one shared batch). Built once when the round's wave is
   * generated (MatchPhases.startRound) and cached for the round.
   *
   * Algorithm (greedy, seeded → fully reproducible):
   *   1. budget = this round's ratio × the player's wave value (co-op prey is INSERTED, so the net addition is exactly
   *      the ratio; 2V2 keeps the ×budgetMul because its placement REPLACES originals, which keeps the same net ratio);
   *      the co-op wave is shared, so the number is the same for everybody, but it is computed per player and stored per
   *      plan;
   *   2. the candidate pool is the official 特训敌人 types (confrontGroups: 特异 / 飞行 / 频次 / 元素 / 持续 / 隐匿 / 折射);
   *   3. the alive players (seat order) are rotated onto the types from a seeded offset, so their MAIN types differ while
   *      the types last (4 players / 7 types → four different types);
   *   4. each player fills from their own type, value-descending: take a monster while it fits, up to maxPicks (this
   *      leaves the budget as full as that type allows);
   *   5. totals must be PAIRWISE DISTINCT. On a collision the later player changes ONE pick — the closest affordable
   *      substitute in their own type, else in the other types, else adds / removes the cheapest pick — until the total
   *      is unique. A full re-fill from another type is the last resort. A player always keeps at least one pick when the
   *      budget can afford one;
   *   6. dead / departed players are not part of the distribution: the rotation and the plans cover the ALIVE seats only,
   *      so their slot passes to the next living player.
   *
   * The bounty is priced HERE, at deployment time (`confrontBountyPlan`), and stored on the plan: the per-kill coins a
   * battle later credits never move when an event card / 强力属性 changes the monster's stats (2V2's rule).
   * @returns {Map<string, object>|null} playerId → plan
   *   Each plan carries `value` = the deployment's total VALUE (well below the budget; the pairwise-distinct rule is
   *   about THIS field) and `count` = how many monsters it holds (1–maxPicks; NOT a total value). `picks` is the list,
   *   `coins` the per-kill banked bounty priced at deployment time.
   */
  coopHuntPlans() {
    if (!this.coopHuntActive()) return null;
    if (this._coopHuntRound === this.round && this._coopHuntPlans) return this._coopHuntPlans;
    const cfg = this.huntCfg();
    const ratio = this.confrontRatio();
    const waveValue = this.confrontWaveValue();
    const groups = this.confrontGroups().filter((g) => g && Array.isArray(g.rows) && g.rows.length);
    const alive = this.alivePlayers().slice().sort((a, b) => a.seat - b.seat);
    // seeded rotation of the MAIN type: four alive players land on four different types (the drawn 4-type panel)
    const offset = groups.length ? Math.floor(this.rngCoopHunt() * groups.length) % groups.length : 0;
    const used = new Set();
    const plans = new Map();
    alive.forEach((ps, i) => {
      const budget = Math.round(waveValue * ratio);
      const gi = groups.length ? (offset + i) % groups.length : 0;
      const group = groups[gi] || null;
      let picks = group ? this._coopFill(group.rows, budget, cfg.maxPicks) : [];
      if (!picks.length) picks = this._coopFill(this._coopUnionRows(groups), budget, cfg.maxPicks);
      let value = this.confrontSpent(picks);
      if (used.has(value)) {
        const alt = this._coopUniquePicks(picks, group, groups, budget, used, cfg.maxPicks);
        if (alt) { picks = alt.picks; value = alt.value; }
      }
      used.add(value);
      const positions = cfg.positions;
      const position = positions[Math.max(0, Math.min(positions.length - 1, Math.floor(this.rngCoopHunt() * positions.length)))];
      plans.set(ps.playerId, {
        round: this.round, playerId: ps.playerId, seat: ps.seat, budget, ratio, value,
        /** the MAIN official 特训敌人 type this seat was assigned (its picks normally all come from it) */
        category: group ? group.id : null, group: gi + 1,
        picks, coins: this.confrontBountyPlan(picks), position,
        /** number of monsters deployed (the total VALUE is `value`) */
        count: picks.length,
      });
    });
    this._coopHuntRound = this.round;
    this._coopHuntPlans = plans;
    return plans;
  }

  /** ONE alive player's system deployment of this round (null when the round has no hunt / they have no plan). */
  coopHuntPlan(ps) {
    const plans = this.coopHuntPlans();
    return plans && ps ? (plans.get(ps.playerId) || null) : null;
  }

  /** The union of every type's rows, de-duplicated by key (a monster may be listed under several types). */
  _coopUnionRows(groups) {
    const seen = new Set();
    const out = [];
    for (const g of groups || []) {
      for (const r of g && Array.isArray(g.rows) ? g.rows : []) {
        if (!r || typeof r.key !== 'string' || seen.has(r.key)) continue;
        seen.add(r.key);
        out.push(r);
      }
    }
    return out;
  }

  /** Greedy fill: rows value-descending, take each monster that still fits (up to maxPicks). Seeded gates. */
  _coopFill(rows, budget, maxPicks = 64) {
    const picks = [];
    let left = budget;
    const sorted = (rows || []).slice().sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)));
    for (const r of sorted) {
      if (picks.length >= maxPicks) break;
      if (!(r.value > 0) || r.value > left) continue;
      left -= r.value;
      picks.push({ enemyKey: r.key, gate: this.rngCoopHunt() < 0.5 ? 'upper' : 'lower' });
    }
    return picks;
  }

  /**
   * Resolve a duplicate total: return the closest pick-set whose total is still affordable and not in `used`, else null.
   * Preference order: one substitute in the player's own type, a substitute in another type, add / remove one pick.
   * The first tie-break is the smallest change, then the player's own type.
   * @returns {{ picks: object[], value: number }|null}
   */
  _coopUniquePicks(picks, mainGroup, groups, budget, used, maxPicks = 64) {
    const val = (key) => this.confrontValueOf(key);
    const total = picks.reduce((s, p) => s + val(p.enemyKey), 0);
    const keys = new Set(picks.map((p) => p.enemyKey));
    const out = [];
    const consider = (next, group) => {
      if (!next.length || next.length > maxPicks) return;
      const v = next.reduce((s, p) => s + val(p.enemyKey), 0);
      if (!(v > 0) || v > budget || used.has(v)) return;
      out.push({ picks: next, value: v, delta: Math.abs(v - total), own: group === mainGroup ? 0 : 1 });
    };
    const order = [mainGroup, ...groups.filter((g) => g !== mainGroup)].filter(Boolean);
    for (const g of order) {
      for (let i = 0; i < picks.length; i++) {
        const cur = picks[i].enemyKey;
        for (const r of g.rows) {
          if (r.key === cur || keys.has(r.key)) continue;
          const next = picks.slice();
          next[i] = { enemyKey: r.key, gate: picks[i].gate };
          consider(next, g);
        }
      }
      if (picks.length < maxPicks) {
        for (const r of g.rows) {
          if (keys.has(r.key)) continue;
          consider([...picks, { enemyKey: r.key, gate: 'lower' }], g);
        }
      }
    }
    if (picks.length > 1) for (let i = 0; i < picks.length; i++) consider(picks.filter((_, j) => j !== i), mainGroup);
    out.sort((a, b) => a.delta - b.delta || a.own - b.own
      || a.picks.map((p) => p.enemyKey).join('|').localeCompare(b.picks.map((p) => p.enemyKey).join('|')));
    if (out.length) return out[0];
    // last resort: a complete re-fill from another type (or the union), still with a unique total
    for (const g of order) {
      const alt = this._coopFill(g.rows, budget, maxPicks);
      const v = this.confrontSpent(alt);
      if (alt.length && !used.has(v)) return { picks: alt, value: v };
    }
    const union = this._coopFill(this._coopUnionRows(groups), budget, maxPicks);
    const v = this.confrontSpent(union);
    return union.length && !used.has(v) ? { picks: union, value: v } : null;
  }

  /**
   * Insert ONE player's system-run prey into their spawn list (同盟狩猎). Co-op players each have their own wave, so each
   * plan is inserted into that player's list at the plan's own position, each monster on the route of its gate. The prey
   * is a bonus target: `countInTotal: false` means a leak costs no 目标生命值 (exactly like a 2V2 placement), only a kill
   * pays.
   *
   * The bounty is the plan's own per-kill split (`plan.coins`, priced at deployment) plus the receiver's 赏金嗅觉
   * (eventBountyBonusOf), and it always carries `bank: true`: 赏金 goes to 坎诺特's account, never to the purse.
   * @param {object[]} spawns the player's wave (already carrying the round's event card / 强力属性)
   * @param {import('../PlayerState.js').PlayerState} ps
   * @returns {object[]} a new list (the input is never mutated)
   */
  applyCoopHunt(spawns, ps) {
    const plan = this.coopHuntPlan(ps);
    if (!plan || !plan.picks.length || !Array.isArray(spawns) || !spawns.length) return spawns;
    const mods = roundMods(this.confrontScale());
    const base = this.wave && Array.isArray(this.wave.spawns) ? this.wave.spawns : spawns;
    const start = this._confrontInsertTime(base, plan.position);
    const scent = typeof this.eventBountyBonusOf === 'function' ? this.eventBountyBonusOf(ps) : 0;
    const { routes, leader } = this._confrontRoutes();
    const out = spawns.slice();
    plan.picks.forEach((p, i) => {
      const routeIndex = this.confrontRouteFor(p.enemyKey, p.gate);
      out.push({
        time: start + i, enemyKey: p.enemyKey, count: 1, interval: 0,
        routeIndex,
        mods: { ...mods }, ownerPlayerId: ps.playerId,
        // the prep preview must show the REAL gate / movement class of an appended prey (previewOf otherwise defaults
        // to lower / ground); `prey` marks it display-only: it is not one of the stage's scheduled enemies, so it is
        // excluded from the HUD capsule's denominator (`countInTotal: false`).
        preview: previewInfo(this.gd, p.enemyKey, routes[routeIndex], false, leader),
        prey: true,
        countInTotal: false,
        bounty: { coins: (plan.coins[i] || 0) + scent, ownerPlayerId: ps.playerId, total: plan.count, index: i, bank: true },
      });
    });
    return out;
  }

  /**
   * 商人「坎诺特」 (user 2026-10-17): a kill bounty on a monster the opponent PLACED never becomes gold — the sim banks
   * it (`unit.bounty.bank`, economy.js addBank) and settle adds it to PlayerState.bountyBank. The ONLY way from 赏金 to
   * 金币 is this withdrawal in prep, at the round's rate (VERSUS_CONFRONT.merchantRates): `cost = gold / rate`, rounded
   * UP on the first withdrawal of a round and DOWN afterwards, at most merchantRoundCap gold a round (R15 uncapped).
   * @param {number} round absolute round number
   */
  merchantRate() { return merchantRateFor(this.round, this.huntCfg()); }

  /** The per-round withdrawal cap of the current round (Infinity in the R15 隐秘核心 round). */
  merchantCap() { return merchantCapFor(this.round, this.huntCfg()); }

  /** The 赏金 a withdrawal of `gold` costs right now (ceil on this round's first, floor afterwards). */
  merchantCost(ps, gold) {
    const g = Math.max(0, Math.trunc(Number(gold) || 0));
    if (!(g > 0)) return 0;
    const raw = g / this.merchantRate();
    // the epsilon keeps exact boundaries exact (4 / 0.2 = 19.999… / 20.000… must cost 20 either way)
    return !ps || !(ps.withdrawnThisRound > 0) ? Math.ceil(raw - 1e-9) : Math.floor(raw + 1e-9);
  }

  /**
   * The 坎诺特 panel of ONE player (m.private.merchant): the banked 赏金, the round's rate and cap, what is left to
   * withdraw this round and the 1 / 2 / 4 / all options with the 赏金 each of them costs. null outside 2V2.
   */
  merchantView(ps) {
    if (!this.huntMode || !ps) return null;
    const rate = this.merchantRate();
    const cap = this.merchantCap();
    const withdrawn = Math.max(0, Math.trunc(Number(ps.withdrawnThisRound) || 0));
    const bank = Math.max(0, Math.trunc(Number(ps.bountyBank) || 0));
    const left = Math.max(0, cap - withdrawn);
    // the gold this bank can buy at all: bank * rate, floored (the cost of g gold is g / rate)
    const affordable = Math.floor(bank * rate + 1e-9);
    const max = Math.max(0, Math.min(left, affordable));
    const options = [1, 2, 4].map((gold) => ({ gold, cost: this.merchantCost(ps, gold), enabled: gold <= max }));
    options.push({ gold: max, cost: max > 0 ? this.merchantCost(ps, max) : 0, enabled: max > 0, all: true });
    return { bank, rate, cap: Number.isFinite(cap) ? cap : null, withdrawn, left: Number.isFinite(left) ? left : null, max, options };
  }

  /**
   * `g.confront.withdraw { gold }` (prep only, 2V2): turn 赏金 into 金币 through 坎诺特. The server owns everything —
   * the rate, the ceil/floor cost, the per-round cap and the balance; the client only sends the intent. Errors:
   * ERR.WRONG_PHASE (not prep / not 2V2), ERR.MERCHANT_CAP (over this round's cap), ERR.MERCHANT_BANK (not enough 赏金),
   * ERR.BAD_TARGET (a non-positive / malformed amount).
   */
  withdrawBounty(ps, { gold } = {}) {
    if (!this.huntMode || this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    // the coop 投放公示 freezes the prep: no withdrawal may change the purse in those 5 s
    if (this.confrontStage === 'roster') return fail(ERR.WRONG_PHASE, 'roster');
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.ALREADY);
    const g = Math.trunc(Number(gold));
    if (!Number.isFinite(g) || g <= 0) return fail(ERR.BAD_TARGET, 'illegal 坎诺特 withdraw'); // i18n-ignore: server detail
    if (ps.withdrawnThisRound + g > this.merchantCap()) return fail(ERR.MERCHANT_CAP);
    const cost = this.merchantCost(ps, g);
    if (!(cost > 0) || cost > ps.bountyBank) return fail(ERR.MERCHANT_BANK);
    ps.bountyBank -= cost;
    ps.withdrawnThisRound += g;
    ps.withdrawnGold += g;
    // addFunds already credits stats.fundsGained; never add it a second time here
    ps.addFunds(g, { reason: 'merchant' });
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  /** The alive, seated members of a team. */
  _aliveOf(team) { return this.order.filter((p) => p.alive && !p.left && this.teamIdOf(p) === team); }

  /** Every alive member of a team is a bot / under 托管 (its target is decided at once). */
  _allBots(team) {
    const members = this._aliveOf(team);
    return members.length > 0 && members.every((p) => p.botControlled);
  }

  /** Enter the 对抗期: step 1 (targets) opens. A team of BOTS decides at once; a team holding a human waits for it — the
   *  human picks first and the bot teammate is filled in only then (or when the window closes). */
  enterConfront() {
    this.phase = PHASE.CONFRONT;
    this.confrontStage = 'target';
    this.confrontTargets = new Map(); // attacker playerId → target playerId
    this.confrontSubs = new Map();    // attacker playerId → { target, group, position, picks, bosses, ratio, budget }
    this.setDeadline(this.soloUntimed ? null : VERSUS_CONFRONT.targetSeconds, () => this.finishConfrontTargets());
    for (const t of this.matchTeamIds()) {
      if (!this._allBots(t)) continue;
      for (const ps of this._aliveOf(t)) this.assignConfrontTarget(ps, null, true);
    }
    for (const ps of this.alivePlayers()) ps.ready = false;
    this.markPublic();
    this.maybeFinishConfrontTargets();
  }

  /** `g.confrontTarget { targetPlayerId }`: the player names the OPPONENT they attack this round. */
  submitConfrontTarget(ps, { targetPlayerId }) {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'target') return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.confrontTargets.has(ps.playerId)) return fail(ERR.ALREADY);
    const target = this.players.get(targetPlayerId);
    if (!target || !target.alive || target.left || this.teamIdOf(target) === this.teamIdOf(ps)) return fail(ERR.BAD_TARGET);
    this.assignConfrontTarget(ps, target.playerId, true);
    this.markPublic();
    this.maybeFinishConfrontTargets();
    return OK;
  }

  /**
   * Give `ps` a target: the named one when it is still free, else the opponent that is left. `fillMates` also hands the
   * teammate whatever remains (first come, first served: A picks C and B is given D) — never the other team.
   */
  assignConfrontTarget(ps, want = null, fillMates = false) {
    const team = this.teamIdOf(ps);
    const opp = this.matchTeamIds().find((t) => t !== team);
    const oppIds = opp == null ? [] : this._aliveOf(opp).map((p) => p.playerId);
    const takenBy = (t) => [...this.confrontTargets.entries()]
      .filter(([pid]) => this.teamIdOf(this.players.get(pid)) === t).map(([, v]) => v);
    if (!this.confrontTargets.has(ps.playerId)) {
      const free = oppIds.filter((pid) => !takenBy(team).includes(pid));
      // 「猎手 AI」(0.0.5): a bot seat aims at the opponent its placement answers best, not at the first empty seat;
      // a human's named target and every fallback stay exactly as they were.
      const hunted = ps.botControlled && this.aiHuntTier() !== 'off' ? this.aiHunterTarget(free) : null;
      const chosen = typeof want === 'string' && free.includes(want) ? want : (hunted ?? free[0]);
      if (chosen) this.confrontTargets.set(ps.playerId, chosen);
    }
    if (!fillMates) return;
    for (const mate of this._aliveOf(team)) {
      if (this.confrontTargets.has(mate.playerId)) continue;
      const left = oppIds.filter((pid) => !takenBy(team).includes(pid));
      if (left.length) this.confrontTargets.set(mate.playerId, left[0]);
    }
  }

  /** Step 1 ends once EVERY alive player (both sides) holds a target, or its window runs out. */
  maybeFinishConfrontTargets() {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'target') return;
    const alive = this.alivePlayers();
    if (alive.length && alive.every((p) => this.confrontTargets.has(p.playerId))) this.finishConfrontTargets();
  }

  /** Close step 1 (anyone the window caught out gets what is left) and open step 2, whose window is this round's prep. */
  finishConfrontTargets() {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'target') return;
    for (const ps of this.alivePlayers()) this.assignConfrontTarget(ps, null, true);
    this.setDeadline(0);
    this.confrontStage = 'monster';
    // Step 2 has no fixed length of its own: its window is THIS round's prep — the same time the players had to prepare —
    // and it is only a CAP, since maybeFinishConfront ends it early as soon as every alive player has submitted. Untimed
    // when the prep is (a single human — soloUntimed), and then the all-submitted end is the only way it closes.
    this.setDeadline(this.soloUntimed ? null : this.gd.prepTime(this.round), () => this.finishConfront());
    for (const ps of this.alivePlayers()) if (ps.botControlled) this.botConfront(ps);
    this.markPublic();
    this.maybeFinishConfront();
  }

  /** Step 2 ends as soon as EVERY alive player holds a submission (its window is only the cap). */
  maybeFinishConfront() {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'monster') return;
    const alive = this.alivePlayers();
    if (alive.length && alive.every((p) => this.confrontSubs.has(p.playerId))) this.finishConfront();
  }

  /** `g.confront { group, position, picks, bosses }` in step 2: the monsters a player throws at their target. `bosses`
   *  (the 事件期 boss 格, user 2026-10-21) is optional — an old client never sends it. */
  submitConfront(ps, { group, position, picks, bosses }) {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'monster') return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.confrontSubs.has(ps.playerId)) return fail(ERR.ALREADY);
    const arr = Array.isArray(picks) ? picks : [];
    const bArr = Array.isArray(bosses) ? bosses : [];
    // the count cap first: it is the protocol's own list bound too (shared/constants.js maxPicks mirrors it)
    if (arr.length > VERSUS_CONFRONT.maxPicks) return fail(ERR.CONFRONT_COUNT);
    if (bArr.length > VERSUS_CONFRONT.maxBosses) return fail(ERR.CONFRONT_COUNT);
    const member = this._confrontMember(ps, group, position, arr, bArr);
    if (!member) return fail(ERR.BAD_TARGET, 'illegal 对抗期 pick'); // i18n-ignore: 服务端内部 detail（客户端显示的是 ERR.BAD_TARGET 的文案）
    if (member.error) return fail(member.error);
    this.confrontSubs.set(ps.playerId, member.sub);
    this.markPublic();
    this.maybeFinishConfront();
    return OK;
  }

  /**
   * Check a submission: every enemyKey is offered by SOME 特训敌人 type, a legal gate and position, at most
   * VERSUS_CONFRONT.maxPicks monsters, and the combined VALUE within the round's budget. The player MAY MIX TYPES (user
   * decision 2026-10-17: step into one type, spend part of the budget, step into another and add more), so `group` is
   * display-only and only the union is checked. The AUTHORITATIVE cap (the client greys out what does not fit, this
   * refuses it): over the budget ⇒ ERR.CONFRONT_BUDGET, over the count ⇒ ERR.CONFRONT_COUNT.
   *
   * `bosses` (the 事件期 boss 格, user 2026-10-21) is checked on its own: every enemyKey must be in the 机变悬赏 pool
   * (confrontBossPool — and the round must be an event round at all), an enemyKey may appear at most ONCE per submission
   * ([ASSUMED] error code: a repeat is a count offence ⇒ ERR.CONFRONT_COUNT), and at most `confrontBossCap()` of
   * them (the event's own ordinal: E1 = 1 / E2 = 2 / E3 = 3, user 2026-10-21 after playtest). Bosses pay NO budget and count against NO maxPicks — `picks` may even be empty, a boss-only submission is a
   * legal one.
   * @returns {{ sub: object }|{ error: string }|null} null = malformed (unknown monster / gate / position)
   */
  _confrontMember(ps, group, position, picks, bosses = []) {
    const list = this.confrontGroups();
    const allowed = new Set(list.flatMap((g) => g.rows.map((r) => r.key)));
    const arr = Array.isArray(picks) ? picks : [];
    const pos = VERSUS_CONFRONT.positions.includes(position) ? position : null;
    if (!pos) return null;
    const out = [];
    for (const p of arr) {
      if (!p || typeof p.enemyKey !== 'string' || !allowed.has(p.enemyKey)) return null;
      out.push({ enemyKey: p.enemyKey, gate: p.gate === 'upper' ? 'upper' : 'lower' });
    }
    if (out.length > VERSUS_CONFRONT.maxPicks) return { error: ERR.CONFRONT_COUNT };
    if (this.confrontSpent(out) > this.confrontBudget()) return { error: ERR.CONFRONT_BUDGET };
    const bArr = Array.isArray(bosses) ? bosses : [];
    // outside the 事件期 rounds the boss 格 does not exist, so the pool is empty and any boss is refused with it
    const bossAllowed = this.confrontBossOpen() ? new Set(this.confrontBossPool().map((r) => r.key)) : new Set();
    const outB = [];
    for (const p of bArr) {
      if (!p || typeof p.enemyKey !== 'string' || !bossAllowed.has(p.enemyKey)) return null;
      if (outB.some((x) => x.enemyKey === p.enemyKey)) return { error: ERR.CONFRONT_COUNT };
      outB.push({ enemyKey: p.enemyKey, gate: p.gate === 'upper' ? 'upper' : 'lower' });
    }
    // the cap is the event's own ordinal (confrontBossCap: E1 = 1, E2 = 2, E3 = 3; user 2026-10-21 after playtest) —
    // over the cap is a count offence; off the event rounds the cap is 0 and the empty pool above already refused
    if (outB.length > this.confrontBossCap()) return { error: ERR.CONFRONT_COUNT };
    const gi = Number.isInteger(group) && group >= 1 && group <= list.length ? group : 1;
    return { sub: { target: this.confrontTargets.get(ps.playerId) ?? null, group: gi, position: pos, picks: out, bosses: outB, total: out.length, ratio: this.confrontRatio(), budget: this.confrontBudget(), seat: ps.seat } };
  }

  /** An AI player's submission, and the one a player who never submits gets at the window's end: fill the budget from
   *  its group, most expensive fitting monster first (the client's 自动选择 button walks the group the player chose — the
   *  AI prefers 特异 (the biggest, most "generic" type), then walks the types in order until one can actually afford
   *  something, since a tight budget can leave a small type with nothing at all). The 事件期 boss 格 stays EMPTY here
   *  ([ASSUMED], user 2026-10-21: bots / 托管 never pick bosses — the auto-fill keeps its deterministic picks).
   *  0.0.5 「猎手 AI」: on a NORMAL / HARD / ABYSS 2V2 the greedy fill above is only the FALLBACK — `aiHunterPlan`
   *  answers the fielding of the seat this bot aims at (and the strongest tier may use the boss 格), and its plan is
   *  accepted only after the human gate `_confrontMember` passes it; budget, caps and pool are the human ones. */
  botConfront(ps) {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'monster' || this.confrontSubs.has(ps.playerId)) return;
    const hunted = this.aiHunterPlan(ps);
    if (hunted) {
      this.confrontSubs.set(ps.playerId, hunted);
      this.markPublic();
      return;
    }
    const groups = this.confrontGroups();
    const budget = this.confrontBudget();
    const plan = (recs) => {
      const picks = [];
      let left = budget;
      for (const r of recs.slice().sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)))) {
        if (picks.length >= VERSUS_CONFRONT.maxPicks) break;
        if (r.value > left) continue;
        left -= r.value;
        picks.push({ enemyKey: r.key, gate: picks.length % 2 ? 'upper' : 'lower' });
      }
      return picks;
    };
    let gi = 0;
    let picks = plan((groups[0] && groups[0].rows) || []);
    if (!picks.length) {
      for (let i = 1; i < groups.length; i++) {
        const p = plan(groups[i].rows || []);
        if (p.length) { gi = i; picks = p; break; }
      }
    }
    this.confrontSubs.set(ps.playerId, { target: this.confrontTargets.get(ps.playerId) ?? null, group: gi + 1, position: 'mid', picks, bosses: [], total: picks.length, ratio: this.confrontRatio(), budget, seat: ps.seat });
    this.markPublic();
  }

  /**
   * Step 2 is over (its window ran out): anyone missing a submission gets a bot one, then the roster (悬赏名单) is held
   * for VERSUS_CONFRONT.rosterMs before the battles start (CONFRONT_ROSTER_MS, user 2026-10-17 addendum). Without the
   * hold (rosterMs 0) the old path goes straight to COMBAT.
   */
  finishConfront() {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage === 'roster') return;
    this.setDeadline(0);
    for (const ps of this.alivePlayers()) if (!this.confrontSubs.has(ps.playerId)) this.botConfront(ps);
    this.confront = new Map(this.confrontSubs);
    const rosterMs = Math.max(0, Number(this.huntCfg().rosterMs) || 0);
    if (rosterMs > 0) {
      // the phase stays CONFRONT (stage 'roster'): m.public.confront still carries the applied submissions, and
      // m.public.confront.roster = { until, ms } lets the client play its 5 s announcement before COMBAT.
      this.confrontStage = 'roster';
      this.confrontRosterAt = this.sched.now();
      this.setDeadline(rosterMs / 1000, () => this.finishConfrontRoster());
      this.markPublic();
      return;
    }
    this.confrontStage = null;
    this.startCombat();
  }

  /** The roster hold expired (server-timed by setDeadline → later → scaled): start the round's battles. */
  finishConfrontRoster() {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'roster') return;
    this.setDeadline(0);
    this.confrontStage = null;
    this.startCombat();
  }

  /**
   * The interventions aimed at a player's wave (each attacker hits exactly one target, so 0 or 1 here — a list keeps it
   * safe whatever the pairing did). `null` when nothing was submitted.
   * @param {object} ps
   * @returns {object[]}
   */
  confrontFor(ps) {
    // never apply a previous round's applied set: only THIS round's active 对抗期 has one (startRound clears it, and
    // the active guard keeps a direct call from re-deploying stale placements)
    if (!this.confrontActive() || !this.confront || !this.confront.size) return [];
    return [...this.confront.values()].filter((s) => s && s.target === ps.playerId);
  }

  /** The template routes of the round's wave (the gates live here, not on the stage). */
  _confrontRoutes() {
    const tplId = this.wave && this.wave.templateId;
    const tpl = tplId ? this.gd.wave(tplId) : null;
    const routes = tpl && Array.isArray(tpl.routes) ? tpl.routes : [];
    const leader = !!(tpl && (tpl.kind === 'boss' || tpl.kind === 'hidden'));
    return { routes, leader };
  }

  /** The route index a placed monster uses: the template route matching its gate AND movement, else any of its class. */
  confrontRouteFor(enemyKey, gate) {
    const en = (this.data && this.data.enemies) || {};
    const fly = !!(en[enemyKey] && en[enemyKey].isFlyEnemy);
    const { routes, leader } = this._confrontRoutes();
    if (!routes.length) return 0;
    const motionOk = (r) => (fly ? r.motion === 'FLY' : r.motion !== 'FLY' && r.motion !== 'E_NUM');
    const j = routes.findIndex((r) => motionOk(r) && gateOf(r.start, leader) === gate);
    if (j >= 0) return j;
    const i = routes.findIndex(motionOk);
    return i >= 0 ? i : 0;
  }

  /**
   * The monsters ONE receiver faces this round — every intervention aimed at `ps`, as ONE batch in submission order.
   * The bounty's numerator and denominator are both read from THIS batch: the receiver's own wave (the round's normal
   * monsters included) never enters the count, so killing the whole wave pays nothing unless the monsters were placed
   * by the opponent. A `sub` not in the applied map (a direct call / test) is added as its own batch.
   * @returns {Array<{ s: object, p: object }>}
   */
  _confrontIncoming(ps, sub = null) {
    const batch = [];
    for (const s of this.confrontFor(ps)) for (const p of s.picks || []) batch.push({ s, p });
    if (sub && Array.isArray(sub.picks) && !batch.some((x) => x.s === sub)) {
      for (const p of sub.picks) batch.push({ s: sub, p });
    }
    return batch;
  }

  /**
   * Replace a share of a player's original wave with one attacker's monsters:
   *   * originals worth `share × the wave value` are dropped at random (within 2 % of that value);
   *   * the placed monsters are inserted together at the chosen position (25 / 50 / 75 % of the round's monster count),
   *     each on the route matching its gate and movement;
   *   * the 事件期 boss 格's bosses (sub.bosses) replace NOTHING and enter after every other spawn (_confrontBossSpawns).
   * @param {object[]} spawns the player's original SpawnSpecs
   * @param {{ picks: object[], bosses?: object[], position: string, ratio: number }} sub
   * @param {object} ps the TARGET player
   * @returns {object[]} the modified spawn list
   */
  applyConfront(spawns, sub, ps) {
    const bosses = sub && Array.isArray(sub.bosses) ? sub.bosses : [];
    const picks = sub && Array.isArray(sub.picks) ? sub.picks : [];
    if (!sub || !Array.isArray(spawns) || !spawns.length || (!picks.length && !bosses.length)) return spawns;
    // a boss-only placement ([ASSUMED] user 2026-10-21): the free boss 格 replaces nothing — it only appends its bosses
    if (!picks.length) return this._confrontBossSpawns(spawns.map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined })), sub, ps);
    const scale = this.confrontScale();
    // price the originals EXACTLY like confrontWaveValue prices the wave (confrontValueOf = stats + the graded 特性
    // score at this round's scale), so the value actually dropped / the wave value is the nominal share (5→15 %, 50 %
    // on R13) — a stat-only price would under-replace by the trait share (30 % of the table). The event card / 强力属性
    // multipliers are deliberately NOT part of this price: confrontWaveValue and the budget use the base wave, and a
    // replacement share must stay comparable with them.
    const valueOf = (key) => this.confrontValueOf(key, scale);
    const out = spawns.map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
    // 1) drop originals at random until the target value is (nearly) reached
    const target = this.confrontWaveValue() * sub.ratio;
    const units = [];
    out.forEach((s, i) => {
      const cnt = Math.max(1, Math.floor(Number(s.count) || 1));
      for (let k = 0; k < cnt; k++) units.push({ i, v: Math.max(1, valueOf(s.enemyKey)) });
    });
    // shuffle (seeded), then close the target with the closest of two builds: (a) fill what fits, then add the single
    // remaining unit nearest the gap; (b) the shuffled order's first crossing of the target (and the one before it).
    // The picked set is the one closest to `share × wave value` in value terms, so a coarse wave (a 5 % share smaller
    // than every original) replaces the smallest original or nothing — whichever is closer — instead of overshooting by
    // a whole run; the announced ratio is what actually leaves the wave.
    for (let i = units.length - 1; i > 0; i--) {
      const j = Math.floor(this.rngConfront() * (i + 1));
      [units[i], units[j]] = [units[j], units[i]];
    }
    const totalOf = (list) => list.reduce((sum, u) => sum + units[u].v, 0);
    const take = new Map();
    if (target > 0 && units.length) {
      const greedy = [];
      let left = target;
      for (let u = 0; u < units.length; u++) {
        if (units[u].v > left) continue;
        greedy.push(u);
        left -= units[u].v;
        if (left <= 0) break;
      }
      if (left > 0 && greedy.length < units.length) {
        let best = -1;
        let bestGap = left;
        for (let u = 0; u < units.length; u++) {
          if (greedy.includes(u)) continue;
          const gap = Math.abs(units[u].v - left);
          if (gap < bestGap) { bestGap = gap; best = u; }
        }
        if (best >= 0) greedy.push(best);
      }
      const prefix = [];
      let acc = 0;
      for (let u = 0; u < units.length; u++) {
        prefix.push(u);
        acc += units[u].v;
        if (acc >= target) break;
      }
      const candidates = [greedy, prefix];
      if (prefix.length > 1) candidates.push(prefix.slice(0, -1));
      let bestList = candidates[0];
      for (const c of candidates.slice(1)) {
        const d = Math.abs(totalOf(c) - target);
        const bd = Math.abs(totalOf(bestList) - target);
        if (d < bd || (d === bd && c.length < bestList.length)) bestList = c;
      }
      for (const u of bestList) take.set(units[u].i, (take.get(units[u].i) || 0) + 1);
    }
    // 2) apply the drops by REBUILDING the list (splicing while iterating would shift the indexes under us);
    //    a spawn that loses every unit goes away
    const kept = [];
    out.forEach((s, i) => {
      const c = Math.max(1, Math.floor(Number(s.count) || 1));
      const rest = c - (take.get(i) || 0);
      if (rest > 0) kept.push(rest === c ? s : { ...s, count: rest });
    });
    // 3) the placed monsters, together at the chosen position. `confrontSeat` is DISPLAY only (the target's client
    //    outlines them and prints P<n> under them) — `sourcePlayerId` stays untouched, it drives the 联防 leak billing.
    const mods = roundMods(scale);
    const start = this._confrontInsertTime(spawns, sub.position);
    const sentBy = Number.isInteger(sub.seat) ? sub.seat : null;
    // 赏金 (final rule, user 2026-10-17): the FIRST four bounty phases pay a fixed 1/1/2/2 by the kill ratio
    // (floor(cap × killed / total)); from the 5th phase on — the R13 最终狩猎 aside — the live formula pays
    // floor(Σ value(killed) / wave value × income × killIncomeShare), with no cap and no per-monster minimum. R13 pays
    // the FIXED finalHuntBounty (25) by the same kill ratio. Each monster carries the share that kill completes
    // (confrontBountyPlan), so a cheap monster can be worth 0 and the running total is exactly the floor above — 64 of
    // the cheapest monsters cannot beat the formula (or 25 on R13).
    //
    // BOTH the numerator and the denominator come from `batch` = the monsters the OPPONENT placed at THIS receiver
    // (confrontFor → _confrontIncoming). The receiver's wave keeps the round's own monsters in it — they are never
    // counted, so wiping out the whole wave pays nothing unless the monster was placed. `bounty.total` is the
    // receiver's batch size (each player may face a different one), `bounty.index` its 0-based slot in that batch.
    const batch = this._confrontIncoming(ps, sub);
    const offset = batch.findIndex((x) => x.s === sub);
    const total = batch.length;
    const coins = this.confrontBountyPlan(batch.map((x) => x.p));
    // 2V2 事件期 赏金嗅觉: each monster the opponent placed pays its killer +2 coins (banked 赏金) — the entry belongs to
    // the RECEIVER of the placement, so it is added here once per placed monster.
    const scent = typeof this.eventBountyBonusOf === 'function' ? this.eventBountyBonusOf(ps) : 0;
    sub.picks.forEach((p, i) => {
      kept.push({
        time: start + i * 1, enemyKey: p.enemyKey, count: 1, interval: 0, routeIndex: this.confrontRouteFor(p.enemyKey, p.gate),
        mods: { ...mods }, ownerPlayerId: ps.playerId, confrontSeat: sentBy,
        // 狩猎模拟: a placed monster leaks FOR FREE — `countInTotal: false` is exactly that (the flag drives both the
        // LP charge and the 完美作战 counter), so only killing it matters: the bounty below pays the killer.
        countInTotal: false,
        // 经济补助: killing a monster the opponent placed pays its killer (the sim's bounty mechanic — the killer's
        // player, a 联防 helper included); anyone the death cannot be credited to pays the wave's owner instead.
        // `total`/`index` are the RECEIVER's batch (the monsters the opponent placed at this player), so the UI can
        // show "killed / total" of the opponent's placement without ever counting the wave's own monsters.
        bounty: { coins: (coins[offset + i] || 0) + scent, ownerPlayerId: ps.playerId, total, index: offset + i, bank: true },
      });
    });
    return this._confrontBossSpawns(kept, sub, ps);
  }

  /**
   * The 事件期 boss 格's bosses on a wave (user 2026-10-21): appended AFTER every spawn the wave holds at this point
   * ([ASSUMED] start = max(time) + 10, +1 per boss — “只能排在波次最后入场”), each on the route of its gate, `count: 1`,
   * `countInTotal: false` (a leaked boss costs no 目标生命值, exactly like a placed monster) and `confrontSeat` = the
   * sender's seat (display only). The bounty pays the KILLER the pool's highest coin tier DIRECTLY as gold —
   * `bank: false` (economy.js addCoins → pendingFunds), never the 坎诺特 赏金 account, and it carries no batch
   * total / index (bosses are not part of the placement's bounty batch). A missed boss pays nothing.
   * @param {object[]} list the spawn list being built (mutated: the bosses are pushed onto it)
   * @param {{ bosses: object[], seat?: number }} sub
   * @param {object} ps the TARGET player (ownerPlayerId / bounty owner — the bounty pays whoever kills it)
   * @returns {object[]} the same list
   */
  _confrontBossSpawns(list, sub, ps) {
    const bosses = Array.isArray(sub.bosses) ? sub.bosses : [];
    if (!bosses.length) return list;
    const mods = roundMods(this.confrontScale());
    const sentBy = Number.isInteger(sub.seat) ? sub.seat : null;
    let time = list.reduce((n, s) => Math.max(n, Number(s && s.time) || 0), 0) + 10;
    for (const p of bosses) {
      list.push({
        time: time++, enemyKey: p.enemyKey, count: 1, interval: 0,
        routeIndex: this.confrontRouteFor(p.enemyKey, p.gate),
        mods: { ...mods }, ownerPlayerId: ps.playerId, confrontSeat: sentBy,
        countInTotal: false,
        bounty: { coins: this.confrontBossCoin(p.enemyKey), ownerPlayerId: ps.playerId, bank: false },
      });
    }
    return list;
  }

  /** The insertion time of a position: walk the ORIGINAL wave by count to the 25 / 50 / 75 % mark. */
  _confrontInsertTime(spawns, position) {
    const frac = position === 'front' ? 0.25 : position === 'back' ? 0.75 : 0.5;
    const total = spawns.reduce((n, s) => n + Math.max(1, Math.floor(Number(s.count) || 1)), 0);
    const mark = Math.max(1, Math.round(total * frac));
    const ordered = spawns.slice().sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
    let seen = 0;
    for (const s of ordered) {
      seen += Math.max(1, Math.floor(Number(s.count) || 1));
      if (seen >= mark) return Number(s.time) || 0;
    }
    return Number(ordered.length ? ordered[ordered.length - 1].time : 0) || 0;
  }
}
