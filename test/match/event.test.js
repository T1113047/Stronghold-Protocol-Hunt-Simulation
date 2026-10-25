// test/match/event.test.js — 2V2 事件期 (类肉鸽词条): the three ordered periods (contest round / +4 / R13), the four
// targets (repeatable since 0.0.5), the 发包规则 (对面包 / 我方包 / 默认包, one pack per selection), the card-draw
// no-repeat rule (the whole 24-entry pool, match-global bag), every ally entry's effect (battle stats, deploy cap,
// income, refresh / sell prices, placed-monster bounty, enemy move speed, SP, the environment buff bucket), the
// independent monster channel (enemy-only mods, 赏金怪 inclusion without repricing, no repeats, unified odds) and the
// AI / timeout side roll / server error codes.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import {
  PHASE, ERR, EVENT_TARGETS, EVENT_CARDS, EVENT_ROSTER_MS, EVENT_PACK_KINDS, EVENT_PACK_SIZE, EVENT_AI_OPP_CHANCE,
  EVENT_FOE_ODDS, EVENT_FOE_CARDS, EVENT_FOE_ELITES, EVENT_FOE_ELITE_SHARES, EVENT_DURATION_ROUNDS,
} from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import {
  eventCardByKey, eventDrawAlly, eventDrawPack, eventModsFor, eventBattleRefs,
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

describe('2V2 事件期: the periods, targets and packs', () => {
  test('three events at the contest round / +4 / R13; a target may repeat and every selection deals one pack', () => {
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
    // 0.0.5: every mapped, living seat stays available every period (the one-target-per-match limit is gone)
    assert.deepEqual(m.eventAvailableTargets(p0), [...EVENT_TARGETS]);
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
    // a self pick deals the receiver (自己) one 我方包: 1 增益 + 2 中性, every entry at its BASE magnitude (no ×2)
    const rec = m.event.picks.get('p_0');
    assert.equal(rec.mag, 1);
    assert.equal(rec.packKind, 'own');
    assert.equal(rec.entries.length, EVENT_PACK_SIZE);
    assert.deepEqual(rec.entries.map((e) => e.kind), [...EVENT_PACK_KINDS.own]);
    assert.equal(rec.card, rec.entries[0].card, 'the summary card is the pack\'s distinctive first entry');
    assert.deepEqual(p0.eventEntries.map((e) => [e.card.id, e.mag]), rec.entries.map((e) => [e.card, 1]));
    assert.deepEqual(p0.eventMods, eventModsFor(p0.eventEntries, m.round), 'the mods are the pack\'s three entries at base values');
    // the pick is public: who gave whom, the pack's summary and its full entry list
    const pub2 = m.publicView();
    assert.equal(pub2.event.ally.picks.p_0.card, rec.card);
    assert.equal(pub2.event.ally.picks.p_0.targetId, 'p_0');
    assert.equal(pub2.event.ally.picks.p_0.packKind, 'own');
    assert.deepEqual(pub2.event.ally.picks.p_0.entries, rec.entries);
    // 0.0.5 公示数据: 本次事件谁被选了几次 (selected)、各收什么包 (packs)
    assert.deepEqual(pub2.event.ally.selected, { p_0: 1, ai_1: 0, ai_2: 0, ai_3: 0 });
    assert.equal(pub2.event.ally.packs.p_0.length, 1);
    assert.deepEqual(pub2.event.ally.packs.p_0[0].entries, rec.entries);
    assert.equal(pub2.event.ally.packs.p_0[0].from, 'p_0');
    assert.equal(pub2.event.ally.packs.p_0[0].target, 'self');
    const evFrame = h.lastBc('m.event');
    assert.ok(evFrame && evFrame.playerId === 'p_0' && evFrame.target === 'self' && evFrame.card === rec.card);
    assert.equal(evFrame.packKind, 'own');
    assert.deepEqual(evFrame.entries, rec.entries);

    toEvent(h, rounds[1]);
    assert.equal(m.event.index, 2);
    // 0.0.5: the same target may be picked again — only ONE pick per player per period is enforced
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'self' }), { ok: true });
    assert.equal(m.event.picks.has('p_0'), true);
    // unknown target: refused
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'nope' }), { error: ERR.BAD_TARGET });
    assert.notEqual(validateC2S({ t: 'g.event.pick', target: 'nope' }), null);
    assert.equal(validateC2S({ t: 'g.event.pick', target: 'mate' }), null);
    // a second pick in the same period is still refused
    assert.equal(m.handle('p_0', { t: 'g.event.pick', target: 'mate' }).error, ERR.ALREADY);

    toEvent(h, rounds[2]);
    assert.equal(m.event.index, 3);
    const ai2Before = h.ps('ai_2').eventEntries.length;
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'oppA' }), { ok: true });
    // an oppA pick deals the TARGET (the chosen opponent) one 对面包: 1 减益 + 2 中性
    const oppRec = m.event.picks.get('p_0');
    assert.equal(oppRec.packKind, 'opp');
    assert.deepEqual(oppRec.entries.map((e) => e.kind), [...EVENT_PACK_KINDS.opp]);
    assert.equal(oppRec.targetId, 'ai_2', 'the pack lands on the chosen opponent');
    assert.equal(h.ps('ai_2').eventEntries.length, ai2Before + EVENT_PACK_SIZE, 'the target received exactly one pack now');
    // let the bots take their picks and close the period
    assert.ok(h.run(() => m.phase !== PHASE.EVENT));

    // exactly three events, every entry archived, and no event period ever again
    assert.ok(recordsOf(m, 1).length > 0 && recordsOf(m, 2).length > 0 && recordsOf(m, 3).length > 0);
    for (const index of [1, 2, 3]) {
      for (const r of recordsOf(m, index)) {
        assert.ok(['own', 'opp', 'default'].includes(r.packKind), `row packKind ${r.packKind}`);
        assert.ok(r.pack >= 1 && r.slot >= 1 && r.slot <= EVENT_PACK_SIZE, '包序 / slot markers');
        assert.equal(r.mag, 1, 'no magnitude multiplier any more');
      }
    }
    assert.deepEqual(p0.eventTargets, ['self', 'self', 'oppA'], 'a target may repeat across periods');
    assert.equal(m.eventIndex, 3);
    p0.autoplay = true;
    const ok = h.drive(() => m.round >= 14 || h.ended != null);
    assert.ok(ok, 'reached R14');
    assert.equal(m.eventDue(), false);
    assert.equal(m.eventIndex, 3);

    // err code for a pick outside the phase
    if (h.ended == null) assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'oppB' }), { error: ERR.WRONG_PHASE });
  });

  test('the 发包规则: N selections → N packs (对面 + 我方 mixed), and the 默认包 floor for the unchosen', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 20261024, fake: true }).start();
    const m = h.m;
    toEvent(h, m.eventRounds[0]);
    // deterministic picks (before the bots' scheduled auto-picks run): ai_2 is selected TWICE (once per side — one
    // 对面包 + one 我方包), ai_1 is never selected and must get the 默认包 floor at the period's close.
    assert.deepEqual(m._eventPick(h.ps('p_0'), 'self'), { ok: true });      // → p_0  (我方包)
    assert.deepEqual(m._eventPick(h.ps('ai_1'), 'oppA'), { ok: true });     // → ai_2 (对面包)
    assert.deepEqual(m._eventPick(h.ps('ai_2'), 'mate'), { ok: true });     // → ai_3 (我方包)
    assert.deepEqual(m._eventPick(h.ps('ai_3'), 'mate'), { ok: true });     // → ai_2 (我方包, second pack)
    // every alive seat answered → the period closes at once (roster hold), the floor lands immediately
    assert.equal(m.event.done, true);
    const packs = m.event.packs;
    assert.equal(packs.get('ai_2').length, 2, '被选中 N 次 → N 个包');
    assert.deepEqual(packs.get('ai_2').map((p) => p.kind), ['opp', 'own'], '对面 + 我方混合被选 = 两类包都收');
    assert.equal(packs.get('ai_1').length, 1);
    assert.equal(packs.get('ai_1')[0].kind, 'default', '未被选中 → 1 个默认包');
    assert.equal(packs.get('ai_1')[0].entries.length, EVENT_PACK_SIZE, '默认包仍是 3 条');
    assert.equal(packs.get('ai_1')[0].from, null, 'a default pack has no picker');
    // 真·全局限一份 (维护者 2026-10-25): the four packs need 12 entries and the 中性 pool holds 7, so the last slots
    // borrow an UNUSED card of another kind instead of repeating a card — no card repeats inside the period
    const ids = [...packs.values()].flatMap((list) => list.flatMap((p) => p.entries.map((e) => e.card)));
    assert.equal(new Set(ids).size, ids.length, 'no card repeats while the 24-entry pool still has an unused one');
    // the entries all landed on the receiver
    for (const pid of ['p_0', 'ai_1', 'ai_2', 'ai_3']) {
      const total = packs.get(pid).reduce((n, p) => n + p.entries.length, 0);
      assert.equal(h.ps(pid).eventEntries.length, total, `${pid} received every entry of its packs`);
    }
    // the public 公示 data says exactly that
    const pub = m.publicView();
    assert.deepEqual(pub.event.ally.selected, { p_0: 1, ai_1: 0, ai_2: 2, ai_3: 1 });
    assert.equal(pub.event.ally.packs.ai_2.length, 2);
    assert.deepEqual(pub.event.ally.packs.ai_2.map((p) => p.entries.length), [EVENT_PACK_SIZE, EVENT_PACK_SIZE]);
    // the archived history is one row per entry, each with its pack marker
    const rows = recordsOf(m, 1);
    assert.equal(rows.length, 5 * EVENT_PACK_SIZE, '5 packs × 3 entries = 15 rows');
    assert.deepEqual(rows.filter((r) => r.packKind === 'default').map((r) => r.targetId), ['ai_1', 'ai_1', 'ai_1']);
    assert.deepEqual(rows.filter((r) => r.targetId === 'ai_2').map((r) => r.packKind), ['opp', 'opp', 'opp', 'own', 'own', 'own']);
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

  test('unified odds (0.0.5): one foe row for all periods, fixed pack shapes, kind-scoped no-repeat draws', () => {
    // the per-sequence tables are gone: EVENT_FOE_ODDS / EVENT_FOE_ELITE_SHARES are the single source
    assert.deepEqual(EVENT_FOE_ODDS, { favor: 25, mid: 40, unfavor: 35 });
    assert.deepEqual([...EVENT_FOE_ELITE_SHARES], [0.15, 0.20]);
    assert.deepEqual([...EVENT_PACK_KINDS.opp], ['down', 'mid', 'mid'], '对面包: 1 减益 + 2 中性');
    assert.deepEqual([...EVENT_PACK_KINDS.own], ['up', 'mid', 'mid'], '我方包: 1 增益 + 2 中性');
    assert.deepEqual([...EVENT_PACK_KINDS.default], ['mid', 'mid', 'mid'], '默认包: 3 中性');
    for (const kinds of Object.values(EVENT_PACK_KINDS)) assert.equal(kinds.length, EVENT_PACK_SIZE);
    // the monster kind draw follows the unified odds (seeded large sample)
    const rng = createRng(0x5eed2026);
    const n = 200000;
    const foe = { favor: 0, mid: 0, unfavor: 0 };
    for (let k = 0; k < n; k++) foe[eventFoeKindOf(rng)]++;
    for (const kind of ['favor', 'mid', 'unfavor']) {
      assert.ok(Math.abs(foe[kind] / n - EVENT_FOE_ODDS[kind] / 100) < 0.005, `foe ${kind}`);
    }
    // monster-channel EV: exactly −0.10 in every period now
    assert.ok(Math.abs(eventFoeEv() + 0.10) < 1e-12);
  });

  test('the card draw: no repeat while the 24-entry pool has an unused card; an exhausted kind borrows another kind (match-global bag)', () => {
    const downIds = EVENT_CARDS.filter((c) => c.kind === 'down').map((c) => c.id).sort((a, b) => a - b);
    assert.equal(downIds.length, 5, 'the down pool');
    assert.equal(EVENT_CARDS.length, 24, 'the 24-entry pool');
    const used = new Set();
    const draws = [];
    const rng = createRng(0xc0ffee);
    for (let i = 0; i < 30; i++) {
      const c = eventDrawAlly(rng, 'down', used);
      assert.ok(c, 'a draw always resolves');
      used.add(c.id);
      draws.push(c);
    }
    assert.deepEqual([...new Set(draws.slice(0, 5).map((c) => c.id))].sort((a, b) => a - b), downIds,
      'the first draws cover the kind pool with no repeats');
    // 维护者 2026-10-25「真·全局限一份」: an exhausted kind borrows an UNUSED card of another kind instead of repeating
    assert.equal(new Set(draws.slice(0, 24).map((c) => c.id)).size, 24, 'the whole pool is spent before anything repeats');
    assert.equal(used.size, 24);
    assert.ok(!draws.slice(5, 24).some((c) => c.kind === 'down'), 'a borrowed slot leaves the exhausted kind');
    // only once all 24 are used does a draw repeat, and a repeat stays inside the requested kind
    assert.ok(draws.slice(24).every((c) => c.kind === 'down'), 'an exhausted pool repeats within the requested kind');
    assert.ok(draws.slice(24).every((c) => used.has(c.id)), 'a repeat only ever draws an already-used card');
    // a kind that still has unused cards never leaves it
    const fresh = new Set();
    for (let i = 0; i < 3; i++) assert.equal(eventDrawAlly(createRng(9 + i), 'up', fresh).kind, 'up');
    // a pack marks every card it draws and keeps the composition order (distinctive card first)
    const usedPack = new Set();
    const pack = eventDrawPack(createRng(7), 'opp', usedPack);
    assert.equal(pack.length, EVENT_PACK_SIZE);
    assert.deepEqual(pack.map((c) => c.kind), [...EVENT_PACK_KINDS.opp]);
    assert.equal(usedPack.size, EVENT_PACK_SIZE);
  });

  test('every entry applies at its BASE magnitude (the 自己 ×2 multiplier is gone)', () => {
    // the calibrated values themselves (×1.5 magnitudes, no target multiplier any more)
    assert.ok(Math.abs(eventModsFor([{ card: C('whetstone') }]).atkPct - 0.20) < 1e-12);
    assert.ok(Math.abs(eventModsFor([{ card: C('bloodstain') }]).dmgTakenMul - 1.12) < 1e-12);
    assert.ok(Math.abs(eventModsFor([{ card: C('mired') }]).enemySpeedMul - 1.22) < 1e-12);
    assert.ok(Math.abs(eventModsFor([{ card: C('burden_armor') }]).moveMul - 0.85) < 1e-12);
    assert.ok(Math.abs(eventModsFor([{ card: C('breath_swap') }]).spRecoveryMul - 1.22) < 1e-12);
    // stacking two copies still multiplies in the environment bucket (1.20 × 1.20), never doubles the bonus
    const twice = eventModsFor([{ card: C('whetstone') }, { card: C('whetstone') }]);
    assert.ok(Math.abs(twice.atkPct - 0.40) < 1e-12, 'the additive part adds up');
    assert.ok(Math.abs(eventModsFor([{ card: C('mired') }, { card: C('mired') }]).enemySpeedMul - 1.22 * 1.22) < 1e-12);
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

  test('猎人佣金 / 空手而归: +3 / −2 gold each round at BASE magnitude (no target multiplier)', () => {
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

    // two received copies stack additively (+6) — there is no "选自己 ×2" any more, only more packs
    ps.eventEntries = [{ card: C('hunter_commission'), mag: 1 }, { card: C('hunter_commission'), mag: 1 }];
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
    // never in the player's mods (only the ally PACK's entries land there)
    assert.equal(p0.eventEntries.length, EVENT_PACK_SIZE);
    for (const e of p0.eventEntries) {
      assert.ok(['output', 'survival', 'sp', 'economy'].includes(e.card.class), `ally class ${e.card.class}`);
      assert.equal(Object.hasOwn(e.card, 'hpMul'), false, 'a monster entry never reaches a player\'s mods');
    }

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

  test('the monster pool: 4 classes × 3 (favor / mid / unfavor), unified 25/40/35 draws, EV −0.10, no repeats', () => {
    assert.equal(EVENT_FOE_CARDS.length, 12);
    for (const cls of ['attack', 'survival', 'speed', 'count']) {
      const list = EVENT_FOE_CARDS.filter((c) => c.class === cls);
      assert.equal(list.length, 3, cls);
      assert.deepEqual(list.map((c) => c.kind).sort(), ['favor', 'mid', 'unfavor'], cls);
    }
    assert.deepEqual(EVENT_FOE_ODDS, { favor: 25, mid: 40, unfavor: 35 });
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
      const want = EVENT_FOE_ODDS[kind] / 100;
      assert.ok(Math.abs(count[kind] / n - want) < 0.005, `${kind}: ${count[kind] / n} vs ${want}`);
    }
    // three periods → three distinct monster entries (the monster pool never repeats inside one match)
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: botSeats(), seed: 23, fake: true }).start();
    const m = h.m;
    assert.ok(h.run(() => m.round >= 14 || h.ended != null, { maxSteps: 3e6 }));
    assert.equal(m.eventFoeHistory.length, 3);
    assert.equal(new Set(m.eventFoeHistory.map((r) => r.card)).size, 3);
    // 0.0.5 重复规则: a card repeats only after its KIND's pool is exhausted (the used bag is match-global)
    assert.ok(m.eventUsedAlly.size <= EVENT_CARDS.length);
    const drawnByKind = { down: [], mid: [], up: [] };
    for (const r of m.eventHistory) drawnByKind[r.kind].push(r.card);
    for (const kind of ['down', 'mid', 'up']) {
      const pool = EVENT_CARDS.filter((c) => c.kind === kind);
      const ids = drawnByKind[kind];
      const distinct = new Set(ids);
      assert.ok([...distinct].every((id) => pool.some((c) => c.id === id)), `${kind}: never borrows another kind's card`);
      if (ids.length > distinct.size) {
        assert.equal(distinct.size, pool.length, `${kind}: repeats only after its ${pool.length}-card pool is exhausted`);
      }
    }
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

  test('the 强力属性 subset: unified 15 %~20 % share, count formula, 赏金怪 included but never repriced', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 31, fake: true }).start();
    toEvent(h, h.m.eventRounds[0]);
    const m = h.m;
    const elite = m.foeEvent.elite;
    assert.ok(EVENT_FOE_ELITE_SHARES.includes(elite.share), `E1 share ${elite.share}`);
    assert.ok(EVENT_FOE_ELITES.some((a) => a.key === elite.attr), `attr ${elite.attr}`);
    assert.ok(elite.share >= 0.15 && elite.share <= 0.20, 'the unified 15 %~20 % range in every period');
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
    assert.equal(eventModsFor([entry, entry], 8).goldPerRound, -4, 'two received copies stack (no target multiplier any more)');
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

  test('a one-round economic entry lands immediately: 空手而归 −2 is applied once at pick time, not as a per-round window', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 77, fake: true }).start();
    const m = h.m;
    toEvent(h, m.eventRounds[0]);
    const target = h.ps('ai_2'); // a 对面包 lands on the chosen opponent
    // force the roll: the down slot's only unused card is 空手而归 (a 对面包 draws its 减益 first)
    for (const c of EVENT_CARDS) if (c.kind === 'down' && c.id !== 23) m.eventUsedAlly.add(c.id);
    m.rngEvent = () => 0.01;
    target.funds = 10;
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'oppA' }), { ok: true });
    const rec = m.event.picks.get('p_0');
    assert.equal(rec.packKind, 'opp');
    assert.equal(rec.entries[0].key, 'empty_handed', 'the forced roll drew 空手而归 as the pack\'s 减益');
    // the round's income was settled BEFORE the event period, so the −2 is applied at pick time — once (no ×2 any more)
    assert.equal(target.funds, 8, '−2 gold applied once, right now');
    assert.equal(target.eventMods.goldPerRound, -2, 'the window still carries it for the battle/refs side');
    // R+1 must NOT deduct again (duration 1): base income only
    target.funds = 0;
    target.startRound(m.eventRounds[0] + 1);
    assert.equal(target.funds, target.gd.income(m.eventRounds[0] + 1), 'no second deduction at the next round');
  });

  test('the published history carries the card-specific duration (经济负面 = 1, not 4)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 78, fake: true }).start();
    const m = h.m;
    toEvent(h, m.eventRounds[0]);
    for (const c of EVENT_CARDS) if (c.kind === 'down' && c.id !== 23) m.eventUsedAlly.add(c.id);
    m.rngEvent = () => 0.01;
    assert.deepEqual(m.handle('p_0', { t: 'g.event.pick', target: 'oppA' }), { ok: true });
    assert.equal(m.event.picks.get('p_0').entries[0].key, 'empty_handed');
    // everyone else is picked by the timeout, then the roster hold archives the history
    h.run(() => m.phase !== PHASE.EVENT || h.ended != null, { maxSteps: 3e6 });
    const rec = m.eventHistory.find((r) => r.key === 'empty_handed');
    assert.ok(rec, 'the entry row is archived');
    assert.equal(rec.duration, 1, 'the published duration is the card\'s, not the 4-round default');
    assert.equal(eventCardDuration(C(rec.key)), 1);
    const view = m.eventView();
    const pubRec = view.ally.history.find((r) => r.key === 'empty_handed');
    assert.equal(pubRec.duration, 1, 'm.public carries it too');
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
    // one history row per ENTRY (3 per pack); every seat was selected, so there are no default packs here
    assert.equal(pub.event.ally.history.length, EVENT_PACK_SIZE * m.alivePlayers().length, 'the full record is still public');
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
    assert.equal(pub.event.ally.history.length, EVENT_PACK_SIZE * m.alivePlayers().length, 'every entry is archived');
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
    assert.equal(pub.event.ally.history.length, EVENT_PACK_SIZE * m.alivePlayers().length);
    assert.ok(pub.event.ally.history.some((r) => r.playerId === 'p_0' && r.auto === true), 'the AI fill is public');
    h.sched.advance(4999);
    assert.equal(m.phase, PHASE.EVENT);
    h.sched.advance(1);
    assert.notEqual(m.phase, PHASE.EVENT);
  });
});

describe('2V2 事件期: AI, timeout and server authority', () => {
  test('AI seats roll their side (EVENT_AI_OPP_CHANCE), then spread over that side\'s un-chosen seats (0.0.5; 超时同 AI)', () => {
    assert.equal(EVENT_AI_OPP_CHANCE, 60, '60 % 对面 / 40 % 我方');
    const seats = () => ['p_0', 'p_1', 'p_2', 'p_3'].map((id) => h.ps(id));
    // a roll under the chance aims at the opposing side: four bots, two per team, spread over the OTHER team's seats
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: botSeats(), seed: 11, fake: true }).start();
    const m = h.m;
    toEvent(h, m.eventRounds[0]);
    m.rngEventTarget = () => 0.01;
    const ps = seats();
    assert.equal(m.botEventTarget(ps[0]), 'oppA', 'first: an un-chosen 对面 seat');
    assert.deepEqual(m._eventPick(ps[0], 'oppA'), { ok: true });
    assert.equal(m.botEventTarget(ps[1]), 'oppB', 'the second bot spreads to the other 对面 seat');
    assert.deepEqual(m._eventPick(ps[1], 'oppB'), { ok: true });
    assert.equal(m.botEventTarget(ps[2]), 'oppA', 'the other team targets ITS own opponents');
    assert.deepEqual(m._eventPick(ps[2], 'oppA'), { ok: true });
    assert.equal(m.botEventTarget(ps[3]), 'oppB');
    assert.deepEqual(m._eventPick(ps[3], 'oppB'), { ok: true });
    // every 对面 seat is taken this round → the fallback is 自己 (mate is never a bot's choice)
    assert.equal(m.botEventTarget(ps[0]), 'self');
    // the four picks dealt four 对面包 (1 减益 + 2 中性 each) — one per selection, no discount for bots
    for (const p of ps) {
      const rec = [...m.event.picks.values()].find((r) => r.targetId === p.playerId);
      assert.equal(rec.packKind, 'opp', `${p.playerId} got a 对面包`);
    }
    // a roll over the chance aims at its OWN side: an all-AI period then draws the 增益 pool (the 0.0.5 退化 fix)
    const h2 = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: botSeats(), seed: 12, fake: true }).start();
    const m2 = h2.m;
    toEvent(h2, m2.eventRounds[0]);
    m2.rngEventTarget = () => 0.99;
    for (const p of m2.alivePlayers()) {
      assert.equal(m2.botEventTarget(p), 'self', `${p.playerId} rolls its own side`);
      assert.deepEqual(m2._eventPick(p, 'self'), { ok: true });
    }
    const kinds = new Set([...m2.event.picks.values()].map((r) => r.packKind));
    assert.deepEqual([...kinds], ['own'], 'every pack of the period is a 我方包');
    const upIds = new Set(EVENT_CARDS.filter((c) => c.kind === 'up').map((c) => c.id));
    assert.ok([...m2.event.picks.values()].every((r) => upIds.has(r.card)), 'the 增益 pool is drawn, not never-seen');
  });

  test('a full bot match runs all three periods without stalling (unified elite share in each)', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: botSeats(), seed: 11, fake: true }).start();
    const m = h.m;
    const ok = h.run(() => m.round >= 14 || h.ended != null, { maxSteps: 3e6 });
    assert.ok(ok);
    // three periods ran (each event index has entries for every seat still alive at that time)
    assert.equal(new Set(m.eventHistory.map((r) => r.index)).size, 3);
    for (const index of [1, 2, 3]) {
      const recs = recordsOf(m, index);
      assert.ok(recs.length > 0, `event #${index} has entries`);
      // the 强力属性 share range is the unified one in every period
      const foeRec = m.eventFoeHistory.find((x) => x.index === index);
      assert.ok(foeRec && EVENT_FOE_ELITE_SHARES.includes(foeRec.elite.share), `E${index} elite share`);
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
