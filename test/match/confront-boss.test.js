// test/match/confront-boss.test.js — 2V2 事件期 boss 格 (user 2026-10-21): on the 事件期 rounds (match.eventRounds =
// E1 / E2 / R13 — the R4 / R8 / R13 of a R4 start) the 狩猎期 panel adds a 5th slot offering the whole 机变悬赏 monster
// pool (data/choices.json `bountyDrafts`: every drafted card's enemyKey + its adds[].enemyKey, ~81 monsters), each
// priced at the HIGHEST coin tier its cards ever give it. The bosses are thrown at the opponent like any pick but enter
// AFTER every spawn, cost no budget, count against no maxPicks, one pick per monster per submission; killing one pays
// the pool coin DIRECTLY as gold (economy.js addCoins → pendingFunds), never the 坎诺特 赏金 bank. Bots never use the
// slot (botConfront stays deterministic), and 同盟狩猎 never gains one.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { FakeBattle } from './fakeBattle.js';
import { PHASE, ERR, VERSUS_CONFRONT } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { confrontBossCoins } from '../../server/match/match/confront.js';
import { specBounds } from '../../server/match/fields.js';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const vsSeats = () => ([
  { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
  { seat: 1, playerId: 'ai_1', name: 'A1', isBot: true, connected: true, team: 0 },
  { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
  { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
]);

/** A versus match driven into the 事件期 对抗期's step 2 — p_0 aims at ai_2 and may submit freely. */
const hunt = (seed) => {
  const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed, fake: true }).start();
  const m = h.m;
  assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 对抗期');
  assert.ok(m.confrontBossOpen(), 'the first 对抗期 is an 事件期 round (E1 = the contest round)');
  assert.equal(m.submitConfrontTarget(m.players.get('p_0'), { targetPlayerId: 'ai_2' }).ok, true);
  assert.equal(m.confrontStage, 'monster', 'step 2 opened');
  return h;
};

/** A plain wave of `n` identical monsters (the same shape test/match/versus.test.js feeds applyConfront). */
const plain = (n) => Array.from({ length: n }, (_, i) => ({ time: i, enemyKey: 'enemy_1005_yokai', count: 1, routeIndex: 0, interval: 0 }));

describe('2V2 事件期 boss 格: bossPool', () => {
  test('the 机变悬赏 pool is complete, resolvable and priced at the HIGHEST coin tier', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 7, fake: true }).start();
    const m = h.m;
    const pool = m.confrontBossPool();
    assert.ok(pool.length >= 60, `the pool holds ~81 monsters (got ${pool.length})`);
    assert.equal(new Set(pool.map((r) => r.key)).size, pool.length, 'no duplicate enemyKeys');
    for (const r of pool) {
      const e = m.gd.enemy(r.key);
      assert.ok(e, `${r.key} resolves through gd.enemy`);
      assert.equal(r.name, (e && e.name) || r.key, `${r.key} shows the enemy name`);
      // the highest tier the cards give it — an integer; the few 0-coin cards (e.g. enemyeffect_5_1) price 0 and pay 0
      assert.ok(Number.isInteger(r.coin) && r.coin >= 0, `${r.key} carries an integer coin (got ${r.coin})`);
    }
    assert.ok(pool.filter((r) => r.coin > 0).length >= 60, 'nearly every pool monster pays at least 1');
    // the pure table and the match method agree (membership = the drafted cards' enemyKey + adds[].enemyKey)
    const coins = confrontBossCoins(DATA.choices);
    assert.equal(coins.size, pool.length);
    for (const r of pool) assert.equal(coins.get(r.key), r.coin, `${r.key} coin`);
    // multi-tier monsters pay their TOP tier: enemy_1299_ymkilr appears at 1 / 2 / 3 across the cards → 3
    assert.equal(coins.get('enemy_1299_ymkilr'), 3, 'a 1/2/3-tier monster pays the highest tier');
    assert.equal(m.confrontBossCoin('enemy_1299_ymkilr'), 3);
    const outside = Object.keys(DATA.enemies).find((k) => !coins.has(k));
    assert.equal(m.confrontBossCoin(outside), 0, 'a monster outside the pool prices 0');
    // exactly the multi-tier cases the rule names (≥ 8 today): every one pays its own maximum
    const tiers = new Map();
    for (const c of DATA.choices.cards.bounty) {
      for (const occ of [c, ...(c.adds || [])]) {
        if (!coins.has(occ.enemyKey)) continue;
        if (!tiers.has(occ.enemyKey)) tiers.set(occ.enemyKey, new Set());
        tiers.get(occ.enemyKey).add(Math.trunc(Number(occ.coin) || 0));
      }
    }
    const multi = [...tiers.entries()].filter(([, s]) => s.size > 1);
    assert.ok(multi.length >= 4, `${multi.length} multi-tier monsters`);
    for (const [key, s] of multi) assert.equal(coins.get(key), Math.max(...s), `${key} pays its top tier`);
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    m.dispose();
  });

  test('bossPool rides on m.public.confront only on the 事件期 rounds; co-op / solo never gain a boss 格', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 3, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 对抗期');
    assert.ok(m.eventRounds.includes(m.round), 'the first 对抗期 IS an 事件期 round');
    const view = m._teamPublicView(m.publicView(), 0).confront;
    assert.ok(Array.isArray(view.bossPool) && view.bossPool.length >= 60, 'the event round offers the pool');
    for (const r of view.bossPool) assert.ok(typeof r.name === 'string' && Number.isInteger(r.coin), JSON.stringify(r));
    // a NON-event 对抗期 round: the slot does not exist at all
    assert.equal(m.submitConfrontTarget(m.players.get('p_0'), { targetPlayerId: 'ai_2' }).ok, true);
    assert.equal(m.submitConfront(m.players.get('p_0'), { group: 1, position: 'mid', picks: [] }).ok, true, 'p_0 closes the round');
    const played = m.round;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target' && m.round > played, { maxSteps: 3e6 }), 'reached the next 对抗期');
    assert.equal(m.confrontBossOpen(), false, `R${m.round} is not an 事件期 round`);
    assert.equal(m.publicView().confront.bossPool, null, 'no bossPool outside the 事件期 rounds');
    // …and a submission cannot smuggle one in
    assert.equal(m.submitConfrontTarget(m.players.get('p_0'), { targetPlayerId: 'ai_2' }).ok, true);
    const key = m.confrontBossPool()[0].key;
    assert.equal(m.submitConfront(m.players.get('p_0'), { group: 1, position: 'mid', picks: [], bosses: [{ enemyKey: key }] }).error, ERR.BAD_TARGET, 'a boss outside the 事件期 is refused');
    // 同盟狩猎 / solo: no boss slot anywhere (isVersus only)
    const coop = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 2, seed: 3, fake: true }).start();
    const solo = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 3, fake: true }).start();
    for (const x of [coop, solo]) {
      assert.equal(x.m.isVersus, false);
      assert.equal(x.m.confrontBossOpen(), false);
      x.m.dispose();
    }
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    m.dispose();
  });
});

describe('2V2 事件期 boss 格: 提交校验', () => {
  test('repeats / out-of-pool / oversized boss lists are refused; a boss-only submission is legal', () => {
    const h = hunt(11);
    const m = h.m;
    const me = m.players.get('p_0');
    const pool = m.confrontBossPool();
    const [a, b] = pool;
    // a monster outside the 机变悬赏 pool (and an unknown key) is malformed → BAD_TARGET
    const outside = Object.keys(DATA.enemies).find((k) => !pool.some((r) => r.key === k));
    assert.equal(m.submitConfront(me, { group: 1, position: 'mid', picks: [], bosses: [{ enemyKey: outside }] }).error, ERR.BAD_TARGET);
    assert.equal(m.submitConfront(me, { group: 1, position: 'mid', picks: [], bosses: [{ enemyKey: 'enemy_does_not_exist' }] }).error, ERR.BAD_TARGET);
    // the same monster twice in ONE submission: one pick per option per round ([ASSUMED] ERR.CONFRONT_COUNT)
    assert.equal(m.submitConfront(me, { group: 1, position: 'mid', picks: [], bosses: [{ enemyKey: a.key }, { enemyKey: a.key }] }).error, ERR.CONFRONT_COUNT);
    // more than the protocol / server cap (32): its own count code, even with valid distinct monsters
    const many = pool.slice(0, VERSUS_CONFRONT.maxBosses + 1).map((r) => ({ enemyKey: r.key }));
    assert.equal(m.submitConfront(me, { group: 1, position: 'mid', picks: [], bosses: many }).error, ERR.CONFRONT_COUNT);
    assert.equal(m.confrontSubs.has('p_0'), false, 'nothing was stored');
    // only bosses, no picks at all: legal and free of budget / maxPicks (gate defaults to lower, 'upper' normalises)
    assert.equal(m.submitConfront(me, { group: 1, position: 'mid', picks: [], bosses: [{ enemyKey: a.key, gate: 'upper' }, { enemyKey: b.key }] }).ok, true);
    const sub = m.confrontSubs.get('p_0');
    assert.deepEqual(sub.picks, [], 'no picks');
    assert.deepEqual(sub.bosses, [{ enemyKey: a.key, gate: 'upper' }, { enemyKey: b.key, gate: 'lower' }], 'gate 归一化 upper/lower, 缺省 lower');
    assert.equal(m.confrontSpent(sub.picks), 0, 'the boss 格 spends no budget');
    assert.ok(m.confrontSpent(sub.picks) <= m.confrontBudget());
    // bosses do not count toward maxPicks: 64 picks + 32 bosses is refused for the BUDGET (not the count)
    const h2 = hunt(13);
    const me2 = h2.m.players.get('p_0');
    const cheapest = h2.m.confrontGroups().flatMap((g) => g.rows).sort((x, y) => x.value - y.value)[0];
    const full = Array.from({ length: VERSUS_CONFRONT.maxPicks }, (_, i) => ({ enemyKey: cheapest.key, gate: i % 2 ? 'upper' : 'lower' }));
    const fullBosses = h2.m.confrontBossPool().slice(0, VERSUS_CONFRONT.maxBosses).map((r) => ({ enemyKey: r.key }));
    assert.ok(h2.m.confrontSpent(full) > h2.m.confrontBudget(), '64 monsters are over the budget');
    assert.equal(h2.m.submitConfront(me2, { group: 1, position: 'mid', picks: full, bosses: fullBosses }).error, ERR.CONFRONT_BUDGET, 'the count caps stay separate');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    h2.m.dispose();
    m.dispose();
  });

  test('picks + bosses mix in ONE submission and the picks keep their full budget', () => {
    const h = hunt(17);
    const m = h.m;
    const me = m.players.get('p_0');
    const row = m.confrontGroups().flatMap((g) => g.rows).sort((a, b) => b.value - a.value)[0];
    // as many of the dearest monsters as the budget holds — then bosses on top, still accepted
    const picks = [];
    let left = m.confrontBudget();
    for (const r of m.confrontGroups().flatMap((g) => g.rows).sort((a, b) => b.value - a.value)) {
      if (r.value > left) continue;
      left -= r.value;
      picks.push({ enemyKey: r.key, gate: 'lower' });
    }
    assert.ok(picks.length > 0, `the budget fills (${row.key})`);
    const bosses = m.confrontBossPool().slice(0, 2).map((r) => ({ enemyKey: r.key }));
    assert.equal(m.submitConfront(me, { group: 1, position: 'mid', picks, bosses }).ok, true);
    const sub = m.confrontSubs.get('p_0');
    assert.deepEqual(sub.picks, picks.map((p) => ({ enemyKey: p.enemyKey, gate: 'lower' })), 'the picks ride along');
    assert.deepEqual(sub.bosses, bosses.map((p) => ({ enemyKey: p.enemyKey, gate: 'lower' })), 'and so do the bosses');
    assert.equal(m.confrontSpent(sub.picks), m.confrontBudget() - left, 'the budget counts picks only');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    m.dispose();
  });

  test('the protocol: bosses is optional (old clients), bounds 32 and validates like picks', () => {
    // an old client never sends the field — and must keep working
    assert.equal(validateC2S({ t: 'g.confront', group: 1, position: 'mid', picks: [] }), null);
    assert.equal(validateC2S({ t: 'g.confront', group: 1, position: 'mid', picks: [{ enemyKey: 'enemy_1005_yokai', gate: 'lower' }] }), null);
    assert.equal(validateC2S({ t: 'g.confront', group: 1, position: 'mid', picks: [], bosses: [] }), null, 'an empty list is fine');
    assert.equal(validateC2S({ t: 'g.confront', group: 1, position: 'mid', picks: [], bosses: [{ enemyKey: 'enemy_1005_yokai' }, { enemyKey: 'enemy_1005_yokai', gate: 'upper' }] }), null, 'the server owns the pool / repeat rules');
    const ok = Array.from({ length: 32 }, (_, i) => ({ enemyKey: `enemy_${i}` }));
    assert.equal(validateC2S({ t: 'g.confront', group: 1, position: 'mid', picks: [], bosses: ok }), null, '32 is the cap');
    for (const bad of [
      [...ok, { enemyKey: 'enemy_32' }],                 // 33 > 32
      [{ enemyKey: 'enemy_1', gate: 'mid' }],            // illegal gate
      [{ gate: 'lower' }],                               // no enemyKey
      ['enemy_1'],                                       // not a plain object
      [{ enemyKey: '' }],                                // not an id
    ]) {
      assert.notEqual(validateC2S({ t: 'g.confront', group: 1, position: 'mid', picks: [], bosses: bad }), null, JSON.stringify(bad).slice(0, 60));
    }
  });
});

describe('2V2 事件期 boss 格: 入场与结算', () => {
  test('a boss enters after every other spawn and pays the pool coin — the picks keep their banked 赏金', () => {
    const h = hunt(19);
    const m = h.m;
    const me = m.players.get('p_0');
    const target = m.players.get('ai_2');
    const picks = [];
    let left = m.confrontBudget();
    for (const r of m.confrontGroups().flatMap((g) => g.rows).sort((a, b) => a.value - b.value)) {
      if (r.value > left) continue;
      left -= r.value;
      picks.push({ enemyKey: r.key, gate: 'lower' });
    }
    const [a, b] = m.confrontBossPool();
    assert.equal(m.submitConfront(me, { group: 1, position: 'mid', picks, bosses: [{ enemyKey: a.key }, { enemyKey: b.key, gate: 'upper' }] }).ok, true);
    const sub = m.confrontSubs.get('p_0');
    const wave = m.applyConfront(plain(20), sub, target);
    const bosses = wave.filter((s) => s.bounty && s.bounty.bank === false);
    assert.equal(bosses.length, 2, 'both bosses landed');
    const others = wave.filter((s) => !bosses.includes(s));
    const maxOther = Math.max(...others.map((s) => Number(s.time) || 0));
    for (const s of bosses) {
      assert.ok(Number(s.time) > maxOther, `boss ${s.enemyKey} at t=${s.time} enters after every spawn (≤ ${maxOther})`);
      assert.equal(s.count, 1);
      assert.equal(s.countInTotal, false, 'a leaked boss costs no 目标生命值');
      assert.equal(s.ownerPlayerId, target.playerId);
      assert.equal(s.confrontSeat, sub.seat, 'the sender seat rides along (display only)');
      assert.ok(Number.isInteger(s.routeIndex) && s.routeIndex >= 0, 'the route follows the gate / movement class');
      assert.equal(s.bounty.ownerPlayerId, target.playerId);
      assert.equal(s.bounty.bank, false, 'a boss bounty is GOLD, never 坎诺特 赏金');
      assert.equal(s.bounty.coins, m.confrontBossCoin(s.enemyKey), 'the pool\'s highest tier');
      assert.equal(s.bounty.total, undefined, 'bosses carry no batch total / index');
      assert.equal(s.bounty.index, undefined);
    }
    assert.deepEqual(bosses.map((s) => s.enemyKey), [a.key, b.key], 'submission order');
    assert.deepEqual(bosses.map((s) => s.time), [maxOther + 10, maxOther + 11], '[ASSUMED] max(time) + 10, +1 each');
    // the normal picks' semantics are untouched: banked 赏金, per-kill plan, batch total
    const placed = wave.filter((s) => s.bounty && s.bounty.bank === true);
    assert.equal(placed.length, sub.picks.length, 'every pick landed');
    assert.deepEqual(placed.map((s) => s.bounty.coins), m.confrontBountyPlan(sub.picks), 'the per-kill plan rides on the spawn');
    assert.ok(placed.every((s) => s.bounty.total === sub.picks.length), 'the batch denominator counts picks only');
    // the anti-cheat bounds see exactly the same split (gold = the bosses, bank = the picks)
    const B = specBounds({ spawns: wave }, m.gd);
    assert.equal(B.goldCoins, bosses.reduce((n, s) => n + s.bounty.coins, 0), 'the boss coins may only be gold');
    assert.equal(B.bankCoins, placed.reduce((n, s) => n + s.bounty.coins, 0), 'and the picks may only be banked');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    m.dispose();
  });

  test('a boss-only placement replaces nothing: the original wave stays and the bosses append', () => {
    const h = hunt(23);
    const m = h.m;
    const me = m.players.get('p_0');
    const target = m.players.get('ai_2');
    const [a] = m.confrontBossPool();
    assert.equal(m.submitConfront(me, { group: 1, position: 'mid', picks: [], bosses: [{ enemyKey: a.key }] }).ok, true);
    const sub = m.confrontSubs.get('p_0');
    const wave = m.applyConfront(plain(5), sub, target);
    assert.equal(wave.length, 6, '5 originals + 1 boss');
    assert.deepEqual(wave.slice(0, 5).map((s) => s.enemyKey), Array(5).fill('enemy_1005_yokai'), 'no original was dropped');
    assert.deepEqual(wave.slice(0, 5).map((s) => s.time), [0, 1, 2, 3, 4], 'nor re-timed');
    assert.equal(wave[5].enemyKey, a.key);
    assert.equal(wave[5].time, 14, '[ASSUMED] the boss waits for the last spawn (4) + 10');
    assert.equal(wave[5].countInTotal, false);
    assert.equal(wave[5].bounty.bank, false);
    assert.equal(wave[5].bounty.coins, m.confrontBossCoin(a.key));
    // an empty submission (no picks, no bosses) changes nothing at all
    assert.equal(m.applyConfront(plain(5), { ...sub, bosses: [] }, target).length, 5);
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    m.dispose();
  });

  test('a killed boss becomes GOLD (pendingFunds), never 坎诺特 赏金 (bountyBank) — sim + settle', () => {
    const h = hunt(29);
    const m = h.m;
    const me = m.players.get('p_0');
    const target = m.players.get('ai_2');
    // one ground boss from the pool that really pays (the route / motion is not what this test is about)
    const row = m.confrontBossPool().find((r) => r.coin > 0 && m.gd.enemy(r.key) && !m.gd.enemy(r.key).isFlyEnemy);
    assert.ok(row, 'the pool holds a ground monster');
    assert.equal(m.submitConfront(me, { group: 1, position: 'mid', picks: [], bosses: [{ enemyKey: row.key }] }).ok, true);
    const sub = m.confrontSubs.get('p_0');
    const wave = m.applyConfront(plain(10), sub, target);
    const spawn = wave.find((s) => s.bounty && s.bounty.bank === false);
    assert.ok(spawn, 'the boss spawn is in the wave');
    const coin = spawn.bounty.coins;
    assert.equal(coin, m.confrontBossCoin(row.key), 'the pool coin');
    // the sim pays that bounty as GOLD: the applied spawn in a real battle, killed once
    const bh = makeBattle({
      stageId: 'flat', content: 'none', autoFinish: false, timeLimit: 60,
      players: [{ playerId: target.playerId, seat: 0, side: 'L', colOffset: 0, units: [], bonds: {} }],
      defs: { enemies: { [spawn.enemyKey]: enemyRec({ key: spawn.enemyKey, hp: 100, speed: 0 }) } },
      enemies: [{ key: spawn.enemyKey, time: 0, route: 0, ownerPlayerId: spawn.ownerPlayerId, bounty: spawn.bounty, tag: 'bounty', countInTotal: spawn.countInTotal }],
    });
    bh.step();
    for (const e of bh.b.enemies.filter((x) => x.alive)) bh.b.kill(e, null);
    const p = bh.result().perPlayer[target.playerId];
    assert.equal(p.coins, coin, 'the pool coin is gold (economy.js addCoins)');
    assert.equal(p.bank, 0, 'and nothing is banked at 坎诺特');
    checkInvariants(bh.b);
    assert.equal(bh.b.errors.length, 0, JSON.stringify(bh.b.errors[0]));
    // the settle path: the battle's coins reach the next prep's funds (pendingFunds), never bountyBank
    FakeBattle.script = () => ({ coins: { [target.playerId]: coin }, bank: {} });
    assert.ok(h.drive(() => m.phase === PHASE.SETTLE && m.round === m.contestStartRound, { maxSteps: 3e6 }), 'settled the 事件期 round');
    const ps = h.ps(target.playerId);
    assert.ok(ps.pendingFunds >= coin, `the gold reached pendingFunds (${ps.pendingFunds} ≥ ${coin})`);
    assert.equal(ps.bountyBank, 0, 'the 坎诺特 赏金 bank stayed empty');
    FakeBattle.script = null;
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    m.dispose();
  });

  test('botConfront never touches the boss 格 (deterministic), yet a human submission is accepted', () => {
    const h = hunt(31);
    const m = h.m;
    // the bots already submitted at step 2's opening (botConfront) — and never with a boss
    for (const [pid, s] of m.confrontSubs) {
      if (!m.players.get(pid).botControlled) continue;
      assert.deepEqual(s.bosses, [], `${pid} submitted no boss`);
      assert.ok(Array.isArray(s.picks), `${pid} keeps its normal picks`);
    }
    // a human submitting a boss is accepted in the very same round
    const [a] = m.confrontBossPool();
    assert.equal(m.submitConfront(m.players.get('p_0'), { group: 1, position: 'mid', picks: [], bosses: [{ enemyKey: a.key }] }).ok, true);
    assert.equal(m.confrontSubs.get('p_0').bosses.length, 1);
    // and no bot auto-fill ever carries one (the window's end auto-submit is botConfront too)
    assert.ok(h.drive(() => m.phase === PHASE.COMBAT, { maxSteps: 3e6 }), 'the round ran');
    for (const s of m.confront.values()) {
      assert.deepEqual(s.bosses || [], s === m.confront.get('p_0') ? [{ enemyKey: a.key, gate: 'lower' }] : [], 'only the human holds a boss');
    }
    assert.deepEqual(h.logs.error, [], 'no engine errors');
    m.dispose();
  });
});
