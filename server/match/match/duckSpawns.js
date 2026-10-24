// server/match/match/duckSpawns.js — 0.0.5 需求 3 (鸭爵特殊怪): on the 事件期 rounds (Match.eventRounds — R4/R8/R13 of a
// R4 start; every round of the draw R4/R5/R6), every player's NORMAL battle mixes exactly ONE special enemy into its wave
// ("每名玩家的波次夹杂 1 只特殊怪"): a random member of the 鸭爵 strategy's enemy pool — 鸭爵 / 高普尼克 / 流泪小子 / 圆仔,
// "与官方鸭爵策略同一池、同一随机方式" (server/sim/content/bands/meta.js duckReplace: the `enemylist` of
// band_ducklord's `round_start_all_player_change_enemy_2`, drawn with `rng.pick` over the same pool in data order). The
// strategy's numbers are copied unchanged (维护者: "就和鸭爵本身一样…不需要做调整啥的"):
//   · "击倒这些敌人者获得1资金奖励（包括联防阶段）" — bounty { coins: DUCK_COINS, ownerPlayerId }, the strategy's own
//     carrier (no `bank` flag: gold, not the 坎诺特 赏金 account — server/sim/battle/deploy.js). The engine pays the
//     KILLER's player, so a 联防 teammate's knock-out counts too (server/sim/battle/economy.js _bountyPayee,
//     test/sim/feedback5-bounty-payee.test.js); a leaked one keeps paying in 联防 through the `mods.bountyCoins` copy
//     (combat.js _sanitizeSpawns, unite.js).
//   · "但进入保护目标点将减少1点目标生命值" — a REAL leak, no special handling ("真实漏怪语义，照常破坏完美作战"): the
//     four enemies' data lpr is 1 (tools/build-data.mjs BAND_SWAP_LPR), and the spawn is counted (no `countInTotal:
//     false` — that flag is the free-leak of the 狩猎期 placements), so a leak charges settle()'s counted-leak LP and
//     breaks 完美作战 like any wave enemy.
// The spawn tag is 'duck', like the strategy's swaps (the 1 s 隐匿 restore deviation of
// server/sim/content/enemies/helpers.js DUCK_STEALTH_RESTORE applies). Only the normal battle of an event round — never
// a boss / Hidden Core field, never the 狩猎期 placements (2V2 投放 / 同盟狩猎 prey), never the 联防 fields themselves
// (the duck's leaks re-enter there through the carriers above). No new UI, no new config.
//
// Wiring: server/match/match/combat.js `_normalOpts` (after the wave's own transforms — the last insert, like the
// 同盟狩猎 prey), never event.js.
//
// Randomness: one match-level seeded stream (server/sim/rng.js, built exactly like server/match/Match.js's rng('…')
// streams — created lazily here because Match.js constructs its own streams at construction; name 'duck-spawns'), so
// every draw is deterministic and golden-reproducible. A bot-rehearsal PREVIEW draws from a clone of the stream (the
// rngConfront pattern of combat.js), so a rehearsal shows the battle's duck without moving the real draw.

import { createRng, deriveSeed } from '../../sim/rng.js';

/** The 鸭爵 strategy (data/bands.json) and the buff whose `enemylist` names the four special enemies. */
export const DUCK_BAND = 'band_ducklord';
export const DUCK_BUFF = 'round_start_all_player_change_enemy_2';
/** The spawn tag of the strategy's swapped-in enemies (server/sim/content/bands/meta.js duckReplace). */
export const DUCK_TAG = 'duck';
/** "击倒这些敌人者获得1资金奖励（包括联防阶段）" (the buff's bb.count is 1 too — bands/meta.js DUCK_COINS). */
export const DUCK_COINS = 1;
/** The seeded stream's name (the Match rng('…') family). */
export const DUCK_STREAM = 'duck-spawns';

/** The strategy's four special enemies in data order — its own `rng.pick` order ("同一池、同一随机方式"). */
export function duckPool(gd) {
  const buffs = gd && typeof gd.band === 'function' ? gd.band(DUCK_BAND)?.buffs : null;
  const bbStr = (Array.isArray(buffs) ? buffs : []).find((b) => b && b.key === DUCK_BUFF)?.bbStr;
  return String(bbStr?.enemylist ?? '').split(',').map((k) => k.trim()).filter(Boolean);
}

/** Whether this round is one of the match's 事件期 rounds (Match.eventRounds; [] outside 2V2 / 同盟狩猎). */
export function duckRound(match) {
  return !!match && Array.isArray(match.eventRounds) && match.eventRounds.includes(match.round);
}

/** The match's duck stream, created on first use. A preview gets a clone: it never moves the real draw. */
function duckRng(match, preview) {
  if (!match.rngDuckSpawns) match.rngDuckSpawns = createRng(deriveSeed(match.seed, DUCK_STREAM));
  return preview && typeof match.rngDuckSpawns.clone === 'function' ? match.rngDuckSpawns.clone() : match.rngDuckSpawns;
}

/**
 * The wave unit slots the duck may walk (duckReplace's eligibility, its minweight–maxweight window aside): one entry per
 * unit of a counted ground enemy, in spawn-time order. Never a leader / its parts / a bounty (tagged), the 狩猎期
 * placements (`countInTotal: false`), an uncounted unit or a FLY action's slot [ASSUMED: the four are ground units and a
 * FLY action's route is a FLY route — the strategy's own rule for its swaps].
 */
function duckHosts(gd, spawns) {
  const out = [];
  for (const s of Array.isArray(spawns) ? spawns : []) {
    if (!s || typeof s !== 'object' || s.tag || s.countInTotal === false) continue;
    const e = gd.enemy(s.enemyKey);
    if (!e || e.rank === 'BOSS' || e.notCountInTotal || e.stats?.motion === 'FLY') continue;
    // bounded like a template action's own count (waves.js templateSpawns' 1–50 clamp)
    const count = Math.min(50, Math.max(1, Math.trunc(Number(s.count) || 1)));
    const time = Math.max(0, Number(s.time) || 0);
    const step = Math.max(0, Number(s.interval) || 0);
    for (let k = 0; k < count; k++) out.push({ s, time: time + k * step });
  }
  return out;
}

/**
 * The player's spawn list with exactly ONE duck-family enemy mixed in (a new list; `spawns` is never mutated). Every
 * other round — and every caller outside a match — gets its list back untouched.
 * @param {object} match the Match (seed stream, gd, round / eventRounds)
 * @param {object} ps the player whose wave it is (the bounty's ownerPlayerId)
 * @param {object[]} spawns the wave's SpawnSpecs after the event card / 强力属性 / 对抗期 / 狩猎期 transforms
 * @param {{ preview?: boolean }} [opts] preview: a bot rehearsal — draws from a clone of the stream
 * @returns {object[]}
 */
export function duckSpawnsFor(match, ps, spawns, { preview = false } = {}) {
  if (!duckRound(match) || !Array.isArray(spawns) || !ps) return spawns;
  const pool = duckPool(match.gd).filter((k) => match.gd.enemy(k));
  if (!pool.length) return spawns;
  const rng = duckRng(match, preview);
  const enemyKey = rng.pick(pool); // "同一随机方式": the strategy's own `rng.pick` over the same pool
  // [ASSUMED] placement ("波次夹杂"): one random wave unit's own slot — the strategy writes its swaps "at the replaced
  // unit's time and route" (duckReplace), and here the duck is ADDED (nothing is replaced), in the same spec style
  // (round multipliers included via the host's `mods`, minus `slot` like duckReplace). No candidate (an empty wave):
  // the wave's first route at time 0.
  const hosts = duckHosts(match.gd, spawns);
  const host = hosts.length ? hosts[rng.int(hosts.length)] : null;
  const s = host ? host.s : {};
  const d = {
    ...s,
    mods: s.mods ? { ...s.mods } : undefined,
    count: 1,
    interval: 0,
    time: host ? host.time : 0,
    routeIndex: host && Number.isInteger(s.routeIndex) ? s.routeIndex : 0,
    enemyKey,
    tag: DUCK_TAG,
    bounty: { coins: DUCK_COINS, ownerPlayerId: ps.playerId },
    ownerPlayerId: ps.playerId,
  };
  if (d.mods) delete d.mods.slot;
  return [...spawns, d];
}
