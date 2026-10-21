// Shared enums & constants (server + browser). Pure ESM, no Node APIs.

import { N_ } from './i18n.js';

export const PROTOCOL_VERSION = 1;
/** Release version shown to players (title screen, server banner, /healthz). Kept equal to package.json "version"
 * (test/version.test.js); PROTOCOL_VERSION above is the separate wire-format number. */
export const APP_VERSION = '0.3.1';
/**
 * This fork's own build label: the 2V2 mode's version on top of the upstream release it is built from. The FIRST public
 * test builds were `V0.0.1（0.2.6）` and `V0.0.1（0.3.1）`; this tree carries `V0.0.4` on upstream 0.3.1. `APP_VERSION` itself stays
 * the upstream release (test/version.test.js ties it to package.json / package-lock / CHANGELOG), so the fork carries
 * its number beside it (title screen, lobby, server banner). The name is an i18n msgid (public/i18n/*.json).
 */
export const FORK_VERSION = 'V0.0.4';
export const FORK_LABEL = `${FORK_VERSION}（${APP_VERSION}）`;
export const FORK_NAME = N_('卫戍协议：狩猎模拟');
/** A development build (the public `dev` branch): the title screen, the boot banner and the README say so, and
 * tools/package.mjs refuses to build a release zip from it without --allow-dev. */
export const DEV_BUILD = /-dev$/.test(APP_VERSION);
/**
 * The plugin API levels this build supports (DESIGN §32, shared/plugins/manifest.js): a manifest 2 states the level it
 * is written for (`api`); a level outside min…current keeps the plugin out. The level rises when the data shapes, the
 * DSL vocabulary or the SDK a plugin relies on change incompatibly (CHANGELOG says how to migrate). Level 2 adds the
 * declarative `offers` part (docs/PLUGINS.md): a manifest that uses it states `"api": 2`, and a build that knows only
 * level 1 refuses that plugin instead of loading it without the part. [ASSUMED]
 */
export const PLUGIN_API = Object.freeze({ current: 2, min: 1 });

export const MAX_SEATS = 4;
/**
 * Spectator seats of a co-op room (community report #26, owner's decision 2026-10-04) — a remake feature: the official
 * room has 1–4 players and no spectator seat (there only eliminated players and 联防 bystanders watch, research 09 §3.1).
 * A spectator never counts as a player, may not act, and watches like an eliminated player (server/lobby.js spectate,
 * server/match/match/watch.js addSpectator).
 */
export const MAX_SPECTATORS = 2;
export const ROOM_CODE_LEN = 4;
export const NAME_MAX_LEN = 12;

export const DIFFICULTIES = ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'];
export const DIFFICULTY_NAMES = { FUNNY: N_('标准模拟'), NORMAL: N_('险境模拟'), HARD: N_('绝境模拟'), ABYSS: N_('终极模拟') };
export const DIFFICULTY_COLORS = { FUNNY: '#f6a329', NORMAL: '#e85a1a', HARD: '#e73118', ABYSS: '#ff0024' };

// modeId in data/config.json = `mode_${type}_${difficulty.toLowerCase()}` with type single|multi.
// The 2V2 'versus' room reuses the MULTI tuning: data/config.json is generated (never hand-edited, AGENTS.md), so the
// versus deltas (two teams, the competition mechanic) are applied in code — server/lobby.js and server/match/**.
export const modeIdFor = (roomMode, difficulty) =>
  `mode_${roomMode === 'solo' ? 'single' : 'multi'}_${difficulty.toLowerCase()}`;

/** Room modes: 'solo' (1 human, no AI), 'coop' (1–4 co-op, one shared team) and 'versus' (2V2: two teams of two). */
export const ROOM_MODES = Object.freeze(['solo', 'coop', 'versus']);
/** Players per team in a 'versus' room (2V2). */
export const TEAM_SIZE = 2;
/** How many teams a 'versus' room has. */
export const TEAMS = 2;
/**
 * 2V2 development compensation (design 2026-10-16): from the drawn contest round, every OTHER round
 * each alive player gains a 小电话 (简易通讯机, a 2-coin item); a team whose total remaining LP drops below
 * VERSUS_LOW_LP additionally gains a 寻呼模块 that round (not bound to the every-other rule). Non-versus modes are
 * untouched.
 */
export const VERSUS_ITEM_PHONE = 'chess_item_2_06_e_a';
export const VERSUS_ITEM_PAGER = 'chess_item_4_01_e_a';
/**
 * 2V2: the shared HP pool (m.teamLps = Σ of the two members' 策略 HP) below which a team takes its ONE 寻呼模块 of the
 * match (prep.js _versusPrepGrant). The pool starts around 44–90, so 21 is a real "in trouble" line.
 */
export const VERSUS_LOW_LP = 21;
/**
 * 2V2: the briefing (确认本局信息) window in seconds — longer than the official 25 s guard because four humans read the
 * same setup together; it still ends as soon as every player is ready (phases.js maybeEndInfo).
 */
export const VERSUS_INFO_SECONDS = 45;
/**
 * 狩猎期 悬赏名单 (roster) presentation hold, ms (user 2026-10-17, addendum): once every player has submitted (or the
 * window ran out and the AI seats were filled in), the confrontation's roster — who placed what at whom, and the bounty
 * each placement announces — stays on screen this long before the battles begin. The server owns the clock (the phase
 * deadline / scheduler, never a bare setTimeout), so virtual time (goldens, tests) and real time agree. One line to tune.
 */
export const CONFRONT_ROSTER_MS = 5000;
/**
 * 事件期 词条公示 (roster) presentation hold, ms (user 2026-10-17, addendum): once every alive player has picked (or the
 * window ran out and the AI seats were filled in), the event's roster — who gave which entry to whom, plus the monster
 * entry — stays on screen this long before the round continues. The phase stays EVENT; the server owns the clock
 * (setDeadline → later → scaled, never a bare setTimeout), so virtual time and real time agree. One line to tune.
 */
export const EVENT_ROSTER_MS = 5000;

/**
 * The 狩猎期 rhythm shared by BOTH hunt modes — 2V2 ('versus') and 同盟狩猎 (co-op, COOP_HUNT below): the ratio ramp
 * (5 % +2 %/round, cap 15 %), the R13 最终狩猎 (50 %), the insertion positions / budget multiplier / pick cap, the kill
 * bounty table and 坎诺特's withdrawal table. One table, so the two modes can never drift apart; a mode overrides a value
 * by declaring it after the spread (as VERSUS_CONFRONT does for the 特性 pricing).
 */
const HUNT_RHYTHM = Object.freeze({
  /**
   * The intervention's size — for 2V2, the share of the opponent's original wave a team may replace and the same share
   * of the wave value it may spend (budget = wave value × ratio × budgetMul, PER PLAYER); for 同盟狩猎 it sizes the
   * system's deployment budget only (the prey is INSERTED, so its budget is wave value × ratio with NO multiplier — the
   * net addition equals the share, exactly like 2V2's replacement). 5 % at the contest round, +2 %/round, capped at
   * 15 %; the R13 最终狩猎 round is the exception — a flat 50 %.
   */
  ratioBase: 0.05,
  ratioStep: 0.02,
  ratioMax: 0.15,
  huntRound: 13,
  huntRatio: 0.5,
  positions: Object.freeze(['front', 'mid', 'back']),
  /** 2V2 ONLY: its placement replaces originals, so the spendable value is ratio × 2. 同盟狩猎 inserts and uses ratio. */
  budgetMul: 2,
  /** 狩猎期 roster hold (ms) — CONFRONT_ROSTER_MS, one line to tune (2V2 名单 / coop 本回合投放公示). */
  rosterMs: CONFRONT_ROSTER_MS,
  /**
   * The 特性 (trait) pricing of the value table: `traitStepScores[grade − 1]` is how many steps a monster's 特性 score
   * is worth (grade 1 = ≈ a stat stick → 0, grade 3 = a game-changing mechanic → 2), and `traitShare` is the share of
   * the WHOLE value table those steps must take up — confront.js confrontTraitStep turns it into the absolute per-step value
   * (`step = share/(1−share) × Σ stat value ÷ Σ steps` over the confront pool). The grades live in confrontTraits.js.
   */
  traitShare: 0.3,
  traitStepScores: Object.freeze([0, 1, 2]),
  /**
   * Hunt kill bounty (final rule, user 2026-10-17). `huntIdx` = which bounty phase this is in the match (1-based,
   * counted from the drawn contest round — NOT the absolute round):
   *
   *   huntIdx 1–4:  fixed economy — cap = bountyCaps[huntIdx − 1], payout = floor(cap × killed / total)
   *   huntIdx 5+:   the live formula — payout = floor(Σ value(killed) / wave value × the round's income × killIncomeShare)
   *   the R13 最终狩猎 (huntRound) is the ONE exception: a FIXED finalHuntBounty, scaled by the kill ratio —
   *                 floor(25 × killed / total): full clear 25, half 12; the farm cannot beat 25 either.
   *
   * There is no per-monster minimum anywhere. `total` is the number of monsters PLACED AT THAT RECEIVER (never the
   * wave's own monster count); a full clear pays the cap / formula, all leaked pays 0. The payout is credited per kill
   * through the fractional accumulator (`confrontBountyPlan`), so the running total is exactly the floor above, nothing
   * is lost to per-kill rounding, and sending 64 of the cheapest monsters cannot beat the formula.
   */
  bountyCaps: Object.freeze([1, 1, 2, 2]),
  /** The R13 最终狩猎's fixed bounty, scaled by the kill ratio: floor(finalHuntBounty × killed / total). */
  finalHuntBounty: 25,
  /** Share of a round's income the live formula (5th phase on) pays for the value a team actually threw. */
  killIncomeShare: 1,
  /**
   * Mirror of the protocol's `g.confront.picks` cap (shared/protocol.js, `isList(…, 64, …)`): a placement may hold at
   * most this many monsters. The 狩猎期 UI counts down to it and the server refuses more (ERR.CONFRONT_COUNT).
   */
  maxPicks: 64,
  /**
   * 商人「坎诺特」(merchant, user 2026-10-17): the share of a withdrawal that becomes gold, by ABSOLUTE round —
   * `[1, …, 8]` 20 %, R9 30 %, R10 35 %, R11 40 %, R12 45 %, R13 50 %, R14 55 %, R15 100 % (隐秘核心, 1:1). Every round
   * after R15 keeps 100 %. The cost in bank is `gold / rate`, the FIRST withdrawal of a round rounded UP (ceil) and the
   * later ones DOWN (floor); the counter resets every round.
   */
  merchantRates: Object.freeze([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 1]),
  /** The gold a player may withdraw per round: 4 on every normal round, unlimited in the R15 隐秘核心 round. */
  merchantRoundCap: 4,
  merchantUncappedRound: 15,
});

/**
 * 2V2 tunables: the target-selection window (s; ends early once every alive player holds a target), the shared rhythm
 * above, the 特性 pricing and the roster hold. There is no count cap beyond `maxPicks`: the budget (and the group's own
 * size) bounds the placement. The groups are the OFFICIAL 特训敌人 types (data/factions.json), NOT a constant here.
 * Step 2 (定制) has no fixed length of its own: its window is THIS round's prep time (`gd.prepTime`, untimed when the
 * prep is) and ends as soon as every alive player has submitted.
 */
export const VERSUS_CONFRONT = Object.freeze({
  targetSeconds: 10,
  ...HUNT_RHYTHM,
  /**
   * The boss 格 (user 2026-10-21): on the 事件期 rounds (match.eventRounds) the 定制 panel adds one more slot offering the
   * whole 机变悬赏 monster pool (data/choices.json bountyDrafts). A submission may name at most this many bosses — the
   * same bound the protocol's `g.confront.bosses` list carries (shared/protocol.js `isList(…, 32, …)`). Bosses cost NO
   * budget and count against NO maxPicks; within one submission an enemyKey may be named only once.
   */
  maxBosses: 32,
});

/**
 * 同盟狩猎 (co-op hunt, user 2026-10-17): a `mode_multi_*` (4-player co-op) room keeps the exact same co-op gameplay,
 * but every 狩猎期 is filled by the SYSTEM instead of the players. The rhythm is the 2V2 one (HUNT_RHYTHM: the drawn
 * start round R4/R5/R6, 5 % +2 %/round, cap 15 %, R13 最终狩猎 50 %), the monsters come from the official 特训敌人 types
 * within the round's budget (= wave value × ratio; the prey is INSERTED, not replacing, so the net addition is the ratio
 * itself). EVERY ALIVE PLAYER GETS THEIR OWN plan (每人一份: one official category per seat, the totals pairwise
 * distinct), and each plan is INSERTED into that player's OWN wave/波次 — not one shared batch. Killing one banks its
 * bounty at 坎诺特 (never gold), like a 2V2 placement. The 事件期 keeps its three periods with only `self` / `mate`
 * targets (no opponent in co-op). `enabled` is the one switch: false leaves co-op exactly as it was before.
 */
export const COOP_HUNT = Object.freeze({
  enabled: true,
  /** The 狩猎期 start round is drawn from these (the 2V2 contest draw). */
  startRounds: Object.freeze([4, 5, 6]),
  ...HUNT_RHYTHM,
  /** The 事件期 targets of a co-op hunt (no `oppA` / `oppB` — there is no opposing team). */
  targets: Object.freeze(['self', 'mate']),
});

/**
 * 商人「坎诺特」: the share of a withdrawal that becomes gold in an absolute round (the hunt table's merchantRates —
 * R8 and before 20 %, R9 30 %, then +5 %/round, R15 隐秘核心 100 %). `round` below 1 clamps to the first step, past the
 * end to the last one. `table` selects the mode's table (default VERSUS_CONFRONT; COOP_HUNT carries the same numbers).
 */
export const merchantRateFor = (round, table = VERSUS_CONFRONT) => {
  const rates = table.merchantRates;
  const r = Math.max(1, Math.min(rates.length, Math.floor(Number(round) || 0)));
  return rates[r - 1];
};

/** The gold a player may withdraw from the merchant in an absolute round: the table's merchantRoundCap per round,
 *  unlimited (Infinity) in its merchantUncappedRound (R15 隐秘核心). */
export const merchantCapFor = (round, table = VERSUS_CONFRONT) =>
  (Math.floor(Number(round) || 0) === table.merchantUncappedRound ? Infinity : table.merchantRoundCap);

/**
 * 2V2: whether the OPPONENT's side is open to a viewer in the given absolute round — from the round AFTER the R13
 * 最终狩猎 (`VERSUS_CONFRONT.huntRound`): the R14 最终攻势 and the R15 隐秘核心, the endgame where the two teams fight
 * their own boss in the open. This is the ONE place the reveal round lives (user 2026-10-17: "R13 之后可以看到对面视角"):
 * the match getter `Match#opponentRevealed` (server/match/match/infra.js) and the client's view helpers
 * (public/js/battle/observe.js, public/js/ui/gameLogic/watch.js) all read this function. Spectator seats are never
 * subject to it (they see everyone from the start: Match#isSpectator); solo/co-op have no opponent at all.
 * @param {number} round absolute round (m.public.round)
 * @returns {boolean}
 */
export const opponentRevealed = (round) => Math.floor(Number(round) || 0) > VERSUS_CONFRONT.huntRound;
/**
 * The team a seat plays for in a 'versus' room: seats 0,1 → team 0; seats 2,3 → team 1 (TEAMS teams of TEAM_SIZE).
 * Non-versus rooms keep the flat, team-less seat model (null).
 * @param {number} seat 0..MAX_SEATS-1
 * @returns {number} 0..TEAMS-1
 */
export const teamOfSeat = (seat) => Math.floor(seat / TEAM_SIZE) % TEAMS;

/**
 * 2V2 事件期 (类肉鸽词条, design 2026-10-17): three event periods per match, aligned with the 狩猎期 rhythm:
 *   E1 = the drawn contest round (contestStartRound: R4 / R5 / R6),
 *   E2 = E1 + EVENT_SECOND_OFFSET (4 rounds; R8 / R9 / R10),
 *   E3 = EVENT_FINAL_ROUND (R13, the 最终狩猎);
 * none of them collides with the R14/R15 boss rounds. Each period runs after ROUND_START and before that round's
 * 机变 / 休整期, so its entries are in force when the players deploy. Each event draws TWO entries:
 *   1. the ALLY entry: each player gives ONE to ONE target (对面 A / 对面 B / 队友 / 自己); a target cannot be chosen
 *      twice by the same player in one match (3 events cover 3 of the 4 targets). The TYPE odds move with the sequence
 *      (EVENT_SEQUENCE: E1 friendly, E2 neutral, E3 debuff-heavy) and the entry is then drawn from EVENT_CARDS;
 *   2. the MONSTER entry: drawn once per event, independent of the target choices (its own seeded stream), with its own
 *      per-sequence odds and 强力属性 share range (EVENT_SEQUENCE), applied to that round's wave — enemy mods only,
 *      never a player's mods, never a bounty amount.
 * The entries are pure data (no display text: the UI slice adds the i18n names); `ev` is the AI's heuristic value only
 * (server/match/match/event.js eventEvFor — it is not a rule).
 */
/** The last event period: R13, the 最终狩猎 (a normal hunt round, never a boss round). */
export const EVENT_FINAL_ROUND = 13;
/** E1 → E2 distance in rounds. */
export const EVENT_SECOND_OFFSET = 4;
/**
 * The three event rounds of a match, from the drawn contest round: [contestStartRound, +4, 13]. A versus match always
 * has a contestStartRound (R4/R5/R6); a non-versus match has no event period at all (the caller passes null → []).
 * @param {number|null} contestStartRound
 * @returns {number[]}
 */
export const eventRoundsFor = (contestStartRound) => {
  const first = Math.max(1, Math.min(EVENT_FINAL_ROUND, Math.trunc(Number(contestStartRound) || 0)));
  if (!contestStartRound || !first) return [];
  const second = Math.max(first + 1, Math.min(EVENT_FINAL_ROUND - 1, first + EVENT_SECOND_OFFSET));
  return [...new Set([first, second, EVENT_FINAL_ROUND])].sort((a, b) => a - b);
};
/** The four target keys of `g.event.pick { target }`. */
export const EVENT_TARGETS = Object.freeze(['self', 'mate', 'oppA', 'oppB']);
/** A self-targeted entry's magnitude multiplier (all numeric values in the entry, refresh uses included). */
export const EVENT_SELF_MUL = 2;
/**
 * How many rounds an ally entry stays in force (user 2026-10-17: 集市换货's 出售价 −1 lasted the whole match, so a sold
 * operator returned nothing — far too strong). An entry picked at round R is active in R, R+1, …, R+duration−1 and
 * expires at R+duration, for every effect (battle stats, deploy cap, income, prices, bounty). History keeps every pick:
 * only "currently in force" is filtered. Monster entries are NOT affected — they already act on their own single round
 * (foeEvent.round === this.round). One line to tune.
 */
export const EVENT_DURATION_ROUNDS = 4;
/** The event phase's selection window in seconds (a timed-out seat is auto-picked by EV: botEventTarget). */
export const EVENT_PICK_SECONDS = 20;
/**
 * The three sequence rows — the single source of the per-order odds and elite share ranges. The ally odds apply to the
 * ally channel as a whole (the target decides WHO receives it; "增" is good for the target), moving from friendly E1 to
 * debuff-heavy E3. The monster odds are from OUR side (favor = weakens the enemies). `eliteShares` are the two values
 * the 强力属性 share is drawn from in that period.
 */
export const EVENT_SEQUENCE = Object.freeze([
  Object.freeze({
    index: 1,
    allyOdds: Object.freeze({ down: 15, mid: 45, up: 40 }),
    foeOdds: Object.freeze({ favor: 35, mid: 40, unfavor: 25 }),
    eliteShares: Object.freeze([0.10, 0.15]),
  }),
  Object.freeze({
    index: 2,
    allyOdds: Object.freeze({ down: 30, mid: 40, up: 30 }),
    foeOdds: Object.freeze({ favor: 25, mid: 40, unfavor: 35 }),
    eliteShares: Object.freeze([0.15, 0.20]),
  }),
  Object.freeze({
    index: 3,
    allyOdds: Object.freeze({ down: 45, mid: 30, up: 25 }),
    foeOdds: Object.freeze({ favor: 20, mid: 35, unfavor: 45 }),
    eliteShares: Object.freeze([0.20, 0.25]),
  }),
]);
/** E2's neutral ally row (the match always reads EVENT_SEQUENCE; kept as the documented baseline for tools/tests). */
export const EVENT_ODDS = EVENT_SEQUENCE[1].allyOdds;
/** E2's neutral monster row (same note). */
export const EVENT_FOE_ODDS = EVENT_SEQUENCE[1].foeOdds;
/** E2's elite share range (same note). */
export const EVENT_FOE_ELITE_SHARES = EVENT_SEQUENCE[1].eliteShares;
/**
 * The 24 ally entries, in four classes (output / survival / sp / economy). The SP class replaced the removed range
 * class (射程 removal, user 2026-10-17): no entry carries `range` / `rangeExtend` / attack-distance data any more — the
 * battle side only uses existing engine mods.
 *
 * Class / entry (name is the comment; the UI slice maps the `key` to its i18n msgid). Magnitudes were scaled ×1.5
 * (user 2026-10-17, "方案 A 只 ×1.5"): percentages keep two decimals (half-percents round to the integer percent the
 * owner listed), flat points scale, fixed coins +2 → +3; the discrete values (SP cost ±1, deploy +1, the market's
 * refresh/sell integers) stay as they are. "给自己" still multiplies the FINAL magnitudes by 2.
 *   output    磨刃 atkPct +20% · 追风 aspd +18 · 破甲 defIgnorePct 22% · 钝口 atkPct −9% · 重弩 atkPct +20% / aspd −18 ·
 *             连击 aspd +27 / atkPct −15%
 *   survival  猎人披挂 hpPct +38% · 营地篝火 regenPct 9%/s · 铁衣 defPct +22% · 血痕 dmgTaken +12% · 轻装远行 hpPct +38% /
 *             atkPct −11% · 负甲 defPct +30% / moveMul 0.85 · 陷足 enemySpeed +22%
 *   sp        蓄势 spRecoveryMul 1.15 · 静息 spRecoveryFlat 0.15 · 轻省 spCostFlat −1 · 滞涩 spRecoveryMul 0.85 ·
 *             换息 spRecoveryMul 1.22 / spCostFlat +1 · 回环 spRecoveryFlat 0.15 / spCostFlat +1
 *   economy   猎人佣金 +3 金/回合 · 赏金嗅觉 投放怪赏金 +3/次 · 轻捷 上场人数 +1 · 空手而归 −3 金/回合 ·
 *             集市换货 刷新费 −1（每回合 2 次）/ 出售价 −1
 * Ratios are stored as plain percentages in this DATA table (a compact summary, not the battle rule). The battle
 * applies the event entries through the **环境buff乘区 / environment buff bucket**:
 *   ① every source multiplies once: `stat = base × Π(1 + p_i)` — two +20 % entries are 1.20 × 1.20 = 1.44;
 *   ② flat values (ASPD / SP recovery / SP cost) are highest priority: they are added to the panel first and are
 *      never scaled by the bucket;
 *   ③ the bucket is event-only: it never mixes with the additive pool of bonds / equipment / skills / 机变.
 * Flat points for aspd / spRecoveryFlat / spCostFlat, economy in fixed coins. `ev` = the AI heuristic (up > 0,
 * down < 0, mid ≈ 0), scaled with the continuous magnitudes (the unchanged discrete entries keep their ev).
 */
export const EVENT_CARDS = Object.freeze([
  // ---- output ---------------------------------------------------------------------------------------------------
  Object.freeze({ id: 1, key: 'whetstone', class: 'output', kind: 'up', atkPct: 0.20, ev: 15 }),        // 磨刃
  Object.freeze({ id: 2, key: 'tailwind', class: 'output', kind: 'up', aspd: 18, ev: 12 }),              // 追风
  Object.freeze({ id: 3, key: 'armor_break', class: 'output', kind: 'up', defIgnorePct: 0.22, ev: 12 }),  // 破甲
  Object.freeze({ id: 4, key: 'blunted', class: 'output', kind: 'down', atkPct: -0.09, ev: -12 }),       // 钝口
  Object.freeze({ id: 5, key: 'heavy_crossbow', class: 'output', kind: 'mid', atkPct: 0.20, aspd: -18, ev: 0 }), // 重弩
  Object.freeze({ id: 6, key: 'rapid_volley', class: 'output', kind: 'mid', aspd: 27, atkPct: -0.15, ev: 1.5 }),   // 连击
  // ---- survival -------------------------------------------------------------------------------------------------
  Object.freeze({ id: 7, key: 'hunter_cloak', class: 'survival', kind: 'up', hpPct: 0.38, ev: 18 }),    // 猎人披挂
  Object.freeze({ id: 8, key: 'campfire', class: 'survival', kind: 'up', regenPct: 0.09, ev: 21 }),      // 营地篝火
  Object.freeze({ id: 9, key: 'iron_hide', class: 'survival', kind: 'up', defPct: 0.22, ev: 12 }),       // 铁衣
  Object.freeze({ id: 10, key: 'bloodstain', class: 'survival', kind: 'down', dmgTaken: 0.12, ev: -15 }), // 血痕
  Object.freeze({ id: 11, key: 'light_travel', class: 'survival', kind: 'mid', hpPct: 0.38, atkPct: -0.11, ev: 3 }), // 轻装远行
  Object.freeze({ id: 12, key: 'burden_armor', class: 'survival', kind: 'mid', defPct: 0.30, moveMul: 0.85, ev: 1.5 }), // 负甲
  Object.freeze({ id: 13, key: 'mired', class: 'survival', kind: 'down', enemySpeed: 0.22, ev: -10.5 }),   // 陷足
  // ---- sp (技力; all engine-native mods) -------------------------------------------------------------------------
  Object.freeze({ id: 14, key: 'build_up', class: 'sp', kind: 'up', spRecoveryMul: 1.15, ev: 12 }),        // 蓄势
  Object.freeze({ id: 15, key: 'stillness', class: 'sp', kind: 'up', spRecoveryFlat: 0.15, ev: 10.5 }),      // 静息
  Object.freeze({ id: 16, key: 'frugal', class: 'sp', kind: 'up', spCostFlat: -1, ev: 9 }),              // 轻省
  Object.freeze({ id: 17, key: 'stagnant', class: 'sp', kind: 'down', spRecoveryMul: 0.85, ev: -12 }),     // 滞涩
  Object.freeze({ id: 18, key: 'breath_swap', class: 'sp', kind: 'mid', spRecoveryMul: 1.22, spCostFlat: 1, ev: 1.5 }), // 换息
  Object.freeze({ id: 19, key: 'cycle', class: 'sp', kind: 'mid', spRecoveryFlat: 0.15, spCostFlat: 1, ev: 0 }),      // 回环
  // ---- economy / mechanism --------------------------------------------------------------------------------------
  Object.freeze({ id: 20, key: 'hunter_commission', class: 'economy', kind: 'up', goldPerRound: 3, ev: 15 }), // 猎人佣金
  Object.freeze({ id: 21, key: 'bounty_scent', class: 'economy', kind: 'up', bountyGold: 3, ev: 9 }),    // 赏金嗅觉
  Object.freeze({ id: 22, key: 'nimble', class: 'economy', kind: 'up', deploy: 1, ev: 9 }),              // 轻捷
  Object.freeze({ id: 23, key: 'empty_handed', class: 'economy', kind: 'down', goldPerRound: -2, duration: 1, ev: -9 }), // 空手而归（经济负面：−2，只压 1 回合）
  Object.freeze({ id: 24, key: 'market_swap', class: 'economy', kind: 'mid', refreshDiscount: 1, refreshUses: 2, sellDiscount: 1, duration: 1, ev: 1 }), // 集市换货（卖干员 −1：只持续 1 回合）
]);

/**
 * The 12 monster entries, four classes × three (one favourable to us = weakens the enemies, one neutral exchange, one
 * unfavourable = strengthens them). One is drawn per event on its own seeded stream, independent of the target choices,
 * and merged into THAT round's normal wave (`Match.foeWaveSpawns`): hpMul / atkMul / defMul / speedMul are the engine's
 * spawn mods, `countAdd` adds to every spawn run's count (clamped to ≥ 1). A monster entry never enters a player's mods
 * and never changes a bounty (the 赏金 stays the placement's own coins). Magnitudes are ×1.5 (user 2026-10-17):
 *   攻击  锈刃 atkMul 0.85 · 换骨 atkMul 1.15 / hpMul 0.85 · 獠牙 atkMul 1.15
 *   生存  创口 hpMul 0.82 · 坚壳 defMul 1.22 / speedMul 0.78 · 厚皮 hpMul 1.18
 *   速度  迟缓 speedMul 0.78 · 盘踞 speedMul 0.7 / hpMul 1.18 · 疾行 speedMul 1.22
 *   数量  稀疏 countAdd −1 · 替换 countAdd −1 / hpMul 1.3 · 增援 countAdd +1
 * `ev` is from OUR side (+ favourable, − unfavourable). The per-sequence odds live in EVENT_SEQUENCE (E2 = 25 / 40 / 35,
 * expectation −0.10; E1 +0.10; E3 −0.25): the monster channel is a gentle sequence-driven difficulty ramp.
 */
export const EVENT_FOE_CARDS = Object.freeze([
  // ---- attack ---------------------------------------------------------------------------------------------------
  Object.freeze({ id: 1, key: 'rusted_blade', class: 'attack', kind: 'favor', atkMul: 0.85, ev: 1 }),      // 锈刃
  Object.freeze({ id: 2, key: 'bone_swap', class: 'attack', kind: 'mid', atkMul: 1.15, hpMul: 0.85, ev: 0 }), // 换骨
  Object.freeze({ id: 3, key: 'fangs', class: 'attack', kind: 'unfavor', atkMul: 1.15, ev: -1 }),          // 獠牙
  // ---- survival -------------------------------------------------------------------------------------------------
  Object.freeze({ id: 4, key: 'wound', class: 'survival', kind: 'favor', hpMul: 0.82, ev: 1 }),           // 创口
  Object.freeze({ id: 5, key: 'hard_shell', class: 'survival', kind: 'mid', defMul: 1.22, speedMul: 0.78, ev: 0 }), // 坚壳
  Object.freeze({ id: 6, key: 'thick_hide', class: 'survival', kind: 'unfavor', hpMul: 1.18, ev: -1 }),   // 厚皮
  // ---- speed ----------------------------------------------------------------------------------------------------
  Object.freeze({ id: 7, key: 'sluggish', class: 'speed', kind: 'favor', speedMul: 0.78, ev: 1 }),        // 迟缓
  Object.freeze({ id: 8, key: 'coiled', class: 'speed', kind: 'mid', speedMul: 0.7, hpMul: 1.18, ev: 0 }), // 盘踞
  Object.freeze({ id: 9, key: 'swift', class: 'speed', kind: 'unfavor', speedMul: 1.22, ev: -1 }),        // 疾行
  // ---- count / wave ---------------------------------------------------------------------------------------------
  Object.freeze({ id: 10, key: 'sparse', class: 'count', kind: 'favor', countAdd: -1, ev: 1 }),           // 稀疏
  Object.freeze({ id: 11, key: 'replace', class: 'count', kind: 'mid', countAdd: -1, hpMul: 1.3, ev: 0 }), // 替换
  Object.freeze({ id: 12, key: 'reinforce', class: 'count', kind: 'unfavor', countAdd: 1, ev: -1 }),       // 增援
]);

/**
 * 强力属性子集 (user 2026-10-17, tier 2): every event ALSO marks a share of that round's enemies as 强力 — the normal
 * wave AND the 赏金怪 (tag 'bounty'); the share range moves with the sequence (EVENT_SEQUENCE.eliteShares:
 * E1 10–15 %, E2 15–20 %, E3 20–25 %). One attribute is drawn per event (1 of these 4), and the marked units get its
 * multiplier ON TOP of the monster card's own mods. The bounty amount (`bounty.coins`) is never recalculated.
 *   獠牙 fangs      attack +25 %  (atkMul 1.25)
 *   厚皮 thick_hide health +30 %  (hpMul 1.30)
 *   坚壳 hard_shell armor  +25 %  (defMul 1.25)
 *   疾行 swift      move   +20 %  (speedMul 1.20)
 * The count is max(1, round(share × the wave's monster count, 赏金怪 included)).
 */
export const EVENT_FOE_ELITES = Object.freeze([
  Object.freeze({ key: 'fangs', atkMul: 1.25 }),
  Object.freeze({ key: 'thick_hide', hpMul: 1.30 }),
  Object.freeze({ key: 'hard_shell', defMul: 1.25 }),
  Object.freeze({ key: 'swift', speedMul: 1.20 }),
]);

export const PHASE = Object.freeze({
  LOBBY: 'LOBBY',
  INFO_CHECK: 'INFO_CHECK',
  BAND_DRAFT: 'BAND_DRAFT',
  BATTLE_CHECK: 'BATTLE_CHECK',
  ROUND_START: 'ROUND_START',
  // 2V2 事件期 (see eventRoundsFor): resolves after ROUND_START, before SP_DRAFT / PREP
  EVENT: 'EVENT',
  SP_DRAFT: 'SP_DRAFT',
  PREP: 'PREP',
  // 2V2 ('versus'): the 对抗期 — from the drawn contest round, after each side's prep, each team submits one intervention
  // against the opponent's next battle (see server/match/match/confront.js)
  CONFRONT: 'CONFRONT',
  COMBAT: 'COMBAT',
  UNITE: 'UNITE',
  SETTLE: 'SETTLE',
  FINAL_ASSAULT: 'FINAL_ASSAULT',
  HIDDEN_CORE: 'HIDDEN_CORE',
  RESULT: 'RESULT',
});

export const PHASE_NAMES = {
  LOBBY: N_('等待中'), INFO_CHECK: N_('确认本局信息'), BAND_DRAFT: N_('选择策略'), BATTLE_CHECK: N_('协议启动'),
  // 事件期's display name lands with the UI slice; ASCII here so no i18n msgid is added by the server-only slice
  ROUND_START: N_('回合开始'), EVENT: 'EVENT', SP_DRAFT: N_('机变阶段'), PREP: N_('休整期'), CONFRONT: N_('狩猎期'), COMBAT: N_('作战中'), UNITE: N_('联防阶段'),
  SETTLE: N_('结算'), FINAL_ASSAULT: N_('最终攻势'), HIDDEN_CORE: N_('隐秘核心'), RESULT: N_('模拟结束'),
};

// Board geometry on the 19x21 stage grid (row 0 = bottom). See DESIGN §3.
export const GEO = Object.freeze({
  ROWS: 19, COLS: 21,
  FIELD: { r0: 9, r1: 12, c0: 2, c1: 10 },        // own deployable board region
  NORMAL_RECT: { r0: 9, r1: 12, c0: 0, c1: 10 },  // simulation rect for a normal battle
  UNITE_RECT: { r0: 9, r1: 12, c0: 0, c1: 20 },
  BOSS_RECT: { r0: 0, r1: 5, c0: 0, c1: 20 },
  HAND_ROW: 7, HAND_SIZE: 10,                      // hand slot idx = col 0..9
  TEMP_ROW: 8, TEMP_C0: 4, TEMP_SIZE: 5,           // temp slot idx 0..4 = cols 4..8
  PARTNER_COL_OFFSET: 8,
});

export const AREA = Object.freeze({ BOARD: 'board', HAND: 'hand', TEMP: 'temp', OUTSIDE: 'outside' });

export const PIECE_KIND = Object.freeze({ CHESS: 'chess', ITEM: 'item', TOKEN: 'token' });

/**
 * Whether the placed piece of a skill's summon (赫默's 医疗探机, 巫恋's 诅咒娃娃) also deploys once, for free, at the
 * battle start. true = the PRTS reading (卫戍协议/帮助 §作战阶段: "所有手动部署的召唤物，无视所属干员的持有状态…作战开始时
 * 立即部署一次", example 赫默's drone), settled by the user on 2026-10-01 after playtest #6 (DESIGN §20); false = the
 * playtest #4 reading ("是赫默开技能释放一次，不是开局直接就部署了"): it takes its tile only when the owner's skill gives one.
 * Either way the piece re-appears on its tile each time the owner's skill gives one.
 * One switch for everything that depends on it: the sim (server/sim/content/tokens.js dockSkillSummons) and the summon
 * card's hint (public/js/ui/detailPanel.js summonDeployHint). docs/PLAYING.md §4 and docs/SIM.md (token pieces) state
 * the rule in prose — test/ui/playtest6_summons.test.js fails until they match the value.
 */
export const SKILL_SUMMON_START_DEPLOY = true;

/**
 * Official per-bond layer cap (docs/research/11-limits-official.md §1): the client's
 * `Torappu.Battle.AutoChessBattleConst.MAX_GARRISON_STACK = 999`, and its bond counter (`AddBondCount`) stores
 * `min(L + n, 999)` — each bond stops at 999 on its own; the community reports bonds sitting at 999 while fed (巴哈姆特
 * 12534 "每把都能999层", 12316 "999謝"; research 02 §layers). The only implementation of the cap (DESIGN §20.12). Every
 * writer of a bond's layers goes through `layerGainRoom`: the prep-side gains (server/match/player/economy.js addLayers —
 * 特质, items, bands, 机变 cards, bonds), the settle of the in-battle gains (server/match/match/settle.js) and the live in-battle
 * copy (server/sim/battle/economy.js addLayers, as the client's AddBondCount) — and the dev tools' direct writes (tools/matchrun.mjs
 * --layers, tools/balance.mjs applyBoard); a gain at the cap adds 0 (no onLayers, no 'layer'
 * event), and the client-result check (server/match/fields.js) bounds a reported gain by the room left. Milestones paid
 * per N layers (远见, 奇迹, 维多利亚 …) stop with the count. 0 / Infinity = no cap.
 */
export const BOND_LAYER_CAP = 999;

/**
 * The layers a gain of `n` actually adds to a bond holding `before` under BOND_LAYER_CAP: min(n, cap − before), never
 * negative (a count already at or over the cap gains 0 and is never lowered); 0 for a non-positive / non-finite `n`
 * except +Infinity (= "the room left").
 */
export function layerGainRoom(before, n) {
  if (!(n > 0)) return 0;
  const cap = BOND_LAYER_CAP > 0 ? BOND_LAYER_CAP : Infinity;
  const b = Number.isFinite(before) && before > 0 ? before : 0;
  return Math.max(0, Math.min(n, cap - b));
}

/**
 * Official boss-hit limit "限伤" (docs/research/11-limits-official.md §2): `AutoChessBattleConst.MAX_BATTLE_DAMAGE =
 * 300000`. In a boss battle outside training — our battle kinds 'boss' (Final Assault) and 'hidden' (Hidden Core) — a
 * single hit on a leader (`AutoChessBattleUtil.IsBossEnemy`: an enemyId of activity_table autoChessData.bossInfoDict
 * = data/bosses.json `enemyKey`; in the sim the tag-'boss' units: those leaders and their mirrored copies, never parts,
 * escorts or drones) whose `ceil(final damage)` ≥ this is CANCELLED: 0 damage, nothing credited to the shared pool
 * (`AutoChessStepModeManager._OnBossEnemyTakeDamage` → `modifier.Cancel()`). It is not a clamp: a hit of 299999 lands.
 * Checked in server/sim/damage.js (dealDamage after DEF / RES and every multiplier, before shields; Battle.loseHp — not
 * the 胄 drone link's pool share, `noHitLimit`, DESIGN §25.13.4). Minions, normal rounds and 联防 are unaffected.
 * 0 / Infinity = off.
 */
export const BOSS_HIT_LIMIT = 300000;

// Snapshot unit flag bits (DESIGN §8.2)
export const UF = Object.freeze({
  BLOCKED: 1, STUNNED: 2, FROZEN: 4, STEALTH: 8, SKILL: 16, SHIELD: 32, INVULN: 64, COLD: 128, SLEEP: 256, FLYING: 512,
});

export const ANIM = Object.freeze({ IDLE: 0, MOVE: 1, ATTACK: 2, SKILL: 3, DIE: 4, STUN: 5, DEPLOY: 6 });

export const ERR = Object.freeze({
  BAD_MSG: 'BAD_MSG',             // malformed / unknown message
  SESSION_IN_USE: 'SESSION_IN_USE', // a local recovery candidate cannot replace the connected holder
  RATE: 'RATE',                   // rate limited
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_STARTED: 'ROOM_STARTED',
  NOT_HOST: 'NOT_HOST',
  NOT_READY: 'NOT_READY',
  WRONG_PHASE: 'WRONG_PHASE',
  NO_FUNDS: 'NO_FUNDS',
  HAND_FULL: 'HAND_FULL',
  BOARD_FULL: 'BOARD_FULL',
  BAD_TILE: 'BAD_TILE',
  BAD_TARGET: 'BAD_TARGET',
  SOLD_OUT: 'SOLD_OUT',
  MAX_LEVEL: 'MAX_LEVEL',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  ALREADY: 'ALREADY',
  TEMP_NOT_EMPTY: 'TEMP_NOT_EMPTY',
  ELIMINATED: 'ELIMINATED',
  SPECTATOR: 'SPECTATOR',         // a spectator seat only watches (MAX_SPECTATORS)
  CONFRONT_BUDGET: 'CONFRONT_BUDGET', // 狩猎期: the placement's total VALUE is over this round's budget
  CONFRONT_COUNT: 'CONFRONT_COUNT',   // 狩猎期: the placement holds more monsters than VERSUS_CONFRONT.maxPicks
  MERCHANT_CAP: 'MERCHANT_CAP',       // 商人: this round's withdrawal cap is reached
  MERCHANT_BANK: 'MERCHANT_BANK',     // 商人: not enough 赏金 in the bank for that withdrawal
  // room.setPlugins (DESIGN §32): a plugin this server has not installed; one a room cannot switch on in this version
  // (not a cosmetic or content plugin it loads, not of the room's scope, or not allowed by the server owner's
  // plugins/config.json); a requirement missing or out of range, or a load-order cycle; two plugins in conflict; a set
  // over the art size limit
  PLUGIN_SCRIPT_CONFLICT: 'PLUGIN_SCRIPT_CONFLICT',
  PLUGIN_SCRIPT_OVERRIDE: 'PLUGIN_SCRIPT_OVERRIDE',
  PLUGIN_SCRIPT_CHECK: 'PLUGIN_SCRIPT_CHECK',
  PLUGIN_SCRIPTS_DISABLED: 'PLUGIN_SCRIPTS_DISABLED',
  PLUGIN_TRUST_PIN: 'PLUGIN_TRUST_PIN',
  PLUGIN_TRUST_PUBLIC: 'PLUGIN_TRUST_PUBLIC',
  PLUGIN_CONSENT: 'PLUGIN_CONSENT',
  PLUGIN_UNKNOWN: 'PLUGIN_UNKNOWN',
  PLUGIN_BLOCKED: 'PLUGIN_BLOCKED',
  PLUGIN_DEPENDENCY: 'PLUGIN_DEPENDENCY',
  PLUGIN_CONFLICT: 'PLUGIN_CONFLICT',
  PLUGIN_RULE_CONFLICT: 'PLUGIN_RULE_CONFLICT',
  PLUGIN_LIMIT: 'PLUGIN_LIMIT',
  // P1c (DESIGN §32.6): a gameplay plugin made for other game versions or another plugin API (refused unless the server
  // owner allows it: plugins/config.json allowIncompatible); the server already runs as many plugin content sets as its
  // limit allows (plugins/config.json limits.maxSets); room.ready / room.start before every player's page has loaded and
  // checked the room's content (room.contentReady)
  PLUGIN_INCOMPATIBLE: 'PLUGIN_INCOMPATIBLE',
  PLUGIN_BUSY: 'PLUGIN_BUSY',
  CONTENT_NOT_READY: 'CONTENT_NOT_READY',
  // match test mode (DESIGN §34.8 phase 2): the process switch is off, or this room was not created as a test room
  TEST_CONFIRM: 'TEST_CONFIRM',
  TEST_DISABLED: 'TEST_DISABLED',
  TEST_FORBIDDEN: 'TEST_FORBIDDEN',
  INTERNAL: 'INTERNAL',
});

export const ERR_TEXT = {
  SESSION_IN_USE: N_('此对局仍在其他窗口中，或当前浏览器无法安全恢复。请关闭原窗口后重试。'),
  BAD_MSG: N_('无效的请求'), RATE: N_('操作过于频繁'), NOT_IN_ROOM: N_('你不在房间中'), ROOM_NOT_FOUND: N_('未找到该同盟密钥对应的房间'),
  ROOM_FULL: N_('房间已满'), ROOM_STARTED: N_('模拟已开始'), NOT_HOST: N_('只有房主可以操作'), NOT_READY: N_('仍有玩家未就绪'),
  WRONG_PHASE: N_('当前阶段无法进行该操作'), NO_FUNDS: N_('资金不足'), HAND_FULL: N_('整备区已满'), BOARD_FULL: N_('已达到部署上限'),
  BAD_TILE: N_('无法部署在该位置'), BAD_TARGET: N_('无效的目标'), SOLD_OUT: N_('已售出'), MAX_LEVEL: N_('调度中心已达最高等级'),
  NOT_YOUR_TURN: N_('尚未轮到你'), ALREADY: N_('已完成该操作'), TEMP_NOT_EMPTY: N_('临时整备区不为空'), ELIMINATED: N_('你已被淘汰'),
  SPECTATOR: N_('观战中无法进行该操作'), INTERNAL: N_('服务器内部错误'),
  CONFRONT_BUDGET: N_('投放的怪物总价值超出本回合预算'), CONFRONT_COUNT: N_('投放数量超出本回合上限'),
  MERCHANT_CAP: N_('本回合的取款已达上限'), MERCHANT_BANK: N_('赏金不足'),
  PLUGIN_UNKNOWN: N_('本服务器没有安装该插件'), PLUGIN_BLOCKED: N_('该插件不能在房间中启用'), PLUGIN_DEPENDENCY: N_('缺少该插件需要的其他插件'),
  PLUGIN_CONFLICT: N_('所选插件互相冲突'), PLUGIN_LIMIT: N_('所选插件的素材总量超出本服务器的上限'),
  PLUGIN_RULE_CONFLICT: N_('两个插件把同一个规则开关设成了不同的选项'),
  PLUGIN_INCOMPATIBLE: N_('该插件不适配本服务器的游戏版本'), PLUGIN_BUSY: N_('本服务器同时运行的插件组合已达上限，请稍后再试'),
  PLUGIN_CONSENT: N_('还有玩家未同意运行受信任插件'),
  PLUGIN_SCRIPTS_DISABLED: N_('服主没有启用脚本插件'),
  PLUGIN_TRUST_PIN: N_('插件的锁文件或文件内容与服主钉住的哈希不符'),
  PLUGIN_TRUST_PUBLIC: N_('公网监听默认禁止受信任插件'),
  PLUGIN_SCRIPT_CONFLICT: N_('两个插件注册了同一个效果'),
  PLUGIN_SCRIPT_OVERRIDE: N_('插件未声明要替换的官方技能'),
  PLUGIN_SCRIPT_CHECK: N_('脚本未通过兼容性检查'),
  CONTENT_NOT_READY: N_('仍有博士未载入房间的插件内容'),
  TEST_CONFIRM: N_('这是测试房间，不计入任何记录。确认加入？'),
  TEST_DISABLED: N_('测试模式未开启'),
  TEST_FORBIDDEN: N_('这不是测试房间'),
};

// ---- Emotes (交流, research 09 §4) -----------------------------------------------------------------------------
// The 36 official in-match emotes: display_meta_table emoticonData, scene AUTOCHESS_BATTLE, 6 themes × 6, one wheel
// page per theme in activity_table autoChessData.enabledEmoticonThemeIdList order, emotes by sortId. `g.emote { id }`
// / `m.emote { playerId, id }` carry the official emoji id. Generated reference: data/emotes.json
// (tools/build-emotes.mjs); test/ui/emotes.test.js keeps this table identical to it.
// Official emotes have no text (desc is null): `label` is ours and only ever an aria-label, never displayed.
// Art: extracted from a local client (tools/local-extract) to /assets/local/emoticon/<dir>/<picId>.png and listed in
// data/local-assets.json group `emoticon/<dir>`; also downloaded from the public mirror by tools/fetch-assets.mjs
// (tools/assets/plan.mjs UI_EXTRAS → data/assets.json ui['emoticon/<dir>/<picId>'], GitHub issue #42). The UI takes the
// local picture first, then the mirror copy, and shows a neutral glyph when neither is there. The picId is not
// derived from the id (autochess_battle_fooldoctor_03…06 → pic_fooldoctor_04/05/06/08_battle).
const emo = (id, sortId, picId, label) => Object.freeze({ id, sortId, picId, label });
export const EMOTE_THEMES = Object.freeze([
  { themeId: 'emoticon_autochess_basic', dir: 'basic', sortId: 100000, isBasic: true, name: N_('表情套组：卫戍协议'), emotes: [
    emo('autochess_battle_happy', 1001, 'pic_happy_battle', N_('开心')),
    emo('autochess_battle_scared', 1002, 'pic_scared_battle', N_('害怕')),
    emo('autochess_battle_sorry', 1003, 'pic_sorry_battle', N_('对不起')),
    emo('autochess_battle_thanks', 1004, 'pic_thanks_battle', N_('谢谢')),
    emo('autochess_battle_thinking', 1005, 'pic_thinking_battle', N_('思考')),
    emo('autochess_battle_nice_cooperate', 1006, 'pic_cooperate_battle', N_('合作愉快')),
  ] },
  { themeId: 'emoticon_originium_slug', dir: 'slug', sortId: 1001, isBasic: false, name: N_('表情套组：虫动'), emotes: [
    emo('slug_autochess_battle_nice_work', 2001, 'pic_nice_work_battle', N_('合作愉快！')),
    emo('slug_autochess_battle_thanks', 2002, 'pic_thanks_battle', N_('谢谢！')),
    emo('slug_autochess_battle_sorry', 2003, 'pic_sorry_battle', N_('对不起！')),
    emo('slug_autochess_battle_bye', 2004, 'pic_bye_battle', N_('再见！')),
    emo('slug_autochess_battle_distrust', 2005, 'pic_distrust_battle', '？？？'),
    emo('slug_autochess_battle_very_soon', 2006, 'pic_very_soon_battle', N_('很快就好！')),
  ] },
  { themeId: 'emoticon_autochess_basic_2', dir: 'basic_2', sortId: 100001, isBasic: true, name: N_('表情套组：卫戍协议'), emotes: [
    emo('autochess_battle_noproblem', 1007, 'pic_noproblem_battle', N_('没问题！')),
    emo('autochess_battle_respect', 1008, 'pic_respect_battle', N_('敬礼！')),
    emo('autochess_battle_call', 1009, 'pic_call_battle', N_('欢呼！')),
    emo('autochess_battle_playingcool', 1010, 'pic_playingcool_battle', N_('酷！')),
    emo('autochess_battle_sad', 1011, 'pic_sad_battle', N_('伤心')),
    emo('autochess_battle_dying', 1012, 'pic_dying_battle', N_('快死了')),
  ] },
  { themeId: 'emoticon_foolsday_doctor', dir: 'fooldoctor', sortId: 1002, isBasic: false, name: N_('表情套组：博士士'), emotes: [
    emo('autochess_battle_fooldoctor_01', 1020, 'pic_fooldoctor_01_battle', N_('博士士 1')),
    emo('autochess_battle_fooldoctor_02', 1021, 'pic_fooldoctor_02_battle', N_('博士士 2')),
    emo('autochess_battle_fooldoctor_03', 1022, 'pic_fooldoctor_04_battle', N_('博士士 3')),
    emo('autochess_battle_fooldoctor_04', 1023, 'pic_fooldoctor_05_battle', N_('博士士 4')),
    emo('autochess_battle_fooldoctor_05', 1024, 'pic_fooldoctor_06_battle', N_('博士士 5')),
    emo('autochess_battle_fooldoctor_06', 1025, 'pic_fooldoctor_08_battle', N_('博士士 6')),
  ] },
  { themeId: 'emoticon_foolsday_amiya', dir: 'foolamiya', sortId: 1003, isBasic: false, name: N_('表情套组：米米子'), emotes: [
    emo('autochess_battle_foolamiya_01', 1040, 'pic_foolamiya_01_battle', N_('米米子 1')),
    emo('autochess_battle_foolamiya_02', 1041, 'pic_foolamiya_02_battle', N_('米米子 2')),
    emo('autochess_battle_foolamiya_03', 1042, 'pic_foolamiya_03_battle', N_('米米子 3')),
    emo('autochess_battle_foolamiya_04', 1043, 'pic_foolamiya_04_battle', N_('米米子 4')),
    emo('autochess_battle_foolamiya_05', 1044, 'pic_foolamiya_05_battle', N_('米米子 5')),
    emo('autochess_battle_foolamiya_06', 1045, 'pic_foolamiya_06_battle', N_('米米子 6')),
  ] },
  { themeId: 'emoticon_foolsday_wisdel', dir: 'foolwisdel', sortId: 1004, isBasic: false, name: N_('表情套组：维维美'), emotes: [
    emo('autochess_battle_foolwisdel_01', 1060, 'pic_foolwisdel_01_battle', N_('维维美 1')),
    emo('autochess_battle_foolwisdel_02', 1061, 'pic_foolwisdel_02_battle', N_('维维美 2')),
    emo('autochess_battle_foolwisdel_03', 1062, 'pic_foolwisdel_03_battle', N_('维维美 3')),
    emo('autochess_battle_foolwisdel_04', 1063, 'pic_foolwisdel_04_battle', N_('维维美 4')),
    emo('autochess_battle_foolwisdel_05', 1064, 'pic_foolwisdel_05_battle', N_('维维美 5')),
    emo('autochess_battle_foolwisdel_06', 1065, 'pic_foolwisdel_06_battle', N_('维维美 6')),
  ] },
].map((t) => Object.freeze({ ...t, emotes: Object.freeze(t.emotes) })));
/** Every emote with its theme: `{ id, sortId, picId, label, themeId, dir }`, in wheel order. */
export const EMOTE_CATALOG = Object.freeze(EMOTE_THEMES.flatMap((t) => t.emotes.map((e) => Object.freeze({ ...e, themeId: t.themeId, dir: t.dir }))));
/** The 36 official emote ids (protocol whitelist: `EMOTES.includes(id)`). */
export const EMOTES = Object.freeze(EMOTE_CATALOG.map((e) => e.id));
const EMOTE_INDEX = new Map(EMOTE_CATALOG.map((e) => [e.id, e]));
/** Catalog record of an emote id, or null (safe for any input, including '__proto__'). */
export const emoteInfo = (id) => (typeof id === 'string' && EMOTE_INDEX.get(id)) || null;
// id-keyed maps without a prototype: a wire id like '__proto__' / 'toString' looks up undefined, never an Object method
const emoteMap = (pick) => Object.freeze(Object.assign(Object.create(null), Object.fromEntries(EMOTE_CATALOG.map((e) => [e.id, pick(e)]))));
/** Emote id → theme id. */
export const EMOTE_THEME = emoteMap((e) => e.themeId);
/** Emote id → our aria-label (never displayed). */
export const EMOTE_LABEL = emoteMap((e) => e.label);
/** data/local-assets.json group of an emote's art (`emoticon/<dir>`), or null. */
export const emoteArtGroup = (id) => { const e = emoteInfo(id); return e ? `emoticon/${e.dir}` : null; };
/** Canonical URL of an emote's extracted art (`/assets/local/emoticon/<dir>/<picId>.png`), or null for unknown ids. */
export const emoteArtPath = (id) => { const e = emoteInfo(id); return e ? `/assets/local/emoticon/${e.dir}/${e.picId}.png` : null; };
export const EMOTE_COOLDOWN_MS = 1000; // activity_table autoChessData.constData.chatCD (s)
export const EMOTE_BUBBLE_MS = 3000;   // constData.chatTime (s): how long a bubble stays up
// 局内文字聊天：
//   CHAT_MAX_LEN 单条上限（官方聊天 80 字）· CHAT_COOLDOWN_MS 发送冷却 · 服务器还要 trim + 去控制字符。
export const CHAT_MAX_LEN = 80;
export const CHAT_COOLDOWN_MS = 2000;
