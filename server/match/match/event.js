// server/match/match/event.js — Match methods: the 2V2 事件期 (类肉鸽词条). Three periods per match, aligned with the
// 狩猎期: E1 = contestStartRound (R4/R5/R6), E2 = E1 + 4 (R8/R9/R10), E3 = R13 (the 最终狩猎); none is a boss round.
// Each period runs after ROUND_START and before that round's 机变 / 休整期. The three periods run under ONE identical
// rule set (0.0.5 需求 1: no per-sequence odds, no 自己 ×2, no one-target-per-match limit). Every event has TWO
// channels:
//   1. ALLY packs: every alive player picks ONE of four targets (self / mate / oppA / oppB; a target may be picked
//      again later and by several pickers). Each selection deals ONE pack of EVENT_PACK_SIZE entries to the TARGET
//      (chosen N times → N packs; 对面包 on an oppA / oppB pick = 1 减益 + 2 中性, 我方包 on a self / mate pick = 1
//      增益 + 2 中性 — EVENT_PACK_KINDS), drawn from EVENT_CARDS with the seeded `rngEvent` stream. A player chosen 0
//      times receives ONE 默认包 (3 中性) when the period closes — the per-event floor. The used-card bag is
//      match-global (shared across players and periods): no card repeats while the 24-entry pool still holds an unused
//      one, so an exhausted kind borrows an unused card of another kind before anything repeats;
//   2. the monster entry: drawn once when the period opens, on its own seeded stream (`rngFoeEvent`), independent of the
//      target choices, with the unified foe odds (EVENT_FOE_ODDS). It merges into THAT round's wave (normal + 赏金怪,
//      never a player's mods, never a bounty amount). Each period ALSO marks a share of that wave as 强力 with one extra
//      attribute (EVENT_FOE_ELITES, its own `rngFoeElite` stream; the marked runs carry `elite: true`).
//
// Effect injection: the ally entries accumulate on the target's PlayerState (eventEntries / eventMods). Battles receive
// one `event:` EffectRef per entry (PlayerState.battleInput → server/sim/content/event.js reads them), the economy hooks
// read the same fields: income (startRound), refresh / sell prices (economy.js), the deploy cap (basics.js) and the
// placed-monster bounty (confront.js applyConfront, +3 coins per kill). An entry is in force for EVENT_DURATION_ROUNDS
// rounds from the one it was picked in (round … round+duration−1), then expires: eventModsFor / eventBattleRefs filter
// the accumulated log by the current round; startRound re-derives eventMods each round. History keeps every entry.
//
// The phase is timed (EVENT_PICK_SECONDS; always, also in a single-human versus room) and every botControlled seat picks
// at once. A timeout — or a seat that never answers — is auto-picked by botEventTarget (EVENT_AI_OPP_CHANCE % of those
// picks aim at the opposing side, the rest at their own, and an un-chosen seat wins within the side — otherwise an
// all-AI period would deal nothing but 对面包), so the phase can never stall. AIs and timeouts are dealt
// the same packs as humans — never a discount.
//
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import {
  PHASE, ERR, EVENT_TARGETS, EVENT_PACK_SIZE, EVENT_PACK_KINDS, EVENT_PICK_SECONDS, EVENT_AI_OPP_CHANCE, EVENT_CARDS,
  EVENT_FOE_ODDS, EVENT_FOE_ELITE_SHARES, EVENT_FOE_CARDS, EVENT_FOE_ELITES, EVENT_ROSTER_MS, EVENT_DURATION_ROUNDS,
  COOP_HUNT,
} from '../../../shared/constants.js';
import { OK, fail } from './common.js';

const CARD_BY_ID = new Map(EVENT_CARDS.map((c) => [c.id, c]));
const CARD_BY_KEY = new Map(EVENT_CARDS.map((c) => [c.key, c]));
const FOE_BY_ID = new Map(EVENT_FOE_CARDS.map((c) => [c.id, c]));
const FOE_BY_KEY = new Map(EVENT_FOE_CARDS.map((c) => [c.key, c]));
const ELITE_BY_KEY = new Map(EVENT_FOE_ELITES.map((c) => [c.key, c]));
/** The ally entry of an id (1…24) / key, or null. */
export const eventCardById = (id) => CARD_BY_ID.get(id) ?? null;
export const eventCardByKey = (key) => CARD_BY_KEY.get(key) ?? null;
/** The monster entry of an id (1…12) / key, or null. */
export const eventFoeCardById = (id) => FOE_BY_ID.get(id) ?? null;
export const eventFoeCardByKey = (key) => FOE_BY_KEY.get(key) ?? null;
/** A 强力属性 (elite attribute) of a key, or null. */
export const eventFoeEliteByKey = (key) => ELITE_BY_KEY.get(key) ?? null;

/** One entry of a pool uniformly among the entries whose id is not in `used`; null when every one is used. */
function pickUnused(rng, pool, used) {
  const avail = pool.filter((c) => !used || !used.has(c.id));
  if (!avail.length) return null;
  const i = Math.max(0, Math.min(avail.length - 1, Math.floor(rng() * avail.length)));
  return avail[i];
}

/** One entry of a pool uniformly (one rng() call; null when the pool is empty). */
function pickAny(rng, pool) {
  if (!pool.length) return null;
  const i = Math.max(0, Math.min(pool.length - 1, Math.floor(rng() * pool.length)));
  return pool[i];
}

/**
 * Draw the ally entry of a rolled kind without repeating a card of THIS match (0.0.5 需求 1.3 重复规则, 维护者
 * 2026-10-25 定为「真·全局限一份」): first among the match's unused cards of that kind, then — once that kind has no
 * unused card left — an unused card of ANY kind (the pack keeps its 3-entry shape but the slot borrows another kind, so
 * the neutral fillers of a 4-player period never repeat while the 24-card pool still holds one), and only after the
 * whole pool is used does a card repeat (then inside its own kind, so a 减益 slot stays a 减益).
 * @param {() => number} rng
 * @param {'down'|'mid'|'up'} kind
 * @param {Set<number>} usedMatch cards already drawn this match
 */
export function eventDrawAlly(rng, kind, usedMatch = new Set()) {
  const byKind = EVENT_CARDS.filter((c) => c.kind === kind);
  return pickUnused(rng, byKind, usedMatch) ?? pickUnused(rng, EVENT_CARDS, usedMatch) ?? pickAny(rng, byKind);
}

/**
 * Draw one pack of EVENT_PACK_SIZE entries in EVENT_PACK_KINDS order (the distinctive card first, then the neutral
 * fillers), marking every draw in the match-global `usedMatch` bag. Null entries are dropped (an empty kind pool —
 * impossible with the shipped tables).
 * @param {() => number} rng
 * @param {'opp'|'own'|'default'} packKind
 * @param {Set<number>} usedMatch
 * @returns {Array<{ id: number, key: string, kind: string }>}
 */
export function eventDrawPack(rng, packKind, usedMatch = new Set()) {
  const kinds = EVENT_PACK_KINDS[packKind] || EVENT_PACK_KINDS.default;
  const out = [];
  for (const kind of kinds.slice(0, Math.max(1, EVENT_PACK_SIZE))) {
    const card = eventDrawAlly(rng, kind, usedMatch);
    if (!card) continue;
    usedMatch.add(card.id);
    out.push(card);
  }
  return out;
}

/** The monster channel's unified odds (25 / 40 / 35 in every period since 0.0.5). */
export const eventFoeOdds = () => EVENT_FOE_ODDS;

/** Draw the monster entry's kind (one rng() call against the unified foe odds). */
export function eventFoeKindOf(rng) {
  const odds = EVENT_FOE_ODDS;
  const r = rng() * 100;
  if (r < odds.favor) return 'favor';
  if (r < odds.favor + odds.mid) return 'mid';
  return 'unfavor';
}

/** Draw one monster entry of a type among the match-unused ones (one rng() call; falls back to any unused). */
export function eventFoeCardOfKind(rng, kind, used = new Set()) {
  const byKind = EVENT_FOE_CARDS.filter((c) => c.kind === kind);
  return pickUnused(rng, byKind, used) ?? pickUnused(rng, EVENT_FOE_CARDS, used) ?? byKind[0] ?? null;
}

/** The mean AI value of a monster type (used by the neutrality test / report; +1 / 0 / −1 in the table). */
export function eventFoeMeanEv(kind) {
  const pool = EVENT_FOE_CARDS.filter((c) => c.kind === kind);
  if (!pool.length) return 0;
  return pool.reduce((n, c) => n + (Number(c.ev) || 0), 0) / pool.length;
}

/**
 * The expected value of the monster draw from OUR side: the unified odds over the three kind means — exactly −0.10
 * (25 / 40 / 35 on +1 / 0 / −1) in every period since 0.0.5.
 */
export function eventFoeEv() {
  const odds = EVENT_FOE_ODDS;
  return (odds.favor * eventFoeMeanEv('favor') + odds.mid * eventFoeMeanEv('mid') + odds.unfavor * eventFoeMeanEv('unfavor')) / 100;
}

/** A multiplier after the target's magnitude: the BONUS doubles (`1 + (m − 1) × mag`), not the total. */
const magMul = (m, mag) => 1 + (m - 1) * mag;

/**
 * How many rounds one ally entry stays in force: its own `duration` (1 for 经济类负面词条 such as 空手而归, user
 * 2026-10-19), otherwise EVENT_DURATION_ROUNDS. Clamped to 1 … EVENT_DURATION_ROUNDS.
 * @param {{ duration?: number }|null|undefined} card an EVENT_CARDS row
 * @returns {number}
 */
export function eventCardDuration(card) {
  const raw = Math.trunc(Number(card && card.duration));
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, EVENT_DURATION_ROUNDS);
  // all 经济类负面 entries last one round, including any added later without an explicit override
  if (card && card.class === 'economy' && card.kind === 'down') return 1;
  return EVENT_DURATION_ROUNDS;
}

/**
 * Whether a received entry is in force at `round`: it was picked at R and is active in R, R+1, …, R+duration−1
 * (usually `EVENT_DURATION_ROUNDS` = 4 → [R, R+3]; 经济类负面 entries use 1 → [R]). No `round` (the raw log /
 * hand-built states) keeps every entry; an entry without its own `round` is always in force (the published history
 * carries the round on every real pick).
 * @param {{ round?: number, duration?: number, card?: object }|null|undefined} entry
 * @param {number|null} [round] the current absolute round (null = no filter)
 * @returns {boolean}
 */
export function eventEntryActive(entry, round = null) {
  const cur = Number(round);
  if (!Number.isFinite(cur)) return true;
  const raw = entry && entry.round;
  if (raw == null || raw === '') return true;
  const picked = Number(raw);
  if (!Number.isFinite(picked)) return true;
  const own = Math.trunc(Number(entry && entry.duration));
  const duration = Number.isFinite(own) && own > 0 ? own : eventCardDuration(entry && entry.card);
  return cur >= picked && cur < picked + Math.min(duration, EVENT_DURATION_ROUNDS);
}

/** The entries in force at `round` (round null → the whole log, unchanged). */
export function eventActiveEntries(entries, round = null) {
  return (entries || []).filter((e) => e && eventEntryActive(e, round));
}

/**
 * Accumulate received entries into the NON-BATTLE summary used by income / prices / deploy / bounty. This summary is
 * not the battle rule. Battle percentages go through the
 * **环境buff乘区 / environment buff bucket** instead (eventBattleRefs → server/sim/content/event.js):
 *   ① each source multiplies once: `stat = base × Π(1 + p_i)`;
 *   ② flat values (ASPD / SP recovery / SP cost) are highest priority, added to the panel first and never scaled;
 *   ③ the bucket is event-only and never mixes with the additive pool of bonds / equipment / skills / 机变.
 * `dmgTakenMul` / `enemySpeedMul` / `moveMul` / `spRecoveryMul` multiply here too (each entry's own `mag` — always 1
 * since 0.0.5; the scaling stays for hand-built states). Entries are filtered to those in force at `round`
 * (EVENT_DURATION_ROUNDS); no `round` means
 * the whole log (the raw accumulation, used by the pure helpers / tests).
 * @param {Array<{ card: object, mag?: number, round?: number }>} entries
 * @param {number|null} [round] current absolute round (null = no filter)
 */
export function eventModsFor(entries, round = null) {
  const out = {
    atkPct: 0, aspd: 0, hpPct: 0, defPct: 0, defIgnorePct: 0, regenPct: 0, dmgTakenMul: 1, moveMul: 1, deploy: 0,
    spRecoveryMul: 1, spRecoveryFlat: 0, spCostFlat: 0,
    goldPerRound: 0, bountyGold: 0, enemySpeedMul: 1, refreshDiscount: 0, refreshUses: 0, sellDiscount: 0,
  };
  for (const e of eventActiveEntries(entries, round)) {
    const c = e && e.card;
    if (!c) continue;
    const mag = Number.isFinite(e.mag) ? e.mag : 1;
    out.atkPct += (c.atkPct || 0) * mag;
    out.aspd += (c.aspd || 0) * mag;
    out.hpPct += (c.hpPct || 0) * mag;
    out.defPct += (c.defPct || 0) * mag;
    out.defIgnorePct += (c.defIgnorePct || 0) * mag;
    out.regenPct += (c.regenPct || 0) * mag;
    if (c.dmgTaken) out.dmgTakenMul *= magMul(1 + c.dmgTaken, mag);
    if (c.moveMul) out.moveMul *= magMul(c.moveMul, mag);
    out.deploy += (c.deploy || 0) * mag;
    if (c.spRecoveryMul) out.spRecoveryMul *= magMul(c.spRecoveryMul, mag);
    out.spRecoveryFlat += (c.spRecoveryFlat || 0) * mag;
    out.spCostFlat += (c.spCostFlat || 0) * mag;
    out.goldPerRound += (c.goldPerRound || 0) * mag;
    out.bountyGold += (c.bountyGold || 0) * mag;
    if (c.enemySpeed) out.enemySpeedMul *= magMul(1 + c.enemySpeed, mag);
    out.refreshDiscount += (c.refreshDiscount || 0) * mag;
    out.refreshUses += (c.refreshUses || 0) * mag;
    out.sellDiscount += (c.sellDiscount || 0) * mag;
  }
  return out;
}

/**
 * The battle-side EffectRefs of a player's received entries (PlayerState.battleInput): one ref per entry (its `id` is
 * unique, so two copies of the same entry stack), `params` only the battle-relevant numbers. server/sim/content/event.js
 * reads them at battleStart (own operators) and on enemySpawn (enemy move speed), applying each ref in the
 * **环境buff乘区 / environment buff bucket** — `base × Π(1 + p_i)`, with flat values on the panel first; the bucket is
 * event-only and does not touch the additive pool of other systems. Only the entries in force at `round` become refs
 * (EVENT_DURATION_ROUNDS); no `round` keeps the whole log.
 * @param {Array<{ card: object, mag?: number, round?: number }>} entries
 * @param {number|null} [round] current absolute round (null = no filter)
 */
export function eventBattleRefs(entries, round = null) {
  const refs = [];
  eventActiveEntries(entries, round).forEach((e, i) => {
    const c = e && e.card;
    if (!c) return;
    const mag = Number.isFinite(e.mag) ? e.mag : 1;
    const params = {};
    if (c.atkPct) params.atkPct = c.atkPct * mag;
    if (c.aspd) params.aspd = c.aspd * mag;
    if (c.hpPct) params.hpPct = c.hpPct * mag;
    if (c.defPct) params.defPct = c.defPct * mag;
    if (c.defIgnorePct) params.defIgnorePct = c.defIgnorePct * mag;
    if (c.regenPct) params.regenPct = c.regenPct * mag;
    if (c.dmgTaken) params.dmgTaken = c.dmgTaken * mag;
    if (c.moveMul) params.moveMul = magMul(c.moveMul, mag);
    if (c.spRecoveryMul) params.spRecoveryMul = magMul(c.spRecoveryMul, mag);
    if (c.spRecoveryFlat) params.spRecoveryFlat = c.spRecoveryFlat * mag;
    if (c.spCostFlat) params.spCostFlat = c.spCostFlat * mag;
    if (c.enemySpeed) params.enemySpeed = c.enemySpeed * mag;
    if (!Object.keys(params).length) return;
    refs.push({
      id: `event:${c.id}#${i + 1}`,
      key: `event:${c.id}#${i + 1}`,
      source: 'event',
      params,
      data: { card: c.id },
    });
  });
  return refs;
}

export class MatchEvent {
  /** Whether this round opens an event period (a hunt mode: versus or 同盟狩猎; one per eventRounds entry). */
  eventDue() {
    return this.huntMode && Array.isArray(this.eventRounds) && this.eventRounds.includes(this.round) && this._eventDoneRound !== this.round;
  }

  /**
   * The target keys this match's 事件期 offers: the four 2V2 targets (self / mate / oppA / oppB) or, in a co-op hunt,
   * only `self` / `mate` (COOP_HUNT.targets — there is no opposing team).
   * @returns {readonly string[]}
   */
  eventTargetKeys() { return this.isVersus ? EVENT_TARGETS : COOP_HUNT.targets; }

  /**
   * The teammate a co-op player gives the `mate` target to (user: "random / designated, via the existing alliesOf").
   * Deterministic: the next LIVING teammate in seat order, wrapping to the first. A dead / departed teammate is never
   * offered (their card would be consumed for nothing); a lone / last-surviving player has no mate and the target is
   * unavailable that event.
   * @param {import('../PlayerState.js').PlayerState} ps
   */
  coopEventMate(ps) {
    const mates = this.aliveAlliesOf(ps).filter((p) => p !== ps && !p.left).sort((a, b) => a.seat - b.seat);
    if (!mates.length) return null;
    return mates.find((p) => p.seat > ps.seat) ?? mates[0];
  }

  /**
   * The targets of a player: 自己 (itself), 队友 (2V2: its only teammate; co-op: coopEventMate) and 对面 A / B (the
   * opponent's two seats in seat order, 2V2 only). A missing seat is null (never a valid target).
   * @param {import('../PlayerState.js').PlayerState} ps
   * @returns {{ self: object|null, mate: object|null, oppA: object|null, oppB: object|null }}
   */
  eventTargetMap(ps) {
    if (!ps) return { self: null, mate: null, oppA: null, oppB: null };
    const mate = this.isVersus
      ? (this.order.find((p) => p !== ps && p.team === ps.team) ?? null)
      : this.coopEventMate(ps);
    const opps = this.isVersus ? this.order.filter((p) => p.team !== ps.team).sort((a, b) => a.seat - b.seat) : [];
    return { self: ps, mate, oppA: opps[0] ?? null, oppB: opps[1] ?? null };
  }

  /** The target map as playerIds (`m.public.event.targets`). */
  eventTargetIds(ps) {
    const map = this.eventTargetMap(ps);
    const out = {};
    for (const key of this.eventTargetKeys()) out[key] = map[key] ? map[key].playerId : null;
    return out;
  }

  /**
   * The target keys this player may still pick. Since 0.0.5 there is NO one-target-per-match limit any more (a target
   * may be picked again and by several pickers — each selection deals it another pack), so every mapped, living seat
   * stays available in every period — 2V2 and 同盟狩猎 alike.
   */
  eventAvailableTargets(ps) {
    const map = this.eventTargetMap(ps);
    // a target must be a live seat (self is checked by the caller; mate never points at a dead / departed teammate)
    return this.eventTargetKeys().filter((key) => map[key] && map[key].alive && !map[key].left);
  }

  /** Open the round's event period (from MatchPhases.afterRoundStart, at ROUND_START). */
  enterEvent() {
    if (this.phase !== PHASE.ROUND_START || this.eventDue() === false) return;
    const alive = this.alivePlayers();
    if (!alive.length) { this.continueAfterEvent(); return; }
    this.phase = PHASE.EVENT;
    this.eventIndex = (Number(this.eventIndex) || 0) + 1;
    this.eventStage = null;
    this.event = { round: this.round, index: this.eventIndex, picks: new Map(), packs: new Map(), done: false, rosterUntil: 0 };
    // the monster entry: drawn once for THIS period, on its own stream and before any player picks, so it can never
    // depend on the targets chosen (a separate channel; public to both teams). The odds are unified since 0.0.5.
    const foeKind = eventFoeKindOf(this.rngFoeEvent);
    const foeCard = eventFoeCardOfKind(this.rngFoeEvent, foeKind, this.eventUsedFoe);
    if (foeCard) {
      this.eventUsedFoe.add(foeCard.id);
      this.foeEvent = { round: this.round, index: this.eventIndex, card: foeCard, elite: null };
      // the 强力属性 subset: share / attribute / the marked unit count, all on the seeded rngFoeElite stream
      this.foeEvent.elite = this._drawFoeElite();
      this.eventFoeHistory.push({
        round: this.round, index: this.eventIndex, card: foeCard.id, key: foeCard.key, kind: foeCard.kind,
        elite: this.publicFoeElite(),
      });
      this.broadcast({
        t: 'm.event', round: this.round, index: this.eventIndex,
        foe: { card: foeCard.id, key: foeCard.key, kind: foeCard.kind, elite: this.publicFoeElite() },
      });
    }
    // always timed, also in a single-human versus room: a human who never answers must not stop the match
    this.setDeadline(EVENT_PICK_SECONDS, () => this.timeoutEvent());
    for (const ps of alive) if (ps.botControlled) this.scheduleEventBot(ps);
    this.markPublic();
  }

  /** A botControlled seat (AI, AI 托管, departed): pick at once, like the drafts' AI seats. */
  scheduleEventBot(ps) {
    if (!ps || this.phase !== PHASE.EVENT || !this.event) return;
    const token = this._turnToken;
    this.later(0, () => {
      if (token !== this._turnToken || this.phase !== PHASE.EVENT || !this.event) return;
      if (!ps.botControlled) return;
      if (this.event.picks.has(ps.playerId)) return;
      const target = this.botEventTarget(ps);
      if (target) this._eventPick(ps, target, { auto: true });
    });
  }

  /**
   * The AI's target (0.0.5 需求 1.4, 维护者 2026-10-25 定概率): the ROLLED side comes first (EVENT_AI_OPP_CHANCE %
   * 对面, the rest 自己 / 队友) and within it the seat that has not been selected in THIS period comes first, so
   * several bots spread their packs. Then the other side's un-chosen seat, then the pre-0.0.5 last resort — 自己,
   * 队友, then the opponents. A room with no opposing side (同盟狩猎) never rolls and always ends on its own side.
   * The timeout auto-pick runs exactly this rule (finishEvent).
   */
  botEventTarget(ps) {
    const map = this.eventTargetMap(ps);
    const usable = (key) => {
      const tp = map[key];
      return tp && tp.alive && !tp.left ? tp : null;
    };
    const taken = new Set();
    for (const rec of (this.event && this.event.picks ? this.event.picks.values() : [])) {
      if (rec && rec.targetId) taken.add(rec.targetId);
    }
    const OPP = ['oppA', 'oppB'];
    const OWN = ['self', 'mate'];
    const sides = OPP.some((k) => usable(k)) && this.rngEventTarget() * 100 < EVENT_AI_OPP_CHANCE ? [OPP, OWN] : [OWN, OPP];
    for (const side of sides) {
      for (const key of side) {
        const tp = usable(key);
        if (tp && !taken.has(tp.playerId)) return key;
      }
    }
    for (const key of [...OWN, ...OPP]) if (usable(key)) return key;
    return null;
  }

  /**
   * g.event.pick { target }: give one pack to one target. Server-authoritative validation:
   *   * the phase and the target's map (ERR.WRONG_PHASE / ERR.ELIMINATED / ERR.BAD_TARGET),
   *   * one pick per player per period (ERR.ALREADY); a target may repeat across periods (0.0.5).
   * @param {import('../PlayerState.js').PlayerState} ps
   * @param {'self'|'mate'|'oppA'|'oppB'} target
   */
  pickEvent(ps, target) {
    if (this.phase !== PHASE.EVENT || !this.event) return fail(ERR.WRONG_PHASE);
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    if (!this.eventTargetKeys().includes(target)) return fail(ERR.BAD_TARGET);
    const targetPs = this.eventTargetMap(ps)[target];
    if (!targetPs || !targetPs.alive || targetPs.left) return fail(ERR.BAD_TARGET);
    if (this.event.picks.has(ps.playerId)) return fail(ERR.ALREADY);
    return this._eventPick(ps, target);
  }

  /**
   * Draw and apply the pack of one pick (shared by the intent, the AI and the timeout auto-pick): the pick's side
   * decides the pack kind (oppA / oppB → 对面包 with 1 减益 + 2 中性, self / mate → 我方包 with 1 增益 + 2 中性;
   * EVENT_PACK_KINDS), every entry of the pack lands on the TARGET and lasts its own duration (空手而归-style entries
   * settle at once). A player selected N times in one period simply accumulates N packs.
   */
  _eventPick(ps, target, { auto = false } = {}) {
    const targetPs = this.eventTargetMap(ps)[target];
    if (!targetPs || !targetPs.alive || targetPs.left) return fail(ERR.BAD_TARGET);
    const packKind = target === 'oppA' || target === 'oppB' ? 'opp' : 'own';
    const cards = eventDrawPack(this.rngEvent, packKind, this.eventUsedAlly);
    if (!cards.length) return fail(ERR.INTERNAL);
    if (!Array.isArray(ps.eventCards)) ps.eventCards = [];
    for (const card of cards) ps.eventCards.push(card.id);
    ps.eventTargets.push(target);
    const pack = this._dealPack(targetPs, {
      kind: packKind, from: ps.playerId, target, auto: !!auto,
    }, cards);
    const rec = {
      target, targetId: targetPs.playerId,
      // kept as the first-entry summary an old client reads (`m.event` / `ally.picks`); the full pack is `entries`
      card: cards[0].id, key: cards[0].key, kind: cards[0].kind, mag: 1, auto: !!auto,
      round: this.round, packKind, pack: pack.pack, entries: pack.entries,
    };
    this.event.picks.set(ps.playerId, rec);
    this.broadcast({
      t: 'm.event', round: this.round, index: this.event.index, playerId: ps.playerId,
      target, targetId: targetPs.playerId, card: rec.card, key: rec.key, kind: rec.kind, mag: 1, auto: !!auto,
      packKind, pack: pack.pack, entries: pack.entries,
    });
    this.markPrivate(targetPs);
    this.markPublic();
    this.maybeFinishEvent();
    return OK;
  }

  /**
   * One pack onto a receiver: numbered per receiver within the period (the 2nd selection's pack is #2), each entry
   * pushed into the receiver's eventEntries with its own duration, the one-shot economic deltas applied at once, and
   * the pack recorded in `this.event.packs` for the public 公示 (who was chosen how often, which packs they got).
   * @param {import('../PlayerState.js').PlayerState} targetPs
   * @param {{ kind: 'opp'|'own'|'default', from: string|null, target: string|null, auto?: boolean }} meta
   * @param {Array<{ id: number, key: string, kind: string }>} cards
   */
  _dealPack(targetPs, meta, cards) {
    const ev = this.event;
    const list = ev && ev.packs ? ev.packs : null;
    const prior = (list && list.get(targetPs.playerId)) || [];
    const pack = prior.length + 1;
    const entries = [];
    cards.forEach((card, slot) => {
      const entryDuration = eventCardDuration(card);
      targetPs.eventEntries.push({
        card, duration: entryDuration, mag: 1, from: meta.from, round: this.round,
        target: meta.target, packKind: meta.kind, pack, slot: slot + 1,
      });
      entries.push({ card: card.id, key: card.key, kind: card.kind });
      // A one-round economic entry (空手而归 −2) has no income window left: R's income settled BEFORE the event period,
      // and R+1 filters it out by duration. Apply the delta once, right here (user 2026-10-21).
      if (entryDuration === 1 && Number(card.goldPerRound)) {
        targetPs.funds = Math.max(0, (Number(targetPs.funds) || 0) + Math.round(Number(card.goldPerRound)));
      }
    });
    targetPs.eventMods = eventModsFor(targetPs.eventEntries, this.round);
    if (list) {
      const rec = {
        kind: meta.kind, from: meta.from ?? null, target: meta.target ?? null,
        auto: !!meta.auto, pack, entries,
      };
      list.set(targetPs.playerId, [...prior, rec]);
    }
    return { pack, entries };
  }

  /** Every alive seat has picked → the roster hold. */
  maybeFinishEvent() {
    if (this.phase !== PHASE.EVENT || !this.event || this.event.finishing || this.eventStage === 'roster') return;
    const alive = this.alivePlayers();
    if (!alive.length) { this.finishEvent(); return; }
    if (alive.every((ps) => this.event.picks.has(ps.playerId))) this.finishEvent();
  }

  /** The deadline (EVENT_PICK_SECONDS): auto-pick every seat that has not answered, then the roster hold. */
  timeoutEvent() {
    if (this.phase !== PHASE.EVENT || !this.event || this.eventStage === 'roster') return;
    this.finishEvent();
  }

  /**
   * Close the period (auto-picking whoever is missing), deal every unchosen player their 默认包 floor, archive every
   * entry in eventHistory and open the roster hold.
   */
  finishEvent() {
    if (this.phase !== PHASE.EVENT || !this.event || this.eventStage === 'roster') return;
    const ev = this.event;
    if (ev.finishing) return;
    ev.finishing = true;
    this.setDeadline(0);
    for (const ps of this.alivePlayers()) {
      if (ev.picks.has(ps.playerId)) continue;
      const target = this.botEventTarget(ps);
      if (target) this._eventPick(ps, target, { auto: true });
    }
    // the 默认包 floor (0.0.5 需求 1.3, 每人每事件保底): a player selected 0 times gets one pack of 3 中性
    for (const ps of this.alivePlayers()) {
      const packs = ev.packs && ev.packs.get ? ev.packs.get(ps.playerId) : null;
      if (packs && packs.length) continue;
      const cards = eventDrawPack(this.rngEvent, 'default', this.eventUsedAlly);
      if (cards.length) this._dealPack(ps, { kind: 'default', from: null, target: null }, cards);
    }
    // archive: one history row PER ENTRY (flat, each carrying its 包序 / 包类型 marker), in pack-deal order
    for (const [receiverId, packs] of (ev.packs || new Map())) {
      for (const p of packs) {
        p.entries.forEach((e, i) => {
          this.eventHistory.push({
            round: ev.round, index: ev.index, playerId: p.from, target: p.target, targetId: receiverId,
            card: e.card, key: e.key, kind: e.kind, mag: 1, auto: !!p.auto,
            duration: eventCardDuration(eventCardById(e.card) || eventCardByKey(e.key)),
            packKind: p.kind, pack: p.pack, slot: i + 1,
          });
        });
      }
    }
    ev.done = true;
    this._eventDoneRound = this.round;
    this.markPublic();
    this.enterEventRoster();
  }

  /**
   * 词条公示 (user 2026-10-17, addendum): after every seat has picked (or the timeout filled the AI seats in), keep
   * PHASE.EVENT for EVENT_ROSTER_MS so everyone can read the full roster before the round continues. Server-timed
   * through setDeadline → later → scaled (virtual time and goldens agree); no bare setTimeout. Idempotent: a second
   * call while the roster runs returns false and does not schedule another timer.
   * @returns {boolean} whether a roster hold was opened now
   */
  enterEventRoster() {
    if (this.phase !== PHASE.EVENT || !this.event) return false;
    if (this.eventStage === 'roster') return false;
    const ms = Math.max(0, Number(EVENT_ROSTER_MS) || 0);
    if (!(ms > 0)) { this.continueAfterEvent(); return false; }
    this.eventStage = 'roster';
    this.event.rosterUntil = this.sched.now() + this.scaled(ms);
    this.setDeadline(ms / 1000, () => this.finishEventRoster());
    this.markPublic();
    return true;
  }

  /** The roster's deadline: clear the stage and continue to 机变 / 休整期. */
  finishEventRoster() {
    if (this.phase !== PHASE.EVENT || this.eventStage !== 'roster') return;
    this.eventStage = null;
    this.setDeadline(0);
    if (this.event) this.event.rosterUntil = 0;
    this.markPublic();
    this.continueAfterEvent();
  }

  /** Resume the round flow after the event: the 机变 draft or the prep, exactly as afterRoundStart would. */
  continueAfterEvent() {
    if (this.gd.spRounds().includes(this.round)) this.enterSpDraft();
    else this.enterPrep();
  }

  /** The public shape of the current period's 强力属性 subset: { share, attr, count } (or null). */
  publicFoeElite() {
    const e = this.foeEvent && this.foeEvent.elite;
    return e ? { share: e.share, attr: e.attr, count: e.count } : null;
  }

  /**
   * Draw the period's 强力属性 subset: a share from EVENT_FOE_ELITE_SHARES (15 %~20 % in every period since 0.0.5),
   * one attribute from EVENT_FOE_ELITES, and `count = max(1, round(share × the carded normal wave's monster count))`.
   * Seeded `rngFoeElite` (share, then attribute); WHICH units are marked is decided by spawn order at application time
   * (foeEliteSpawns), never by Math.random.
   */
  _drawFoeElite() {
    const shares = EVENT_FOE_ELITE_SHARES;
    const share = shares[Math.max(0, Math.min(shares.length - 1, Math.floor(this.rngFoeElite() * shares.length)))];
    const attrs = EVENT_FOE_ELITES;
    const attr = attrs[Math.max(0, Math.min(attrs.length - 1, Math.floor(this.rngFoeElite() * attrs.length)))];
    const carded = this.foeEventSpawns(this.wave && Array.isArray(this.wave.spawns) ? this.wave.spawns : []);
    const total = carded.reduce((n, s) => n + (s && s.tag !== 'bounty' ? Math.max(1, Math.trunc(Number(s.count) || 1)) : 0), 0);
    const count = Math.max(1, Math.round(share * total));
    const mods = {};
    for (const k of ['atkMul', 'hpMul', 'defMul', 'speedMul']) if (Number.isFinite(attr[k]) && attr[k] > 0) mods[k] = attr[k];
    return { share, attr: attr.key, count, mods };
  }

  /**
   * Apply the period's elite subset to a wave spawn list (call AFTER foeEventSpawns: the card's countAdd changes the
   * wave). Normal runs only: `tag === 'bounty'` entries are never marked, and the caller never passes the 狩猎期
   * placements (they are appended later). The first `elite.count` units in spawn order are marked — deterministic by
   * spawn sequence — and a marked run is split into a normal part and an `elite: true` part, preserving time / interval
   * and the total count; the elite part carries the attribute's multipliers on top of the card's. Never mutates the input.
   */
  foeEliteSpawns(list) {
    const foe = this.foeEvent && this.foeEvent.round === this.round ? this.foeEvent : null;
    const elite = foe && foe.elite;
    if (!elite || !Array.isArray(list)) return list;
    // The applied count follows the ACTUAL list (normal wave + 赏金怪): count = max(1, round(share × this wave's
    // monsters)). The public m.public.event.foe.elite.count is the match-wide base-wave announcement; a player with
    // bounty spawns gets the same share/attribute with those extra units included here.
    const total = list.reduce((n, s) => n + (s && typeof s === 'object' ? Math.max(1, Math.trunc(Number(s.count) || 1)) : 0), 0);
    let left = Math.max(1, Math.round(elite.share * total));
    const out = [];
    for (const s of list) {
      if (!s || typeof s !== 'object') { out.push(s); continue; }
      const c = Math.max(1, Math.trunc(Number(s.count) || 1));
      const e = Math.min(c, left);
      if (!e) { out.push(s); continue; }
      left -= e;
      const mods = { ...(s.mods && typeof s.mods === 'object' ? s.mods : {}) };
      for (const [k, v] of Object.entries(elite.mods || {})) mods[k] = (Number.isFinite(mods[k]) && mods[k] > 0 ? mods[k] : 1) * v;
      if (e >= c) { out.push({ ...s, mods, elite: true }); continue; }
      const interval = Number(s.interval) || 0;
      const normal = c - e;
      out.push({ ...s, count: normal, ...(normal === 1 ? { interval: 0 } : null) });
      out.push({ ...s, count: e, time: (Number(s.time) || 0) + normal * interval, ...(e === 1 ? { interval: 0 } : null), mods, elite: true });
    }
    return out;
  }

  /**
   * The round's wave with the monster card and then the 强力属性 subset applied. The card's stat mods reach the 赏金怪
   * too (tag 'bounty'), but its COUNT changes (增援 / 稀疏 / 替换) only touch the normal wave — a bounty's per-kill
   * `bounty.coins` and its total payout must never move. The 狩猎期 placements are appended after this call.
   */
  foeWaveSpawns(list) {
    if (!Array.isArray(list)) return list;
    const carded = list.map((s) => (s && typeof s === 'object' ? this.foeEventSpawns([s], { countAdd: s.tag !== 'bounty' })[0] : s));
    return this.foeEliteSpawns(carded);
  }

  /**
   * Merge this period's monster entry into a round's spawn list. Only the ENEMY side: the engine's spawn multipliers
   * (hpMul / atkMul / defMul / speedMul, composed with the round's own scaling) and, with `countAdd`, `countAdd` per
   * spawn run (clamped to ≥ 1). Never touches a player's state or a bounty amount: callers apply it to the wave
   * (foeWaveSpawns) and never to the 狩猎期 placements.
   * @param {object[]} list SpawnSpecs
   * @param {{ countAdd?: boolean }} [opts] countAdd false: stats only (the 赏金怪 path)
   * @returns {object[]} copies with the entry merged (the input is never mutated)
   */
  foeEventSpawns(list, { countAdd = true } = {}) {
    const foe = this.foeEvent && this.foeEvent.round === this.round ? this.foeEvent.card : null;
    if (!foe || !Array.isArray(list)) return list;
    const mul = (a, b) => (Number.isFinite(a) && a > 0 ? a : 1) * (Number.isFinite(b) && b > 0 ? b : 1);
    const add = countAdd ? Math.trunc(Number(foe.countAdd) || 0) : 0;
    return list.map((s) => {
      if (!s || typeof s !== 'object') return s;
      const mods = s.mods && typeof s.mods === 'object' ? { ...s.mods } : {};
      if (foe.hpMul) mods.hpMul = mul(mods.hpMul, foe.hpMul);
      if (foe.atkMul) mods.atkMul = mul(mods.atkMul, foe.atkMul);
      if (foe.defMul) mods.defMul = mul(mods.defMul, foe.defMul);
      if (foe.speedMul) mods.speedMul = mul(mods.speedMul, foe.speedMul);
      const count = add ? Math.max(1, Math.trunc(Number(s.count) || 1) + add) : s.count;
      return { ...s, mods, ...(add ? { count } : null) };
    });
  }

  /** The extra 赏金 one placed-monster kill pays this receiver (赏金嗅觉, 0 without it). */
  eventBountyBonusOf(ps) {
    return Math.max(0, Math.trunc(Number(ps && ps.eventMods && ps.eventMods.bountyGold) || 0));
  }

  /**
   * m.public.event — the two public channels:
   *   ally: the four target maps, each seat's available keys, this period's picks + dealt packs (who was chosen how
   *         many times and which packs they got — 0.0.5 需求 1.5) and the whole match's entry history (one row per
   *         entry, each carrying its pack marker);
   *   foe:  this period's monster entry (null entry = no draw yet) and every period's monster history.
   * Both are public to BOTH teams by design (the cost entries affect the economy; the monster entry shapes the round).
   * The 0.0.5 additions (`selected` / `packs`, `packKind` / `pack` / `slot` on the rows) are optional fields: an old
   * client simply ignores what it does not know.
   */
  eventView() {
    if (!this.huntMode || (!this.event && !this.eventHistory.length && !this.eventFoeHistory.length)) return null;
    const ev = this.event;
    const foe = this.foeEvent;
    // the period's public pack roster: per receiver, the packs in deal order + how many times they were SELECTED
    const packs = {};
    const selected = {};
    for (const ps of this.order) selected[ps.playerId] = 0;
    if (ev && ev.packs) {
      for (const [pid, list] of ev.packs) {
        packs[pid] = list.map((p) => ({
          kind: p.kind, from: p.from ?? null, target: p.target ?? null, pack: p.pack, auto: !!p.auto,
          entries: p.entries.map((e) => ({ card: e.card, key: e.key, kind: e.kind })),
        }));
        selected[pid] = list.filter((p) => p.kind !== 'default').length;
      }
    }
    return {
      ally: {
        rounds: (this.eventRounds || []).slice(),
        round: ev ? ev.round : null,
        index: ev ? ev.index : (Number(this.eventIndex) || 0),
        active: this.phase === PHASE.EVENT,
        // an entry stays in force this many rounds (picked … picked+duration−1); history keeps every entry
        duration: EVENT_DURATION_ROUNDS,
        done: !!(ev && ev.done),
        stage: this.eventStage || null,
        roster: this.eventStage === 'roster' ? { until: (ev && ev.rosterUntil) || 0, ms: EVENT_ROSTER_MS } : null,
        deadline: this.phase === PHASE.EVENT ? this.deadline : 0,
        targets: Object.fromEntries(this.order.map((ps) => [ps.playerId, this.eventTargetIds(ps)])),
        available: Object.fromEntries(this.order.map((ps) => [ps.playerId, this.eventAvailableTargets(ps)])),
        picks: ev ? Object.fromEntries(ev.picks) : {},
        // 0.0.5 需求 1.5 公示数据: 本次事件谁被选了几次 (selected)、各收什么包 (packs)
        selected,
        packs,
        history: this.eventHistory.map((r) => ({ ...r })),
      },
      foe: {
        rounds: (this.eventRounds || []).slice(),
        round: foe ? foe.round : null,
        index: foe ? foe.index : 0,
        active: this.phase === PHASE.EVENT,
        card: foe ? foe.card.id : null,
        key: foe ? foe.card.key : null,
        kind: foe ? foe.card.kind : null,
        elite: foe ? this.publicFoeElite() : null,
        history: this.eventFoeHistory.map((r) => ({ ...r })),
      },
    };
  }
}
