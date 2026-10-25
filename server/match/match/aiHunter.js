// server/match/match/aiHunter.js — 「猎手 AI」(the AI 狩猎模式, 维护者 2026-10-25): a botControlled seat's 狩猎期
// placement stops being a self-centred greedy fill and starts ANSWERING the player it aims at.
//
// What it decides (and nothing else):
//   1. WHICH opponent seat to aim at — the answer that hurts most, and the seat that is already behind;
//   2. WHICH monsters to name — ranked by how well each one answers that player's fielding, per budget point it costs;
//   3. WHEN to insert them — 'front' presses a board that has not stood up yet, 'back' lands after a wall has spent
//      its block and healing, 'mid' otherwise;
//   4. the strongest tier only, whether to use the free 事件期 boss 格 (K3).
//
// What it never does: it does not get more budget, more candidates, another cap or a different gate rule — the finished
// plan is handed to the SAME validator a human `g.confront` passes (Match._confrontMember, confront.js), and if that
// refuses anything the caller keeps the pre-0.0.5 greedy plan. An illegal AI plan therefore cannot reach a wave, and an
// AI can never out-spend a player. [ASSUMED] the ranking, the weights and the deficiency curves: the official mode has
// no AI opponent, so no source sets them (AI_HUNT in shared/constants.js holds every number, one line each to tune).
//
// Information boundary (K2, 维护者 2026-10-25): the read-out is the target's FIELDING only — `boardReadout` takes
// (gd, board) and never sees the hand, the shop, the funds, the 坎诺特 balance or the pieces not on the field. It reads
// base chess stats, so equipment / 特质 are not modelled.
//
// Determinism: every choice comes from the seeded `rngAiHunt` stream (Match.js, name 'ai-hunt') and a total order with
// a `key` tiebreak, so the same seed replays the same hunt. No Math.random, no clock, no IO.
//
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { AI_HUNT, VERSUS_CONFRONT } from '../../../shared/constants.js';
import { confrontTraitGrade } from './confrontTraits.js';

/**
 * The tier of a difficulty (K1: the tier is bound to the difficulty, never to a room setting). Anything unknown reads
 * as 'off', so a future difficulty cannot silently start hunting.
 * @param {string} difficulty
 * @param {boolean} versus
 * @returns {'off'|'weak'|'mid'|'strong'}
 */
export function aiHuntTierOf(difficulty, versus) {
  if (!AI_HUNT.enabled || !versus) return 'off';
  const t = AI_HUNT.tier[String(difficulty || '').toUpperCase()];
  return t === 'weak' || t === 'mid' || t === 'strong' ? t : 'off';
}

/**
 * The monster's counter tags, read out of the shipped data only: `acTypes` (INVISIBLE / TIMES / DOT / ELEMENT /
 * REFLECTION / FLY / SPECIAL), `applyWay`, `isFlyEnemy`, its own stats, `summons` and the 狩猎期 特性 grade the value
 * table already uses. One tag = one thing the target's fielding may be short of.
 * @param {import('../gamedata.js').GameData} gd
 * @param {string} enemyKey
 * @returns {string[]} the tags this monster carries (a subset of the keys of AI_HUNT.weights)
 */
export function enemyTagsOf(gd, enemyKey) {
  const e = gd && typeof gd.enemy === 'function' ? gd.enemy(enemyKey) : null;
  if (!e) return [];
  const s = e.stats || {};
  const ac = Array.isArray(e.acTypes) ? e.acTypes : [];
  const out = [];
  if (e.isFlyEnemy || ac.includes('FLY')) out.push('fly');
  if (e.applyWay === 'RANGED') out.push('ranged');
  if (ac.includes('INVISIBLE')) out.push('invisible');
  if (ac.includes('TIMES')) out.push('times');
  if (ac.includes('DOT')) out.push('dot');
  if (ac.includes('ELEMENT')) out.push('element');
  if (ac.includes('REFLECTION')) out.push('reflection');
  if (num(s.def) >= num(AI_HUNT.refs.def)) out.push('armor');
  if (num(s.res) >= num(AI_HUNT.refs.res)) out.push('resist');
  if (num(s.hpRecoveryPerSec) > 0) out.push('sustain');
  if (Array.isArray(e.summons) && e.summons.length) out.push('summon');
  if (confrontTraitGrade(enemyKey) >= 3) out.push('elite');
  if (num(s.atk) >= num(AI_HUNT.refs.atk)) out.push('hard');
  return out;
}

const num = (v) => (Number.isFinite(v) ? v : 0);

/**
 * What one seat's fielding looks like (K2: the board and nothing else — never the hand, the shop, the funds or the
 * 坎诺特 balance). Everything is kept as a sum or a share so the deficiency curves below stay scale-free.
 * @param {import('../gamedata.js').GameData} gd
 * @param {Map<string, object>} board the PlayerState's board (keys "row,col")
 * @returns {{pieces:number, atk:number, antiAir:number, arts:number, phys:number, block:number, melee:number, ranged:number, burst:number, regen:number}}
 */
export function boardReadout(gd, board) {
  const out = { pieces: 0, atk: 0, antiAir: 0, arts: 0, phys: 0, block: 0, melee: 0, ranged: 0, burst: 0, regen: 0 };
  if (!gd || !(board instanceof Map)) return out;
  for (const p of board.values()) {
    if (!p || p.kind !== 'chess') continue;
    const c = gd.chess(p.id);
    if (!c) continue;
    const s = c.stats || {};
    const atk = num(s.atk);
    out.pieces += 1;
    out.atk += atk;
    if (c.canHitFly === true) out.antiAir += atk;
    if (c.dmgType === 'arts') out.arts += atk;
    else if (c.dmgType === 'phys') out.phys += atk;
    out.block += num(s.blockCnt);
    out.regen += num(s.hpRecoveryPerSec);
    if (c.attackKind === 'melee') out.melee += 1;
    else if (c.attackKind === 'ranged') out.ranged += 1;
    out.burst = Math.max(out.burst, atk * Math.max(1, num(s.aspd)));
  }
  return out;
}

/** A share in [0,1] with a safe 0/0 → `when` (an empty board is maximally exposed, not infinitely covered). */
const share = (part, total, when = 1) => (total > 0 ? Math.min(1, Math.max(0, part / total)) : when);
/** How much of a reference value the board is MISSING, in [0,1]. */
const gapOf = (have, ref) => Math.min(1, Math.max(0, 1 - num(have) / Math.max(1, num(ref))));

/**
 * How much ONE monster answers ONE fielding: Σ (tag weight × that tag's deficiency). A board that covers everything
 * scores near 0 and the plan falls back to plain value; a board with a hole pays for it. The tags point at a real
 * engine rule each: 飞行 wants `canHitFly`, 隐匿 becomes targetable once blocked (server/sim/targeting.js), 频次 / 自愈 /
 * 召唤 want burst, 高甲 wants arts, 高法抗 wants phys, 反射 punishes a single big hitter.
 * @param {string[]} tags enemyTagsOf(...)
 * @param {object} read boardReadout(...)
 * @returns {number}
 */
export function counterScore(tags, read) {
  const w = AI_HUNT.weights;
  const refs = AI_HUNT.refs;
  const atkBase = read.atk || 0;
  let score = 0;
  for (const t of tags) {
    const weight = num(w[t]);
    if (!weight) continue;
    let need;
    switch (t) {
      case 'fly': need = 1 - share(read.antiAir, atkBase, 1); break;
      case 'ranged': need = read.pieces > 0 ? read.melee / read.pieces : 1; break;
      case 'invisible': need = gapOf(read.block, refs.block); break;
      case 'times':
      case 'sustain':
      case 'summon': need = gapOf(read.burst, refs.atk); break;
      case 'dot':
      case 'element': need = share(read.block, refs.block, 0); break;
      case 'armor': need = 1 - share(read.arts, atkBase, 1); break;
      case 'resist': need = share(read.phys, atkBase, 0.5); break;
      case 'reflection': need = share(read.burst, refs.atk, 0); break;
      case 'elite': need = gapOf(read.pieces, refs.pieces); break;
      case 'hard': need = gapOf(read.block, refs.block); break;
      default: need = 0; break;
    }
    score += weight * Math.min(1, Math.max(0, need));
  }
  return Math.round(score * 100) / 100;
}

/** The total order of one candidate list: best answer per budget point first, then the plainest key. */
function rankCandidates(list) {
  return list.slice().sort((a, b) => ((b.score + 1) / Math.max(1, b.value)) - ((a.score + 1) / Math.max(1, a.value))
    || b.score - a.score || String(a.key).localeCompare(String(b.key)));
}

/** Draw one candidate from the top `width` of an already-ranked list (width 1 = always the best). One rng() call. */
function drawRanked(rng, ranked, width) {
  const n = Math.max(1, Math.min(num(width) || 1, ranked.length));
  return ranked[Math.max(0, Math.min(n - 1, Math.floor(rng() * n)))];
}

export class MatchAiHunter {
  /** The tier this match hunts at ('off' outside 2V2, on FUNNY, or with the master switch off). */
  aiHuntTier() { return aiHuntTierOf(this.difficulty, this.isVersus); }

  /** The fielding of the seat this bot is aiming at, or null when nothing is decided yet. */
  _aiHuntReadout(playerId) {
    const ps = playerId ? this.players.get(playerId) : null;
    if (!ps) return null;
    return boardReadout(this.gd, ps.board);
  }

  /**
   * Which free opponent seat to aim at (replaces the old first-empty-seat pick for bot seats): rank the candidates by
   * the best answer their own fielding offers, plus a pressure bonus for a seat that is thin on pieces (it has less
   * left to answer the placement with). Draws from the tier width, so a weaker AI splits its aim.
   * @param {string[]} free the opponent playerIds still un-aimed by this team
   * @returns {string|null} null: the caller keeps `free[0]`
   */
  aiHunterTarget(free) {
    const tier = this.aiHuntTier();
    if (tier === 'off' || !Array.isArray(free) || !free.length) return null;
    if (free.length === 1) return free[0];
    const groups = this.confrontGroups() || [];
    const ranked = [];
    for (const pid of free) {
      const read = this._aiHuntReadout(pid);
      if (!read) continue;
      let best = 0;
      for (const g of groups) for (const r of g.rows || []) best = Math.max(best, counterScore(enemyTagsOf(this.gd, r.key), read));
      const thin = 1 - Math.min(1, read.pieces / Math.max(1, num(AI_HUNT.refs.pieces)));
      ranked.push({ key: pid, score: best + num(AI_HUNT.pressure.thin) * thin });
    }
    if (!ranked.length) return null;
    ranked.sort((a, b) => b.score - a.score || String(a.key).localeCompare(String(b.key)));
    return drawRanked(this.rngAiHunt, ranked, AI_HUNT.width[tier]).key;
  }

  /** The insertion slot for a tier: press a thin board early, land after a wall has spent itself, otherwise mid. */
  aiHunterPosition(read, tier) {
    const allowed = AI_HUNT.positions[tier] || ['mid'];
    if (allowed.length === 1) return allowed[0];
    const thin = read.pieces <= Math.max(1, Math.floor(num(AI_HUNT.refs.pieces) / 3));
    if (thin && allowed.includes('front')) return 'front';
    const wall = read.block >= num(AI_HUNT.refs.block) || read.regen > 0;
    if (wall && allowed.includes('back')) return 'back';
    return allowed.includes('mid') ? 'mid' : allowed[0];
  }

  /** The 事件期 boss 格 picks (K3: the strongest tier only), same cap and same no-budget rule as a human's. */
  aiHunterBosses(read, tier) {
    if (!AI_HUNT.bossTiers.includes(tier) || !this.confrontBossOpen()) return [];
    const cap = Math.max(0, num(this.confrontBossCap()));
    if (!cap) return [];
    const ranked = rankCandidates((this.confrontBossPool() || [])
      .map((b) => ({ key: b.key, value: 1, score: counterScore(enemyTagsOf(this.gd, b.key), read) }))
      .filter((c) => c.score > 0));
    const out = [];
    const used = new Set();
    while (out.length < cap) { // loop-cap: confrontBossCap(), and the scored pool shrinks each pass
      const pool = ranked.filter((c) => !used.has(c.key));
      if (!pool.length) break;
      const c = drawRanked(this.rngAiHunt, pool, AI_HUNT.width[tier]);
      used.add(c.key);
      out.push({ enemyKey: c.key, gate: out.length % 2 ? 'upper' : 'lower' });
    }
    return out;
  }

  /**
   * The bot's whole 狩猎期 submission, or null to keep the pre-0.0.5 greedy plan. Picks are drawn from the counter
   * ranking (breadth first: a monster is repeated only once every un-repeated candidate is unaffordable), the budget
   * and `maxPicks` stay the human ones, and the result is validated by `_confrontMember` before it is returned.
   * @param {import('../PlayerState.js').PlayerState} ps the bot seat placing the hunt
   * @returns {object|null} the submission record, already checked
   */
  aiHunterPlan(ps) {
    const tier = this.aiHuntTier();
    if (tier === 'off') return null;
    const read = this._aiHuntReadout(this.confrontTargets.get(ps.playerId));
    if (!read) return null;
    const groups = this.confrontGroups() || [];
    const flat = [];
    groups.forEach((g, gi) => {
      for (const r of g.rows || []) flat.push({ key: r.key, value: r.value, group: gi + 1, score: counterScore(enemyTagsOf(this.gd, r.key), read) });
    });
    if (!flat.length) return null;
    const ranked = rankCandidates(flat);
    let left = this.confrontBudget();
    const picks = [];
    const once = new Set();
    while (picks.length < num(VERSUS_CONFRONT.maxPicks)) { // loop-cap: VERSUS_CONFRONT.maxPicks, and every pass spends budget
      const fresh = ranked.filter((c) => !once.has(c.key) && c.value <= left);
      // breadth first; only once nothing new fits does the plan repeat an answer that still fits
      const pool = fresh.length ? fresh : ranked.filter((c) => c.value <= left);
      if (!pool.length) break;
      const c = drawRanked(this.rngAiHunt, pool, AI_HUNT.width[tier]);
      once.add(c.key);
      left -= c.value;
      picks.push({ enemyKey: c.key, gate: picks.length % 2 ? 'upper' : 'lower' });
    }
    if (!picks.length) return null;
    const first = ranked.find((c) => c.key === picks[0].enemyKey);
    const position = this.aiHunterPosition(read, tier);
    const bosses = this.aiHunterBosses(read, tier);
    const member = this._confrontMember(ps, first ? first.group : 1, position, picks, bosses);
    return member && !member.error ? member.sub : null;
  }
}
