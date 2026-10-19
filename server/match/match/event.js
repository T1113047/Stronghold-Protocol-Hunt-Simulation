// server/match/match/event.js — Match methods: the 2V2 事件期 (类肉鸽词条). Three periods per match, aligned with the
// 狩猎期: E1 = contestStartRound (R4/R5/R6), E2 = E1 + 4 (R8/R9/R10), E3 = R13 (the 最终狩猎); none is a boss round.
// Each period runs after ROUND_START and before that round's 机变 / 休整期. Every event draws TWO entries:
//   1. the ally entry: every alive player picks ONE of four targets (self / mate / oppA / oppB); a target cannot be
//      picked twice by the same player in one match. The TYPE odds move with the sequence (EVENT_SEQUENCE: E1 friendly,
//      E2 neutral, E3 debuff-heavy) and the entry is drawn from EVENT_CARDS with the seeded `rngEvent` stream. The ally
//      pool is shared: a card already drawn in this match is not drawn again while the kind has an unused card (and
//      never twice for the same player);
//   2. the monster entry: drawn once when the period opens, on its own seeded stream (`rngFoeEvent`), independent of the
//      target choices, with its own per-sequence odds. It merges into THAT round's wave (normal + 赏金怪, never a
//      player's mods, never a bounty amount). Each period ALSO marks a share of that wave as 强力 with one extra
//      attribute (EVENT_FOE_ELITES, its own `rngFoeElite` stream; the marked runs carry `elite: true`).
//
// Effect injection: the ally entries accumulate on the target's PlayerState (eventEntries / eventMods). Battles receive
// one `event:` EffectRef per entry (PlayerState.battleInput → server/sim/content/event.js reads them), the economy hooks
// read the same fields: income (startRound), refresh / sell prices (economy.js), the deploy cap (basics.js) and the
// placed-monster bounty (confront.js applyConfront, +3 coins per kill). An entry is in force for EVENT_DURATION_ROUNDS
// rounds from the one it was picked in (round … round+duration−1), then expires: eventModsFor / eventBattleRefs filter
// the accumulated log by the current round; startRound re-derives eventMods each round. History keeps all picks.
//
// The phase is timed (EVENT_PICK_SECONDS; always, also in a single-human versus room) and every botControlled seat picks
// at once. A timeout — or a seat that never answers — is auto-picked by botEventTarget (the highest expected value),
// so the phase can never stall.
//
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import {
  PHASE, ERR, EVENT_TARGETS, EVENT_SELF_MUL, EVENT_PICK_SECONDS, EVENT_CARDS, EVENT_SEQUENCE,
  EVENT_FOE_CARDS, EVENT_FOE_ELITES, EVENT_ROSTER_MS, EVENT_DURATION_ROUNDS, COOP_HUNT,
} from '../../../shared/constants.js';
import { OK, fail } from './common.js';

const CARD_BY_ID = new Map(EVENT_CARDS.map((c) => [c.id, c]));
const CARD_BY_KEY = new Map(EVENT_CARDS.map((c) => [c.key, c]));
const FOE_BY_ID = new Map(EVENT_FOE_CARDS.map((c) => [c.id, c]));
const FOE_BY_KEY = new Map(EVENT_FOE_CARDS.map((c) => [c.key, c]));
const ELITE_BY_KEY = new Map(EVENT_FOE_ELITES.map((c) => [c.key, c]));
/** The event sequence row of a 1-based order (clamped; default E2). */
const sequenceAt = (sequence) => EVENT_SEQUENCE[Math.max(0, Math.min(EVENT_SEQUENCE.length - 1, (Number(sequence) || 2) - 1))];
/** The ally entry of an id (1…24) / key, or null. */
export const eventCardById = (id) => CARD_BY_ID.get(id) ?? null;
export const eventCardByKey = (key) => CARD_BY_KEY.get(key) ?? null;
/** The monster entry of an id (1…12) / key, or null. */
export const eventFoeCardById = (id) => FOE_BY_ID.get(id) ?? null;
export const eventFoeCardByKey = (key) => FOE_BY_KEY.get(key) ?? null;
/** A 强力属性 (elite attribute) of a key, or null. */
export const eventFoeEliteByKey = (key) => ELITE_BY_KEY.get(key) ?? null;

/**
 * Type odds of an ally pick in a sequence (1…3; default E2). The sequence row applies to the ally channel as a whole —
 * the target decides WHO receives the entry, not the odds (user 2026-10-17's per-order table supersedes the old
 * target-kind split).
 */
export function eventOddsFor(target, sequence = 2) {
  void target;
  return sequenceAt(sequence).allyOdds;
}

/**
 * The magnitude multiplier of a target: 2 for self (EVENT_SELF_MUL), 1 otherwise — it scales every numeric value of the
 * entry (ATTACK / HP / DEF / ASPD / SP / gold / regen / taken / enemy speed, and the refresh-uses count).
 */
export const eventMagnitude = (target) => (target === 'self' ? EVENT_SELF_MUL : 1);

/**
 * Draw the type of a pick: one rng() call against the sequence's ally odds in percent (down / mid / up).
 * @param {() => number} rng seeded stream (match.rngEvent)
 * @param {string} target target key (kept for call-site clarity; odds are per sequence)
 * @param {number} [sequence] 1-based event order (default 2)
 * @returns {'down'|'mid'|'up'}
 */
export function eventKindOf(rng, target, sequence = 2) {
  const odds = eventOddsFor(target, sequence);
  const r = rng() * 100;
  if (r < odds.down) return 'down';
  if (r < odds.down + odds.mid) return 'mid';
  return 'up';
}

/** Draw one entry of a type uniformly (one rng() call). */
export function eventCardOfKind(rng, kind) {
  const pool = EVENT_CARDS.filter((c) => c.kind === kind);
  if (!pool.length) return null;
  const i = Math.max(0, Math.min(pool.length - 1, Math.floor(rng() * pool.length)));
  return pool[i];
}

/** One entry of a pool uniformly among the entries whose id is not in `used`; null when every one is used. */
function pickUnused(rng, pool, used) {
  const avail = pool.filter((c) => !used || !used.has(c.id));
  if (!avail.length) return null;
  const i = Math.max(0, Math.min(avail.length - 1, Math.floor(rng() * avail.length)));
  return avail[i];
}

/**
 * Draw the ally entry of a rolled type without repeating a card of this match: first among the match's unused cards of
 * that type, then any match-unused card (a kind whose shared bag is empty — with 24 cards and at most 12 ally draws the
 * whole pool never runs out, so the match sees NO duplicate), then that player's unused cards of the type, then the
 * type's first card (unreachable today).
 * @param {() => number} rng
 * @param {'down'|'mid'|'up'} kind
 * @param {Set<number>} usedMatch cards already drawn this match
 * @param {Set<number>} usedPlayer cards already drawn by this player
 */
export function eventDrawAlly(rng, kind, usedMatch = new Set(), usedPlayer = new Set()) {
  const byKind = EVENT_CARDS.filter((c) => c.kind === kind);
  return pickUnused(rng, byKind, usedMatch)
    ?? pickUnused(rng, EVENT_CARDS, usedMatch)
    ?? pickUnused(rng, byKind, usedPlayer)
    ?? byKind[0]
    ?? null;
}

/** The type odds of a monster entry in a sequence (1…3; default E2). */
export const eventFoeOdds = (sequence = 2) => sequenceAt(sequence).foeOdds;

/** Draw the monster entry's type (one rng() call against the sequence's foe odds). */
export function eventFoeKindOf(rng, sequence = 2) {
  const odds = eventFoeOdds(sequence);
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
 * The expected value of the monster draw from OUR side: the sequence's odds over the three type means. E2 is exactly
 * −0.10 (tier 2); E1 is +0.10, E3 −0.25 — see the report for the full table.
 */
export function eventFoeEv(sequence = 2) {
  const odds = eventFoeOdds(sequence);
  return (odds.favor * eventFoeMeanEv('favor') + odds.mid * eventFoeMeanEv('mid') + odds.unfavor * eventFoeMeanEv('unfavor')) / 100;
}

/** The mean AI value of a type's entries (0 when the type is empty — impossible today). */
function meanEv(kind) {
  const pool = EVENT_CARDS.filter((c) => c.kind === kind);
  if (!pool.length) return 0;
  return pool.reduce((n, c) => n + (Number(c.ev) || 0), 0) / pool.length;
}

/**
 * The expected value of picking `target` in a sequence, from the PICKER's side (the AI's heuristic; not a game rule):
 * self = +EV × EVENT_SELF_MUL, mate = +EV, an opponent = −EV (a benefit to the opponent is a loss for us).
 * @param {string} target target key
 * @param {number} [sequence] 1-based event order (default 2)
 */
export function eventEvFor(target, sequence = 2) {
  const odds = eventOddsFor(target, sequence);
  const raw = (odds.down * meanEv('down') + odds.mid * meanEv('mid') + odds.up * meanEv('up')) / 100;
  if (target === 'self') return raw * EVENT_SELF_MUL;
  if (target === 'mate') return raw;
  return -raw;
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
 * `dmgTakenMul` / `enemySpeedMul` / `moveMul` / `spRecoveryMul` multiply here too (each entry's own value; self ×2
 * doubles the bonus part). Entries are filtered to those in force at `round` (EVENT_DURATION_ROUNDS); no `round` means
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
   * The target keys this player may still pick. 2V2: not used yet and mapped to a seat (a target cannot be repeated in
   * one match). 同盟狩猎 has only two targets for three events, so the no-repeat rule would leave E3 with nothing —
   * co-op keeps both `self` / `mate` available every event [ASSUMED: the user's spec fixes the two targets but not the
   * repeat rule; the 2V2 no-repeat rule cannot hold with two targets and three events].
   */
  eventAvailableTargets(ps) {
    const used = this.isVersus ? new Set(Array.isArray(ps?.eventTargets) ? ps.eventTargets : []) : new Set();
    const map = this.eventTargetMap(ps);
    // a target must be a live seat (self is checked by the caller; mate never points at a dead / departed teammate)
    return this.eventTargetKeys().filter((key) => !used.has(key) && map[key] && map[key].alive && !map[key].left);
  }

  /** Open the round's event period (from MatchPhases.afterRoundStart, at ROUND_START). */
  enterEvent() {
    if (this.phase !== PHASE.ROUND_START || this.eventDue() === false) return;
    const alive = this.alivePlayers();
    if (!alive.length) { this.continueAfterEvent(); return; }
    this.phase = PHASE.EVENT;
    this.eventIndex = (Number(this.eventIndex) || 0) + 1;
    this.eventStage = null;
    this.event = { round: this.round, index: this.eventIndex, picks: new Map(), done: false, rosterUntil: 0 };
    // the monster entry: drawn once for THIS period, on its own stream and before any player picks, so it can never
    // depend on the targets chosen (a separate channel; public to both teams). The sequence row moves its odds.
    const seq = Math.max(1, Math.min(EVENT_SEQUENCE.length, this.eventIndex));
    const foeKind = eventFoeKindOf(this.rngFoeEvent, seq);
    const foeCard = eventFoeCardOfKind(this.rngFoeEvent, foeKind, this.eventUsedFoe);
    if (foeCard) {
      this.eventUsedFoe.add(foeCard.id);
      this.foeEvent = { round: this.round, index: this.eventIndex, card: foeCard, elite: null };
      // the 强力属性 subset: share / attribute / the marked unit count, all on the seeded rngFoeElite stream
      this.foeEvent.elite = this._drawFoeElite(seq);
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
   * The AI's target: the available target with the highest eventEvFor (self ×2 included); a tie takes the earlier key of
   * EVENT_TARGETS (self / mate / oppA / oppB). Null when nothing is left (impossible with 3 events / 4 targets).
   */
  botEventTarget(ps) {
    let best = null;
    for (const key of this.eventAvailableTargets(ps)) {
      const ev = eventEvFor(key);
      if (!best || ev > best.ev + 1e-9) best = { key, ev };
    }
    return best ? best.key : null;
  }

  /**
   * g.event.pick { target }: give one entry to one target. Server-authoritative validation:
   *   * the phase and the target's map (ERR.WRONG_PHASE / ERR.ELIMINATED / ERR.BAD_TARGET),
   *   * no repeated target in this match (ERR.ALREADY).
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
    if (this.isVersus && ps.eventTargets.includes(target)) return fail(ERR.ALREADY, 'target already used this match');
    return this._eventPick(ps, target);
  }

  /** Draw and apply one pick (shared by the intent, the AI and the timeout auto-pick). */
  _eventPick(ps, target, { auto = false } = {}) {
    const targetPs = this.eventTargetMap(ps)[target];
    if (!targetPs || !targetPs.alive || targetPs.left) return fail(ERR.BAD_TARGET);
    const seq = Math.max(1, Math.min(EVENT_SEQUENCE.length, this.eventIndex));
    const kind = eventKindOf(this.rngEvent, target, seq);
    const usedPlayer = new Set(Array.isArray(ps.eventCards) ? ps.eventCards : []);
    const card = eventDrawAlly(this.rngEvent, kind, this.eventUsedAlly, usedPlayer);
    if (!card) return fail(ERR.INTERNAL);
    this.eventUsedAlly.add(card.id);
    if (!Array.isArray(ps.eventCards)) ps.eventCards = [];
    ps.eventCards.push(card.id);
    const mag = eventMagnitude(target);
    const rec = { target, targetId: targetPs.playerId, card: card.id, key: card.key, kind: card.kind, mag, auto: !!auto };
    ps.eventTargets.push(target);
    this.event.picks.set(ps.playerId, rec);
    targetPs.eventEntries.push({ card, duration: eventCardDuration(card), mag, from: ps.playerId, round: this.round, target });
    targetPs.eventMods = eventModsFor(targetPs.eventEntries, this.round);
    this.broadcast({
      t: 'm.event', round: this.round, index: this.event.index, playerId: ps.playerId,
      target, targetId: targetPs.playerId, card: card.id, key: card.key, kind: card.kind, mag, auto: !!auto,
    });
    this.markPrivate(targetPs);
    this.markPublic();
    this.maybeFinishEvent();
    return OK;
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

  /** Close the period (auto-picking whoever is missing), archive it in eventHistory and open the roster hold. */
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
    for (const [playerId, rec] of ev.picks) this.eventHistory.push({ round: ev.round, index: ev.index, playerId, ...rec, duration: eventCardDuration(rec.card) });
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
   * Draw the period's 强力属性 subset: a share from the sequence's eliteShares, one attribute from EVENT_FOE_ELITES, and
   * `count = max(1, round(share × the carded normal wave's monster count))`. Seeded `rngFoeElite` (share, then attribute);
   * WHICH units are marked is decided by spawn order at application time (foeEliteSpawns), never by Math.random.
   */
  _drawFoeElite(sequence = 2) {
    const shares = sequenceAt(sequence).eliteShares;
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
   *   ally: the four target maps, each seat's available keys, this period's picks and the whole match's history;
   *   foe:  this period's monster entry (null entry = no draw yet) and every period's monster history.
   * Both are public to BOTH teams by design (the cost entries affect the economy; the monster entry shapes the round).
   */
  eventView() {
    if (!this.huntMode || (!this.event && !this.eventHistory.length && !this.eventFoeHistory.length)) return null;
    const ev = this.event;
    const foe = this.foeEvent;
    return {
      ally: {
        rounds: (this.eventRounds || []).slice(),
        round: ev ? ev.round : null,
        index: ev ? ev.index : this.eventHistory.length,
        active: this.phase === PHASE.EVENT,
        // an entry stays in force this many rounds (picked … picked+duration−1); history keeps every pick
        duration: EVENT_DURATION_ROUNDS,
        done: !!(ev && ev.done),
        stage: this.eventStage || null,
        roster: this.eventStage === 'roster' ? { until: (ev && ev.rosterUntil) || 0, ms: EVENT_ROSTER_MS } : null,
        deadline: this.phase === PHASE.EVENT ? this.deadline : 0,
        targets: Object.fromEntries(this.order.map((ps) => [ps.playerId, this.eventTargetIds(ps)])),
        available: Object.fromEntries(this.order.map((ps) => [ps.playerId, this.eventAvailableTargets(ps)])),
        picks: ev ? Object.fromEntries(ev.picks) : {},
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
