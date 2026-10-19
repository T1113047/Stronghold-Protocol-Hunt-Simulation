// test/match/event.test.js — 2V2 事件期 (类肉鸽词条): the three ordered periods (contest round / +4 / R13), the four
// targets and the no-repeat rule, the per-sequence type / entry odds, the self ×2 magnitude, every ally entry's effect
// (battle stats, deploy cap, income, refresh / sell prices, placed-monster bounty, enemy move speed, SP, the environment
// buff bucket), the independent monster channel (enemy-only mods, 赏金怪 inclusion without repricing, no repeats,
// per-sequence EV) and the AI / timeout auto-pick / server error codes.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import {
  PHASE, ERR, EVENT_TARGETS, EVENT_CARDS, EVENT_SELF_MUL, EVENT_SEQUENCE, EVENT_ROSTER_MS,
  EVENT_FOE_CARDS, EVENT_FOE_ELITES, EVENT_DURATION_ROUNDS,
} from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import {
  eventCardById, eventCardByKey, eventKindOf, eventMagnitude, eventModsFor, eventEvFor, eventBattleRefs,
  eventEntryActive, eventActiveEntries, eventCardDuration, eventFoeCardById, eventFoeCardByKey, eventFoeKindOf, eventFoeEv,
  eventFoeMeanEv, eventFoeEliteByKey,
} from '../../server/match/match/event.js';
import { createRng } from '../../server/sim/rng.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const C = eventCardByKey;

/** 4 seats as two teams of two (0,1 → team 0; 2,3 → team 1), like versus.test.js. */
const vsSeats = (human = 'p_0') => ([
  { seat: 0, playerId: human, name: 'A0', isBot: false, connected: true, team: 0 },
  { seat: 1, playerId: 'ai_1', name: 'A1', isBot: true, connected: true, team: 0 },
  { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
  { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
]);
const botSeats = () => ['p_0', 'p_1', 'p_2', 'p_3'].map((playerId, seat) => ({ seat, playerId, name: `B${seat}`, isBot: true, connected: true, team: Math.floor(seat / 2) }));

/** Drive to the event period of `round` (the human still has to pick — the phase waits for it). The human is put on
 *  AI 托管 while driving (the 2V2 对抗期 and the prep need submissions), and taken off it at the event period so the test
 *  controls the pick. */
function toEvent(h, round) {
  const p0 = h.ps('p_0');
  if (p0) p0.autoplay = true;
  const ok = h.drive(() => h.m.phase === PHASE.EVENT && h.m.round === round);
  if (p0) p0.autoplay = false;
  assert.ok(ok, `did not reach EVENT R${round} (phase ${h.m.phase} R${h.m.round})`);
  return h;
}

/** Records of one event index. */
const recordsOf = (m, index) => m.eventHistory.filter((r) => r.index === index);

describe('2V2 事件期: the periods, targets and no-repeat rule', () => {
  test('three events at the contest round / +4 / R13, one target each, a target cannot repeat (a 4th is impossible)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 20261017, fake: true }).start();
    const m = h.m;
    const p0 = h.ps('p_0');
    const rounds = m.eventRounds;
    assert.equal(rounds.length, 3);
    assert.equal(rounds[0], m.contestStartRound, 'E1 is the first 狩猎期 round');
    assert.equal(rounds[1], m.contestStartRound + 4, 'E2 is four rounds later');
    assert.equal(rounds[2], 13, 'E3 is the 最终狩猎 R13');
    assert.ok(![14, 15].includes(rounds[0]) && ![14, 15].includes(rounds[1]) && ![14, 15].includes(rounds[2]), 'no boss round');

    toEvent(h, rounds[0]);
    assert.equal(m.event.index, 1);
    assert.deepEqual(p0.eventTargets, []);
    // the 4 targets of every seat: self / mate / oppA / oppB map to real seats of the right team
    const map = m.eventTargetIds(p0);
    assert.deepEqual(map, { self: 'p_0', mate: 'ai_1', oppA: 'ai_2', oppB: 'ai_3' });
    assert.notEqual(m.teamIdOf(h.ps(map.oppA)), m.teamIdOf(p0));
    assert.notEqual(m.teamIdOf(h.ps(map.oppB)), m.teamIdOf(p0));
    assert.equal(m.teamIdOf(h.ps(map.mate)), m.teamIdOf(p0));
    // public info: the target maps, the available keys and the deadline are in m.public.event.ally; the monster entry
    // rides in m.public.event.foe (both are public channels)
    const pub = m.publicView();
    assert.ok(pub.event && pub.event.ally.active);
    assert.deepEqual(pub.event.ally.rounds, rounds);
    assert.deepEqual(pub.event.foe.rounds, rounds);
    assert.deepEqual(pub.event.ally.available.p_0, [...EVENT_TARGETS]);
    assert.ok(pub.event.ally.deadline > 0, 'the event period is timed');
    assert.ok(pub.event.foe && pub.event.foe.card != null, 'the monster entry is drawn when the period opens');
    assert.ok(EVENT_FOE_CARDS.some((c) => c.id === pub.event.foe.card));

    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'self' }), { ok: true });
    assert.deepEqual(p0.eventTargets, ['self']);
    // the self pick applies at ×2 (whatever entry was drawn)
    const rec = m.event.picks.get('p_0');
    assert.equal(rec.mag, EVENT_SELF_MUL);
    assert.deepEqual(p0.eventMods, eventModsFor([{ card: eventCardById(rec.card), mag: 2 }]));
    // the pick is public: who gave whom + which entry number
    const pub2 = m.publicView();
    assert.equal(pub2.event.ally.picks.p_0.card, rec.card);
    assert.equal(pub2.event.ally.picks.p_0.targetId, 'p_0');
    const evFrame = h.lastBc('m.event');
    assert.ok(evFrame && evFrame.playerId === 'p_0' && evFrame.target === 'self' && evFrame.card === rec.card);

    toEvent(h, rounds[1]);
    assert.equal(m.event.index, 2);
    // repeated target: refused, the seat stays unpicked
    assert.equal(m.handle('p_0', { t: 'g.event.pick', target: 'self' }).error, ERR.ALREADY);
    assert.equal(m.event.picks.has('p_0'), false);
    // unknown target: refused
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'nope' }), { error: ERR.BAD_TARGET });
    assert.notEqual(validateC2S({ t: 'g.event.pick', target: 'nope' }), null);
    assert.equal(validateC2S({ t: 'g.event.pick', target: 'mate' }), null);
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'mate' }), { ok: true });

    toEvent(h, rounds[2]);
    assert.equal(m.event.index, 3);
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'oppA' }), { ok: true });
    // let the bots take their picks and close the period
    assert.ok(h.run(() => m.phase !== PHASE.EVENT));

    // exactly three events, three distinct targets for the human, and no event period ever again
    assert.ok(recordsOf(m, 1).length > 0 && recordsOf(m, 2).length > 0 && recordsOf(m, 3).length > 0);
    assert.deepEqual(p0.eventTargets, ['self', 'mate', 'oppA']);
    assert.equal(new Set(p0.eventTargets).size, 3);
    assert.equal(m.eventIndex, 3);
    p0.autoplay = true;
    const ok = h.drive(() => m.round >= 14 || h.ended != null);
    assert.ok(ok, 'reached R14');
    assert.equal(m.eventDue(), false);
    assert.equal(m.eventIndex, 3);

    // err code for a pick outside the phase
    if (h.ended == null) assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'oppB' }), { error: ERR.WRONG_PHASE });
  });

  test('an event period never runs without a hunt (solo / co-op with COOP_HUNT off)', () => {
    // explicit engine switch: this is the pre-feature co-op flow, not a "seed that happens to skip the event" case
    const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 1, bots: 1, seed: 2, fake: true, coopHunt: false }).start();
    const m = h.m;
    h.autoHumans();
    const ok = h.drive(() => m.round >= 6 || h.ended != null);
    assert.ok(ok);
    assert.equal(m.contestStartRound, null);
    assert.deepEqual(m.eventRounds, []);
    assert.equal(m.eventHistory.length, 0);
    assert.equal(m.foeEvent, null);
  });

  test('a co-op hunt runs the real E1/E2/E3 periods and broadcasts each one (seed 2)', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 1, bots: 3, seed: 2, fake: true }).start();
    h.autoHumans();
    const m = h.m;
    assert.equal(m.contestStartRound, 4);
    assert.deepEqual(m.eventRounds, [4, 8, 13]);
    const seen = new Set();
    h.onBroadcast.push((msg) => {
      if (msg.t === 'm.public' && msg.event && msg.event.ally && msg.event.ally.active) seen.add(msg.event.ally.round);
    });
    const ok = h.drive(() => m.round >= 14 || h.ended != null, { maxSteps: 4e6 });
    assert.ok(ok, `reached R14 (phase ${m.phase} R${m.round})`);
    assert.deepEqual([...new Set(m.eventHistory.map((r) => r.index))].sort(), [1, 2, 3], 'three periods, every seat picked');
    assert.deepEqual([...seen].sort((a, b) => a - b), [4, 8, 13], 'each period was broadcast while active');
    for (const r of m.eventHistory) assert.ok([4, 8, 13].includes(r.round), `event pick on R${r.round}`);
    assert.equal(m.eventIndex, 3);
  });

  test('the drawn type follows the per-sequence odds (E1 / E2 / E3, seeded large sample)', () => {
    assert.deepEqual(EVENT_SEQUENCE.map((r) => r.allyOdds), [
      { down: 15, mid: 45, up: 40 },
      { down: 30, mid: 40, up: 30 },
      { down: 45, mid: 30, up: 25 },
    ]);
    assert.deepEqual(EVENT_SEQUENCE.map((r) => r.foeOdds), [
      { favor: 35, mid: 40, unfavor: 25 },
      { favor: 25, mid: 40, unfavor: 35 },
      { favor: 20, mid: 35, unfavor: 45 },
    ]);
    assert.deepEqual(EVENT_SEQUENCE.map((r) => r.eliteShares), [[0.10, 0.15], [0.15, 0.20], [0.20, 0.25]]);
    const rng = createRng(0x5eed2026);
    const n = 200000;
    for (const [i, row] of EVENT_SEQUENCE.entries()) {
      const seq = i + 1;
      const ally = { down: 0, mid: 0, up: 0 };
      const foe = { favor: 0, mid: 0, unfavor: 0 };
      for (let k = 0; k < n; k++) {
        ally[eventKindOf(rng, 'self', seq)]++;
        foe[eventFoeKindOf(rng, seq)]++;
      }
      for (const kind of ['down', 'mid', 'up']) {
        assert.ok(Math.abs(ally[kind] / n - row.allyOdds[kind] / 100) < 0.005, `E${seq} ally ${kind}`);
      }
      for (const kind of ['favor', 'mid', 'unfavor']) {
        assert.ok(Math.abs(foe[kind] / n - row.foeOdds[kind] / 100) < 0.005, `E${seq} foe ${kind}`);
      }
    }
    // monster-channel EV per sequence: E1 +0.10, E2 −0.10, E3 −0.25
    assert.ok(Math.abs(eventFoeEv(1) - 0.10) < 1e-12);
    assert.ok(Math.abs(eventFoeEv(2) + 0.10) < 1e-12);
    assert.ok(Math.abs(eventFoeEv(3) + 0.25) < 1e-12);
  });

  test('self doubles every magnitude (and only self)', () => {
    assert.equal(EVENT_SELF_MUL, 2);
    assert.equal(eventMagnitude('self'), 2);
    for (const t of ['mate', 'oppA', 'oppB']) assert.equal(eventMagnitude(t), 1);
    for (const card of EVENT_CARDS) {
      const one = eventModsFor([{ card, mag: 1 }]);
      const two = eventModsFor([{ card, mag: 2 }]);
      for (const key of [
        'atkPct', 'aspd', 'hpPct', 'defPct', 'defIgnorePct', 'regenPct', 'deploy',
        'spRecoveryFlat', 'spCostFlat', 'goldPerRound', 'bountyGold', 'refreshDiscount', 'refreshUses', 'sellDiscount',
      ]) {
        assert.ok(Math.abs(two[key] - one[key] * 2) < 1e-12, `${card.key}.${key}: ${one[key]} → ${two[key]}`);
      }
      // multiplicative magnitudes double the BONUS part: 8 % taken → 16 %, 15 % speed → 30 %, 0.9 move → 0.8
      for (const key of ['dmgTakenMul', 'enemySpeedMul', 'moveMul', 'spRecoveryMul']) {
        assert.ok(Math.abs(two[key] - (1 + (one[key] - 1) * 2)) < 1e-12, `${card.key}.${key}`);
      }
    }
    // the calibrated values themselves (×1.5 magnitudes; self ×2 on top)
    assert.ok(Math.abs(eventModsFor([{ card: C('whetstone'), mag: 2 }]).atkPct - 0.40) < 1e-12);
    assert.ok(Math.abs(eventModsFor([{ card: C('bloodstain'), mag: 2 }]).dmgTakenMul - 1.24) < 1e-12);
    assert.ok(Math.abs(eventModsFor([{ card: C('mired'), mag: 2 }]).enemySpeedMul - 1.44) < 1e-12);
    assert.ok(Math.abs(eventModsFor([{ card: C('burden_armor'), mag: 2 }]).moveMul - 0.70) < 1e-12);
    assert.ok(Math.abs(eventModsFor([{ card: C('breath_swap'), mag: 2 }]).spRecoveryMul - 1.44) < 1e-12);
  });

  test('every ally entry feeds at least one modifier (a table-driven coverage check)', () => {
    // card field → accumulated modifier (multiplicative fields: 1 + value; dmgTaken / enemySpeed are stored as ratios)
    const MAP = {
      atkPct: 'atkPct', aspd: 'aspd', hpPct: 'hpPct', defPct: 'defPct', defIgnorePct: 'defIgnorePct',
      regenPct: 'regenPct', dmgTaken: 'dmgTakenMul', moveMul: 'moveMul', enemySpeed: 'enemySpeedMul',
      spRecoveryMul: 'spRecoveryMul', spRecoveryFlat: 'spRecoveryFlat', spCostFlat: 'spCostFlat',
      goldPerRound: 'goldPerRound', bountyGold: 'bountyGold', deploy: 'deploy',
      refreshDiscount: 'refreshDiscount', refreshUses: 'refreshUses', sellDiscount: 'sellDiscount',
    };
    const MUL_ADD = new Set(['dmgTaken', 'enemySpeed']);
    for (const card of EVENT_CARDS) {
      const mods = eventModsFor([{ card, mag: 1 }]);
      let fields = 0;
      for (const [field, mod] of Object.entries(MAP)) {
        if (card[field] == null) continue;
        fields++;
        const want = MUL_ADD.has(field) ? 1 + card[field] : card[field];
        assert.ok(Math.abs(mods[mod] - want) < 1e-12, `${card.key}.${field} → ${mod}: ${mods[mod]} vs ${want}`);
      }
      assert.ok(fields > 0, `${card.key} carries no recognised effect`);
    }
  });

  test('the ally table has no range / DP / price entry (射程 and 费用 were removed)', () => {
    const banned = /^(range|rangeExtend|rangeBonus|distance|dp|dpPerSec|addDp|chessPrice|price|cost|purchasePrice)$/i;
    for (const card of EVENT_CARDS) {
      for (const key of Object.keys(card)) assert.ok(!banned.test(key), `${card.key} carries ${key}`);
      assert.ok(!/range|eagle|trap_setup|distance/i.test(card.key), card.key);
    }
    // the monster pool is enemy-only data (no player / economy fields)
    for (const card of EVENT_FOE_CARDS) {
      for (const key of Object.keys(card)) assert.ok(!banned.test(key), `${card.key} carries ${key}`);
    }
    // the two removed entries are gone for good
    assert.equal(eventCardByKey('eagle_eye'), null);
    assert.equal(eventCardByKey('trap_setup'), null);
  });
});

describe('2V2 事件期: every entry actually applies', () => {
  const stats = (refs) => {
    const h = makeBattle({
      defs: { chess: { test_guard: chessRec({ id: 'test_guard', stats: { maxHp: 1000, atk: 100, aspd: 100 } }) } },
      units: [{ chessId: 'test_guard', row: 10, col: 5 }],
      players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 10, col: 5 }], bonds: {}, playerEffects: refs }],
      enemies: [],
    });
    h.run(0.1);
    return h.unit('test_guard').s;
  };

  test('ATK / ASPD / HP / DEF / def-ignore / regen / damage taken by the battle content module', () => {
    const base = stats([]);
    const refs = eventBattleRefs([
      { card: C('whetstone') },   // 磨刃 ATK +13 %
      { card: C('tailwind') },    // 追风 ASPD +12
      { card: C('hunter_cloak') }, // 猎人披挂 HP +25 %
      { card: C('campfire') },    // 营地篝火 +6 % max HP/s
      { card: C('bloodstain') },  // 血痕 受伤 +8 %
      { card: C('iron_hide') },   // 铁衣 DEF +15 %
      { card: C('armor_break') }, // 破甲 无视 15 % DEF
    ]);
    const s = stats(refs);
    assert.ok(Math.abs(s.atk - base.atk * 1.20) < 1e-6, `atk ${base.atk} → ${s.atk}`);
    assert.equal(s.aspd, base.aspd + 18);
    assert.ok(Math.abs(s.maxHp - base.maxHp * 1.38) < 1e-6, `hp ${base.maxHp} → ${s.maxHp}`);
    assert.ok(Math.abs(s.def - base.def * 1.22) < 1e-6, `def ${base.def} → ${s.def}`);
    assert.ok(Math.abs(s.defIgnorePct - 0.22) < 1e-12, '破甲: 无视 22 % DEF');
    assert.ok(Math.abs(s.hpRegen - s.maxHp * 0.09) < 1e-6, '营地篝火: +9 % max HP per second');
    assert.ok(Math.abs(s.dmgTakenMul - 1.12) < 1e-12, '血痕: 受伤 +12 %');
  });

  test('SP entries: spRecoveryMul / spRecoveryFlat / spCostFlat all take effect', () => {
    const unitOf = (refs) => {
      const h = makeBattle({
        defs: { chess: { test_guard: chessRec({ id: 'test_guard', stats: { maxHp: 1000, atk: 100, aspd: 100, spRecovery: 1 } }) } },
        units: [{ chessId: 'test_guard', row: 10, col: 5 }],
        players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 10, col: 5 }], bonds: {}, playerEffects: refs }],
        enemies: [],
      });
      h.run(0.1);
      return h.unit('test_guard');
    };
    const base = unitOf([]);
    assert.equal(base.s.spRecovery, 1);
    assert.equal(base.skill.spCost, 10);
    // 蓄势: +15 % recovery
    assert.ok(Math.abs(unitOf(eventBattleRefs([{ card: C('build_up') }])).s.spRecovery - 1.15) < 1e-9);
    // 静息: +0.15 SP/s
    assert.ok(Math.abs(unitOf(eventBattleRefs([{ card: C('stillness') }])).s.spRecovery - 1.15) < 1e-9);
    // 轻省: cost −1 (floored at 0 by the engine)
    assert.equal(unitOf(eventBattleRefs([{ card: C('frugal') }])).skill.spCost, 9);
    // 滞涩: −15 %
    assert.ok(Math.abs(unitOf(eventBattleRefs([{ card: C('stagnant') }])).s.spRecovery - 0.85) < 1e-9);
    // 换息 / 回环: the exchange values
    const swap = unitOf(eventBattleRefs([{ card: C('breath_swap') }]));
    assert.ok(Math.abs(swap.s.spRecovery - 1.22) < 1e-9);
    assert.equal(swap.skill.spCost, 11);
    const cycle = unitOf(eventBattleRefs([{ card: C('cycle') }]));
    assert.ok(Math.abs(cycle.s.spRecovery - 1.15) < 1e-9);
    assert.equal(cycle.skill.spCost, 11);
  });

  // 环境buff乘区 / environment buff bucket:
  //   ① each source multiplies once: base × Π(1 + p_i) — two +20% = 1.44, not 1.40;
  //   ② flat values (ASPD / SP / cost) are highest priority, added to the panel first and never scaled;
  //   ③ event-only: it never mixes with the additive pool of bonds / equipment / skills / 机变.
  test('environment buff bucket: two 20% bonuses = 1.44, flat ASPD stays on the panel', () => {
    const base = stats([]);
    // two separate sources in the environment buff bucket, each +20% ATK → 1.20 × 1.20, not 1 + 0.20 + 0.20
    const twice = stats(eventBattleRefs([{ card: C('whetstone') }, { card: C('whetstone') }]));
    assert.ok(Math.abs(twice.atk - base.atk * 1.44) < 1e-6, `atk ${base.atk} → ${twice.atk}`);
    // flat ASPD is added to the panel first and is not scaled by the bucket
    const withFlat = stats(eventBattleRefs([
      { card: C('whetstone') }, { card: C('whetstone') }, { card: C('tailwind') },
    ]));
    assert.equal(withFlat.aspd, base.aspd + 18);
    assert.ok(Math.abs(withFlat.atk - base.atk * 1.44) < 1e-6);
    // HP / DEF are in the same environment buff bucket too
    const hp = stats(eventBattleRefs([{ card: C('hunter_cloak') }, { card: C('hunter_cloak') }]));
    assert.ok(Math.abs(hp.maxHp - base.maxHp * 1.38 * 1.38) < 1e-6, `hp ${base.maxHp} → ${hp.maxHp}`);
    const def = stats(eventBattleRefs([{ card: C('iron_hide') }, { card: C('iron_hide') }]));
    assert.ok(Math.abs(def.def - base.def * 1.22 * 1.22) < 1e-6, `def ${base.def} → ${def.def}`);
  });


  test('陷足: enemies of that player move 22 % faster', () => {
    const mk = (refs) => {
      const h = makeBattle({
        defs: {
          chess: { test_guard: chessRec({ id: 'test_guard' }) },
          enemies: { enemy_test: enemyRec({ key: 'enemy_test', speed: 1, hp: 100000, atk: 0 }) },
        },
        units: [{ chessId: 'test_guard', row: 10, col: 5 }],
        players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 10, col: 5 }], bonds: {}, playerEffects: refs }],
        enemies: [{ key: 'enemy_test', time: 0, route: 0 }],
        autoFinish: false,
      });
      h.run(0.1);
      return h.enemy('enemy_test').s.moveSpeed;
    };
    const base = mk([]);
    const buffed = mk(eventBattleRefs([{ card: C('mired') }]));
    assert.ok(Math.abs(buffed - base * 1.22) < 1e-9, `${base} → ${buffed}`);
  });

  test('轻捷: 上场人数 +1 (the deploy cap of the player state)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 3, fake: true }).start();
    const ps = h.ps('p_0');
    const base = ps.deployCap;
    ps.eventEntries = [{ card: C('nimble'), mag: 1 }];
    ps.eventMods = eventModsFor(ps.eventEntries);
    assert.equal(ps.deployCap, base + 1);
  });

  test('猎人佣金 / 空手而归: +3 / −2 gold each round (and ×2 on self)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 4, fake: true }).start();
    const ps = h.ps('p_0');
    ps.eventEntries = [{ card: C('hunter_commission'), mag: 1 }];
    ps.eventMods = eventModsFor(ps.eventEntries);
    ps.funds = 0;
    ps.startRound(5);
    assert.equal(ps.funds, ps.gd.income(5) + 3);

    ps.eventEntries = [{ card: C('empty_handed'), mag: 1 }];
    ps.eventMods = eventModsFor(ps.eventEntries);
    ps.funds = 0;
    ps.startRound(6);
    assert.equal(ps.funds, Math.max(0, ps.gd.income(6) - 2));

    ps.eventEntries = [{ card: C('hunter_commission'), mag: 2 }];
    ps.eventMods = eventModsFor(ps.eventEntries);
    ps.funds = 0;
    ps.startRound(7);
    assert.equal(ps.funds, ps.gd.income(7) + 6);
  });

  test('集市换货: refresh −1 for two refreshes a round, then the normal price; sell −1', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 6, fake: true }).start();
    h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 1, { ready: false });
    const ps = h.ps('p_0');
    ps.eventEntries = [{ card: C('market_swap'), mag: 1 }];
    ps.eventMods = eventModsFor(ps.eventEntries);
    const price = Math.max(0, ps.gd.refreshPrice - 1);
    ps.shop.freeRefreshes = 0;
    ps.funds = 100;
    let before = ps.funds;
    assert.deepEqual(ps.refresh(), { ok: true });
    assert.equal(before - ps.funds, price);
    before = ps.funds;
    assert.deepEqual(ps.refresh(), { ok: true });
    assert.equal(before - ps.funds, price);
    before = ps.funds;
    assert.deepEqual(ps.refresh(), { ok: true });
    assert.equal(before - ps.funds, ps.gd.refreshPrice, 'third refresh is full price');
    before = ps.funds;
    assert.deepEqual(ps.refresh(), { ok: true });
    assert.equal(before - ps.funds, ps.gd.refreshPrice, 'the two discounted uses are per round');
    // per-round reset
    ps.startRound(2);
    ps.shop.freeRefreshes = 0;
    before = ps.funds;
    assert.deepEqual(ps.refresh(), { ok: true });
    assert.equal(before - ps.funds, price);

    // sell price −1
    ps.eventEntries = [{ card: C('market_swap'), mag: 1 }];
    ps.eventMods = eventModsFor(ps.eventEntries);
    const chessId = 'chess_char_1_01_a';
    const baseSell = ps.gd.sellPrice(chessId);
    assert.ok(ps.acquireChess(chessId, { source: 'test' }));
    const piece = ps.hand.find((x) => x && x.kind === 'chess' && x.id === chessId);
    assert.ok(piece, 'the chess is in the hand');
    const beforeSell = ps.funds;
    assert.deepEqual(ps.sell(piece.uid), { ok: true });
    assert.equal(ps.funds - beforeSell, Math.max(0, baseSell - 1));
  });

  test('赏金嗅觉: a monster the opponent placed pays +3 coins per kill', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 7, fake: true }).start();
    const m = h.m;
    toEvent(h, h.m.eventRounds[0]);
    const ps = h.ps('p_0');
    const spawns = (m.wave && m.wave.spawns ? m.wave.spawns : []).slice(0, 3).map((s) => ({ ...s }));
    assert.ok(spawns.length, 'the round has a wave');
    const key = m.confrontGroups()[0].rows[0].key;
    const sub = { picks: [{ enemyKey: key, gate: 'lower' }], position: 'front', ratio: 0.05, seat: 0 };
    const placed = (mods) => {
      ps.eventEntries = mods == null ? [] : [{ card: C('bounty_scent'), mag: mods }];
      ps.eventMods = eventModsFor(ps.eventEntries);
      const out = m.applyConfront(spawns, sub, ps);
      return out.find((s) => s && s.countInTotal === false && s.bounty);
    };
    const plain = placed(null);
    const scented = placed(1);
    assert.ok(plain && scented);
    assert.equal(scented.bounty.coins, plain.bounty.coins + 3);
    assert.equal(scented.bounty.bank, true, 'placed-monster bounties stay 赏金 (banked)');
  });
});

describe('2V2 事件期: the monster channel', () => {
  test('the monster entry is independent of the targets, public, and only touches enemy spawns', () => {
    const mk = (pick) => {
      const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 99, fake: true }).start();
      toEvent(h, h.m.eventRounds[0]);
      const before = h.m.foeEvent.card.id;
      h.m.handle('p_0', { t: 'g.event.pick', target: pick });
      return { h, before };
    };
    const a = mk('self');
    const b = mk('mate');
    assert.equal(a.before, b.before, 'the same seed + event draws the same monster card regardless of the target');
    assert.equal(a.h.m.foeEvent.card.id, a.before, 'the ally pick never re-draws the monster entry');
    const m = a.h.m;
    const p0 = a.h.ps('p_0');
    // public to both channels
    const pub = m.publicView();
    assert.equal(pub.event.foe.card, a.before);
    assert.ok(pub.event.foe.history.some((r) => r.index === 1 && r.card === a.before));
    // never in the player's mods (the ally entry is the only one there)
    assert.equal(p0.eventEntries.length, 1);
    assert.equal(p0.eventEntries[0].card.class === 'output' || p0.eventEntries[0].card.class === 'survival'
      || p0.eventEntries[0].card.class === 'sp' || p0.eventEntries[0].card.class === 'economy', true);
    assert.equal(Object.hasOwn(p0.eventEntries[0].card, 'hpMul'), false);

    // the spawn merge: a copy, the input untouched, multipliers composed, count shifted
    const card = m.foeEvent.card;
    const input = [{ enemyKey: 'enemy_test', count: 2, mods: { hpMul: 2, atkMul: 1.5 } }];
    const out = m.foeEventSpawns(input);
    assert.notEqual(out, input);
    assert.deepEqual(input, [{ enemyKey: 'enemy_test', count: 2, mods: { hpMul: 2, atkMul: 1.5 } }], 'the input is never mutated');
    assert.equal(out[0].enemyKey, 'enemy_test');
    assert.ok(Math.abs(out[0].mods.hpMul - 2 * (card.hpMul || 1)) < 1e-12);
    assert.ok(Math.abs(out[0].mods.atkMul - 1.5 * (card.atkMul || 1)) < 1e-12);
    if (card.speedMul) assert.ok(Math.abs(out[0].mods.speedMul - card.speedMul) < 1e-12);
    if (card.defMul) assert.ok(Math.abs(out[0].mods.defMul - card.defMul) < 1e-12);
    assert.equal(out[0].count, Math.max(1, 2 + (card.countAdd || 0)));

    // the entry is for THIS round only
    m.round = m.foeEvent.round + 1;
    assert.equal(m.foeEventSpawns(input), input);
    m.round = m.foeEvent.round;
  });

  test('the monster pool: 4 classes × 3 (favor / mid / unfavor), E2 25/40/35 draws, EV −0.10, no repeats', () => {
    assert.equal(EVENT_FOE_CARDS.length, 12);
    for (const cls of ['attack', 'survival', 'speed', 'count']) {
      const list = EVENT_FOE_CARDS.filter((c) => c.class === cls);
      assert.equal(list.length, 3, cls);
      assert.deepEqual(list.map((c) => c.kind).sort(), ['favor', 'mid', 'unfavor'], cls);
    }
    assert.deepEqual(EVENT_SEQUENCE[1].foeOdds, { favor: 25, mid: 40, unfavor: 35 });
    // EV: +1 / 0 / −1 over 25 / 40 / 35 = −0.10 per event
    assert.ok(Math.abs(eventFoeMeanEv('favor') - 1) < 1e-12);
    assert.ok(Math.abs(eventFoeMeanEv('mid')) < 1e-12);
    assert.ok(Math.abs(eventFoeMeanEv('unfavor') + 1) < 1e-12);
    assert.ok(Math.abs(eventFoeEv() + 0.10) < 1e-12);
    const rng = createRng(0xf0e2026);
    const n = 200000;
    const count = { favor: 0, mid: 0, unfavor: 0 };
    for (let i = 0; i < n; i++) count[eventFoeKindOf(rng)]++;
    for (const kind of ['favor', 'mid', 'unfavor']) {
      const want = EVENT_SEQUENCE[1].foeOdds[kind] / 100;
      assert.ok(Math.abs(count[kind] / n - want) < 0.005, `${kind}: ${count[kind] / n} vs ${want}`);
    }
    // three periods → three distinct monster entries (the pool is never repeated)
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: botSeats(), seed: 23, fake: true }).start();
    const m = h.m;
    assert.ok(h.run(() => m.round >= 14 || h.ended != null, { maxSteps: 3e6 }));
    assert.equal(m.eventFoeHistory.length, 3);
    assert.equal(new Set(m.eventFoeHistory.map((r) => r.card)).size, 3);
    // and no player saw the same ally entry twice, nor the match itself (24 cards, at most 12 ally draws)
    assert.equal(m.eventUsedAlly.size, m.eventHistory.length, 'the ally pool never repeats within one match');
    for (const ps of m.players.values()) assert.equal(new Set(ps.eventCards).size, ps.eventCards.length);
    // a known monster entry round-trips by key and id (×1.5 values)
    assert.equal(eventFoeCardByKey('fangs').id, eventFoeCardById(3).id);
    assert.equal(eventFoeCardByKey('fangs').atkMul, 1.15);
    assert.equal(eventFoeCardByKey('hard_shell').defMul, 1.22);
    assert.equal(eventFoeCardByKey('hard_shell').speedMul, 0.78);
    assert.equal(eventFoeCardByKey('thick_hide').hpMul, 1.18);
    assert.equal(eventFoeCardByKey('coiled').speedMul, 0.7);
    assert.equal(eventFoeCardByKey('coiled').hpMul, 1.18);
    assert.equal(eventFoeCardByKey('replace').hpMul, 1.3);
  });

  test('the 强力属性 subset: per-sequence share, count formula, 赏金怪 included but never repriced', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 31, fake: true }).start();
    toEvent(h, h.m.eventRounds[0]);
    const m = h.m;
    const elite = m.foeEvent.elite;
    assert.ok(EVENT_SEQUENCE[0].eliteShares.includes(elite.share), `E1 share ${elite.share}`);
    assert.ok(EVENT_FOE_ELITES.some((a) => a.key === elite.attr), `attr ${elite.attr}`);
    assert.ok(elite.share >= 0.10 && elite.share <= 0.15);
    // the public count is based on the CARDED match-wide wave (the monster entry applies first)
    const carded = m.foeEventSpawns(m.wave.spawns);
    const total = carded.reduce((n, s) => n + Math.max(1, Math.trunc(Number(s.count) || 1)), 0);
    assert.equal(elite.count, Math.max(1, Math.round(elite.share * total)));
    // public shape
    assert.deepEqual(m.publicView().event.foe.elite, { share: elite.share, attr: elite.attr, count: elite.count });

    // 赏金怪 (tag 'bounty') joins the elite pool; the applied count includes its units; coins never move
    const bounty = { enemyKey: 'enemy_test', count: 2, mods: { atkMul: 1.5 }, tag: 'bounty', bounty: { coins: 5, ownerPlayerId: 'p_0' } };
    const wave = m.foeWaveSpawns([...m.wave.spawns, bounty]);
    const marked = wave.filter((s) => s.elite).reduce((n, s) => n + Number(s.count), 0);
    assert.equal(marked, Math.max(1, Math.round(elite.share * (total + 2))));
    const keptBounty = wave.filter((s) => s.tag === 'bounty');
    assert.equal(keptBounty.reduce((n, s) => n + Number(s.count), 0), 2);
    assert.ok(keptBounty.every((s) => s.bounty.coins === 5), 'bounty.coins is never recalculated');
    assert.equal(keptBounty.reduce((n, s) => n + s.bounty.coins * s.count, 0), 10, 'total payout unchanged');

    // a bounty-only list proves the subset can actually land on 赏金怪 (and still never repricing them)
    const savedCard = m.foeEvent.card;
    m.foeEvent.card = eventFoeCardByKey('replace'); // countAdd −1, hpMul 1.30
    const onlyBounty = m.foeWaveSpawns([{ ...bounty, count: 4, time: 1 }]);
    const parts = onlyBounty.filter((s) => s.tag === 'bounty');
    assert.equal(parts.reduce((n, s) => n + Number(s.count), 0), 4, 'the card count change never touches a bounty');
    assert.ok(parts.every((s) => Math.abs((s.mods.hpMul || 1) - 1.3) < 1e-12), 'the card stats do reach the bounty');
    assert.ok(parts.some((s) => s.elite), 'a bounty can be marked 强力');
    assert.ok(parts.every((s) => s.bounty.coins === 5));
    assert.equal(parts.reduce((n, s) => n + s.bounty.coins * s.count, 0), 20);
    m.foeEvent.card = savedCard;

    // the marked runs compose the card's mods with the attribute's (×, not replacement)
    const attr = eventFoeEliteByKey(elite.attr);
    const card = m.foeEvent.card;
    const markedSpec = wave.find((s) => s.elite);
    for (const k of ['atkMul', 'hpMul', 'defMul', 'speedMul']) {
      if (!attr[k]) continue;
      assert.ok(Math.abs(markedSpec.mods[k] - (card[k] || 1) * attr[k]) < 1e-12, `${k}: ${markedSpec.mods[k]}`);
    }

    // the 狩猎期 placements are appended AFTER the wave processing: no elite flag, no elite attribute
    const sub = { picks: [{ enemyKey: m.confrontGroups()[0].rows[0].key, gate: 'lower' }], position: 'front', ratio: 0.05, seat: 0 };
    const placed = m.applyConfront(wave, sub, h.ps('p_0')).find((s) => s && s.countInTotal === false);
    assert.ok(placed);
    assert.equal(placed.elite, undefined);

    // same seed → same share / attr / count / mods
    const h2 = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 31, fake: true }).start();
    toEvent(h2, h2.m.eventRounds[0]);
    assert.deepEqual(h2.m.foeEvent.elite, elite);
    assert.deepEqual(h2.m.publicView().event.foe.elite, m.publicView().event.foe.elite);
  });
});

describe('2V2 事件期: an ally entry lasts EVENT_DURATION_ROUNDS rounds', () => {
  test('the window is picked … picked+3; picked+4 is back to the baseline (mods and battle refs)', () => {
    assert.equal(EVENT_DURATION_ROUNDS, 4);
    const entry = { card: C('whetstone'), mag: 1, round: 8 };
    const atk = (r) => eventModsFor([entry], r).atkPct;
    assert.ok(Math.abs(atk(7)) < 1e-12, 'not picked yet');
    for (const r of [8, 9, 10, 11]) assert.ok(Math.abs(atk(r) - 0.20) < 1e-12, `R${r} (= picked+${r - 8}) is in force`);
    assert.equal(atk(12), 0, 'picked+4 expired: base ATK');
    assert.equal(eventEntryActive(entry, 11), true);
    assert.equal(eventEntryActive(entry, 12), false);
    assert.deepEqual(eventActiveEntries([entry], 12), []);
    // the battle side follows the same window
    for (const r of [8, 9, 10, 11]) assert.equal(eventBattleRefs([entry], r).length, 1, `R${r} refs`);
    assert.deepEqual(eventBattleRefs([entry], 12), []);
    // entries without a round (hand-built states / the raw log) are never filtered
    assert.ok(Math.abs(eventModsFor([{ card: C('whetstone'), mag: 1 }], 99).atkPct - 0.20) < 1e-12);
    assert.equal(eventBattleRefs([{ card: C('whetstone'), mag: 1 }], 99).length, 1);
  });

  test('经济类负面词条（空手而归）只持续 1 回合', () => {
    const card = C('empty_handed');
    assert.ok(card, 'empty_handed exists');
    assert.equal(eventCardDuration(card), 1);
    const entry = { card, duration: 1, mag: 1, round: 8 };
    assert.equal(eventEntryActive(entry, 8), true);
    assert.equal(eventEntryActive(entry, 9), false);
    assert.equal(eventModsFor([entry], 8).goldPerRound, -2);
    assert.equal(eventModsFor([{ ...entry, mag: 2 }], 8).goldPerRound, -4, 'self doubles the −2');
    assert.equal(eventModsFor([entry], 9).goldPerRound, 0);
    // a normal entry still lasts the full 4 rounds
    assert.equal(eventCardDuration(C('whetstone')), EVENT_DURATION_ROUNDS);
    assert.equal(eventEntryActive({ card: C('whetstone'), mag: 1, round: 8 }, 11), true);
  });

  test('a picked entry holds for 4 rounds, then income / battle refs return to the baseline (startRound re-derives)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 51, fake: true }).start();
    const ps = h.ps('p_0');
    const picked = 8;
    ps.eventEntries = [
      { card: C('hunter_commission'), mag: 1, from: 'ai_1', round: picked, target: 'oppA' },
      { card: C('whetstone'), mag: 1, from: 'ai_1', round: picked, target: 'oppA' },
    ];
    for (const r of [picked, picked + 1, picked + 2, picked + 3]) {
      ps.funds = 0;
      ps.startRound(r);
      assert.equal(ps.eventMods.goldPerRound, 3, `R${r}: still in force`);
      assert.equal(ps.funds, ps.gd.income(r) + 3, `R${r}: income +3`);
      assert.ok(ps.battleInput().playerEffects.some((e) => e.source === 'event'), `R${r}: the battle still receives it`);
    }
    ps.funds = 0;
    ps.startRound(picked + 4);
    assert.equal(ps.eventMods.goldPerRound, 0, 'expired: no event gold');
    assert.equal(ps.funds, ps.gd.income(picked + 4), 'expired: base income');
    assert.deepEqual(ps.battleInput().playerEffects.filter((e) => e.source === 'event'), [], 'expired: no battle refs');
    assert.equal(ps.eventEntries.length, 2, 'the records themselves are kept (history, not "currently in force")');
  });

  test('economy entries (每回合金 / 刷新费 / 出售价) expire with the window too', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 53, fake: true }).start();
    const ps = h.ps('p_0');
    const picked = 5;
    ps.eventEntries = [
      { card: C('hunter_commission'), mag: 1, round: picked },
      { card: C('market_swap'), mag: 1, round: picked },
    ];
    const chessId = 'chess_char_1_01_a';
    const baseSell = ps.gd.sellPrice(chessId);
    // 集市换货 now lasts one round; 猎人佣金 still four
    for (const r of [picked, picked + 1, picked + 2, picked + 3]) {
      ps.funds = 0;
      ps.startRound(r);
      assert.equal(ps.eventMods.goldPerRound, 3, `R${r} income entry`);
      assert.equal(ps.funds, ps.gd.income(r) + 3, `R${r} income +3`);
      assert.equal(ps.eventRefreshDiscount(), r === picked ? 1 : 0, `R${r} refresh discount only on the pick round`);
      assert.equal(ps.eventSellGain(baseSell), r === picked ? baseSell - 1 : baseSell, `R${r} sell −1 only on the pick round`);
    }
    ps.funds = 0;
    ps.startRound(picked + 4);
    assert.equal(ps.eventMods.goldPerRound, 0);
    assert.equal(ps.funds, ps.gd.income(picked + 4), 'the income entry expired');
    assert.equal(ps.eventRefreshDiscount(), 0, 'the refresh discount expired');
    assert.equal(ps.eventSellGain(baseSell), baseSell, 'the sell discount expired (a sold operator returns its base price)');
  });

  test('two events keep their own windows (an entry picked at 8 and one at 10 overlap, then each expires on its own)', () => {
    const first = { card: C('whetstone'), mag: 1, round: 8 };      // ATK +20 %, in force R8–R11
    const second = { card: C('hunter_cloak'), mag: 1, round: 10 };  // HP +38 %, in force R10–R13
    const mods = (r) => eventModsFor([first, second], r);
    assert.ok(Math.abs(mods(8).atkPct - 0.20) < 1e-12 && mods(8).hpPct === 0);
    assert.ok(Math.abs(mods(9).atkPct - 0.20) < 1e-12 && mods(9).hpPct === 0);
    assert.ok(Math.abs(mods(10).atkPct - 0.20) < 1e-12 && Math.abs(mods(10).hpPct - 0.38) < 1e-12, 'R10: both in force');
    assert.ok(Math.abs(mods(11).atkPct - 0.20) < 1e-12 && Math.abs(mods(11).hpPct - 0.38) < 1e-12, 'R11: both still in force');
    assert.ok(mods(12).atkPct === 0 && Math.abs(mods(12).hpPct - 0.38) < 1e-12, 'R12: only the second remains');
    assert.ok(mods(13).atkPct === 0 && Math.abs(mods(13).hpPct - 0.38) < 1e-12);
    assert.deepEqual(eventActiveEntries([first, second], 14), [], 'R14: both expired');
    // the real E1/E2 distance is 4 rounds, so the two real windows are adjacent (E1 ends at E2−1)
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 57, fake: true }).start();
    assert.equal(h.m.eventRounds[1] - h.m.eventRounds[0], EVENT_DURATION_ROUNDS);
  });

  test('m.public.event exposes the duration; history still carries every pick (only "in force" is filtered)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 59, fake: true }).start();
    const m = h.m;
    toEvent(h, m.eventRounds[0]);
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'self' }), { ok: true });
    assert.ok(h.run(() => m.phase !== PHASE.EVENT));
    const pub = m.publicView();
    assert.equal(pub.event.ally.duration, EVENT_DURATION_ROUNDS);
    const rec = pub.event.ally.history.find((r) => r.playerId === 'p_0');
    assert.equal(rec.round, m.eventRounds[0], 'the pick keeps its round');
    assert.equal(pub.event.ally.history.length, m.alivePlayers().length, 'the full record is still public');
  });
});

describe('2V2 事件期: roster hold', () => {
  test('all picked → 5 s roster; 4999 ms still EVENT, 5000 ms continues; idempotent; two events do not stack', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 41, fake: true }).start();
    const m = h.m;
    assert.equal(h.sched.virtual, true, 'virtual time');
    const first = m.eventRounds[0];
    toEvent(h, first);
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'self' }), { ok: true });
    assert.ok(h.run(() => m.eventStage === 'roster' || m.phase !== PHASE.EVENT), 'the roster opened');
    assert.equal(m.phase, PHASE.EVENT);
    assert.equal(m.eventStage, 'roster');
    const until = m.deadline;
    assert.equal(m.event.rosterUntil, until);
    const pub = m.publicView();
    assert.equal(pub.event.ally.stage, 'roster');
    assert.deepEqual(pub.event.ally.roster, { until, ms: EVENT_ROSTER_MS });
    assert.equal(pub.event.ally.roster.ms, 5000);
    assert.equal(pub.event.ally.history.length, m.alivePlayers().length, 'every pick is archived');
    assert.equal(Object.keys(pub.event.ally.picks).length, m.alivePlayers().length);
    // idempotent: a second call does not replace or stack the timer
    assert.equal(m.enterEventRoster(), false);
    assert.equal(m.deadline, until);
    // 4999 ms: still the event period, no SP_DRAFT / PREP
    h.sched.advance(4999);
    assert.equal(m.phase, PHASE.EVENT);
    assert.equal(m.eventStage, 'roster');
    // the 5000th ms: the round continues
    h.sched.advance(1);
    assert.ok([PHASE.SP_DRAFT, PHASE.PREP, PHASE.COMBAT, PHASE.SETTLE].includes(m.phase), `phase ${m.phase}`);
    assert.equal(m.eventStage, null);

    // the next event has its own 5 s hold and no leftover timer from the first
    toEvent(h, m.eventRounds[1]);
    assert.equal(m.eventStage, null);
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'mate' }), { ok: true });
    assert.ok(h.run(() => m.eventStage === 'roster' || m.phase !== PHASE.EVENT));
    assert.equal(m.phase, PHASE.EVENT);
    assert.equal(m.eventStage, 'roster');
    const until2 = m.deadline;
    assert.ok(until2 > until, 'a new roster clock');
    h.sched.advance(4999);
    assert.equal(m.phase, PHASE.EVENT);
    h.sched.advance(1);
    assert.notEqual(m.phase, PHASE.EVENT);
  });

  test('the timeout fill also opens the roster (phase stays EVENT for the hold)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 43, fake: true }).start();
    const m = h.m;
    toEvent(h, m.eventRounds[0]);
    assert.equal(m.event.picks.has('p_0'), false);
    assert.ok(h.run(() => m.eventStage === 'roster' || m.phase !== PHASE.EVENT), 'the timeout opened the roster');
    assert.equal(m.phase, PHASE.EVENT);
    assert.equal(m.eventStage, 'roster');
    const pub = m.publicView();
    assert.equal(pub.event.ally.roster.ms, EVENT_ROSTER_MS);
    assert.equal(pub.event.ally.history.length, m.alivePlayers().length);
    assert.ok(pub.event.ally.history.some((r) => r.playerId === 'p_0' && r.auto === true), 'the AI fill is public');
    h.sched.advance(4999);
    assert.equal(m.phase, PHASE.EVENT);
    h.sched.advance(1);
    assert.notEqual(m.phase, PHASE.EVENT);
  });
});

describe('2V2 事件期: AI, timeout and server authority', () => {
  test('AI seats pick the highest EV target at once (and never stall the phase)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: botSeats(), seed: 11, fake: true }).start();
    const m = h.m;
    const ok = h.run(() => m.round >= 14 || h.ended != null, { maxSteps: 3e6 });
    assert.ok(ok);
    // three periods ran (each event index has one record per seat still alive at that time)
    assert.equal(new Set(m.eventHistory.map((r) => r.index)).size, 3);
    // the EV order moves with the sequence: E1/E2 self > mate > opp; E3 opp > mate > self
    assert.ok(eventEvFor('self', 1) > eventEvFor('mate', 1));
    assert.ok(eventEvFor('mate', 1) > eventEvFor('oppA', 1));
    assert.ok(eventEvFor('self', 2) > eventEvFor('mate', 2));
    assert.ok(eventEvFor('mate', 2) > eventEvFor('oppA', 2));
    assert.ok(eventEvFor('oppA', 3) > eventEvFor('mate', 3));
    assert.ok(eventEvFor('mate', 3) > eventEvFor('self', 3));
    for (const index of [1, 2, 3]) {
      const recs = recordsOf(m, index);
      assert.ok(recs.length > 0, `event #${index} has picks`);
      for (const r of recs) {
        const prior = m.eventHistory.filter((x) => x.playerId === r.playerId && x.index < index).map((x) => x.target);
        const avail = EVENT_TARGETS.filter((t) => !prior.includes(t));
        const best = Math.max(...avail.map((t) => eventEvFor(t, index)));
        assert.ok(Math.abs(eventEvFor(r.target, index) - best) < 1e-9, `${r.playerId} #${index}: ${r.target} is not the EV max`);
      }
      // the 强力属性 share range follows the period
      const foeRec = m.eventFoeHistory.find((x) => x.index === index);
      assert.ok(foeRec && EVENT_SEQUENCE[index - 1].eliteShares.includes(foeRec.elite.share), `E${index} elite share`);
    }
  });

  test('a human who never answers is auto-picked at the deadline and the phase still advances', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 13, fake: true }).start();
    const m = h.m;
    toEvent(h, h.m.eventRounds[0]);
    assert.equal(m.event.picks.has('p_0'), false);
    const ok = h.run(() => m.phase !== PHASE.EVENT || h.ended != null, { maxSteps: 3e6 });
    assert.ok(ok, 'the event phase ended');
    const rec = m.eventHistory.find((r) => r.index === 1 && r.playerId === 'p_0');
    assert.ok(rec, 'the timeout picked for the human');
    assert.equal(rec.auto, true);
    assert.ok(EVENT_TARGETS.includes(rec.target));
    assert.deepEqual(h.ps('p_0').eventTargets, [rec.target]);
    // and the round continues (the prep or the 机变 draft was entered)
    assert.ok([PHASE.PREP, PHASE.SP_DRAFT, PHASE.COMBAT, PHASE.SETTLE].includes(m.phase), `phase ${m.phase}`);
  });

  test('server authority: target legality, phase, elimination and one pick per period', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 17, fake: true }).start();
    const m = h.m;
    // outside the event phase
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'self' }), { error: ERR.WRONG_PHASE });
    toEvent(h, h.m.eventRounds[0]);
    const p0 = h.ps('p_0');
    // a target id that is not one of the four keys
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'p_2' }), { error: ERR.BAD_TARGET });
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'self' }), { ok: true });
    // a second pick in the same period
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'mate' }), { error: ERR.ALREADY });
    // an eliminated seat
    p0.alive = false;
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'mate' }), { error: ERR.ELIMINATED });
    p0.alive = true;
  });
});
