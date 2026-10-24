// test/match/duck-spawns.test.js — 0.0.5 需求 3 (鸭爵特殊怪): on the 事件期 rounds (Match.eventRounds), every player's
// normal wave mixes in exactly ONE duck-family enemy — 系统随机 over the 鸭爵 strategy's pool (与官方鸭爵策略同一池、
// 同一随机方式) — with the strategy's numbers unchanged: "击倒这些敌人者获得1资金奖励（包括联防阶段）" and "但进入保护
// 目标点将减少1点目标生命值" (a REAL leak: counted, lpr 1, 照常破坏完美作战). Real match paths (the match harness in
// virtual time, real data, the real Battle where the leak semantics are checked) like test/match/feedback1-ducklord.test.js.
//
// Run: node --test test/match/duck-spawns.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { DATA, makeMatch } from './harness.js';
import { FakeBattle } from './fakeBattle.js';
import { Battle } from '../../server/sim/Battle.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { duckSpawnsFor, duckPool, duckRound, DUCK_TAG, DUCK_COINS } from '../../server/match/match/duckSpawns.js';

const BAND = 'band_ducklord';
const DUCKS = DATA.bands[BAND].buffs.find((b) => b.key === 'round_start_all_player_change_enemy_2').bbStr.enemylist.split(',');
const QUIET = { info() {}, debug() {}, warn() {}, error() {} };

/** 4 seats as two teams of two (0,1 → team 0; 2,3 → team 1), like event.test.js. */
const vsSeats = () => ([
  { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
  { seat: 1, playerId: 'ai_1', name: 'A1', isBot: true, connected: true, team: 0 },
  { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
  { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
]);

/** The playerId of the seat holding the 鸭爵 strategy (a plain string: never hand a PlayerState to assert). */
const ducklordOf = (m) => [...m.players.values()].find((p) => (m.gd.band(p.bandId)?.effectRef ?? p.bandId) === BAND)?.playerId ?? null;

/**
 * [ASSUMED] isolation: a seat that DRAFTED the 鸭爵 strategy gets its own 0–2 swaps of the same four enemies on top of
 * the event duck (the two features stack — the spec merges neither), and those swaps are indistinguishable from the
 * event duck (same tag / bounty). This suite tests the event duck ALONE (the strategy's own swaps are
 * test/match/feedback1-ducklord.test.js's subject), so every holder is switched to another band after the draft. The
 * swap handler (bands/meta.js duckGlobal) resolves its holder per battle start, so this fully silences it.
 */
function isolateEventDuck(m) {
  for (const p of m.players.values()) {
    if ((m.gd.band(p.bandId)?.effectRef ?? p.bandId) !== BAND) continue;
    p.bandId = 'band_bldsk';
    p.recompute();
  }
  assert.equal(ducklordOf(m), null, 'no seat holds 鸭爵');
}

/** A 2V2 match driven to the PREP of its first 事件期 round (humans on AI 托管: the period picks itself). */
function versusAtEventPrep(seed) {
  const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed, fake: true }).start();
  h.autoHumans();
  const m = h.m;
  assert.equal(m.eventRounds.length, 3, '2V2 has three 事件期 rounds');
  const r = m.eventRounds[0];
  assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === r, { maxSteps: 3e6 }), `PREP R${r} (phase ${m.phase} R${m.round})`);
  isolateEventDuck(m);
  assert.deepEqual(duckPool(m.gd), DUCKS, '与官方鸭爵策略同一池');
  return { h, m, ps: h.ps('p_0') };
}

test('every 事件期 round mixes exactly one duck into every player\'s normal battle; every other round none', () => {
  const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 20261024, fake: true }).start();
  h.autoHumans();
  const m = h.m;
  const rounds = m.eventRounds;
  assert.equal(rounds.length, 3);
  // isolate before R5 (the strategy's own swaps start there) so only the event duck can appear
  assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === 1, { maxSteps: 3e6 }), `PREP R1 (phase ${m.phase} R${m.round})`);
  isolateEventDuck(m);
  assert.ok(h.drive(() => h.ended != null || FakeBattle.instances.some((b) => b.kind === 'normal' && b.round === rounds[2]), { maxSteps: 3e6 }),
    `E3 combat built (phase ${m.phase} R${m.round})`);
  const fields = FakeBattle.instances.filter((b) => b.kind === 'normal');
  assert.ok(fields.some((b) => b.round < rounds[0]), 'pre-事件期 rounds ran');
  for (const r of rounds) assert.equal(fields.filter((b) => b.round === r).length, 4, `R${r}: one field per seat`);
  for (const f of fields) {
    const ducks = f.opts.spawns.filter((s) => s.tag === DUCK_TAG);
    assert.equal(ducks.length, rounds.includes(f.round) ? 1 : 0, `${f.fieldId} R${f.round}: ${ducks.length} ducks`);
    for (const d of ducks) {
      assert.ok(DUCKS.includes(d.enemyKey), `${d.enemyKey} of the 鸭爵 pool`);
      assert.equal(d.count, 1, 'exactly one');
      assert.deepEqual(d.bounty, { coins: DUCK_COINS, ownerPlayerId: f.players[0] }, '1 fund to whoever knocks it out');
    }
  }
  m.dispose();
});

test('the duck is a wave member with the strategy\'s carriers: bounty 1 fund, counted leak, lpr 1', () => {
  const { m, ps } = versusAtEventPrep(7301);
  for (const p of m.alivePlayers()) {
    const opts = m._normalOpts(p);
    const ducks = opts.spawns.filter((s) => s.tag === DUCK_TAG);
    assert.equal(ducks.length, 1, `${p.playerId}: exactly one`);
    const d = ducks[0];
    assert.ok(DUCKS.includes(d.enemyKey), `${d.enemyKey} of the 鸭爵 pool`);
    assert.deepEqual(d.bounty, { coins: DUCK_COINS, ownerPlayerId: p.playerId }, '击倒者获得 1 资金 (联防队友击杀也算: economy.js _bountyPayee pays the killer)');
    assert.equal(d.mods?.bountyCoins ?? 0, DUCK_COINS, 'the copy a leaked one keeps paying with in 联防 (_sanitizeSpawns → unite.js)');
    assert.equal(d.ownerPlayerId, p.playerId);
    assert.equal(d.count, 1);
    assert.equal(d.countInTotal ?? null, null, 'a REAL leak — never the free-leak flag of a 狩猎期 placement');
    assert.equal(DATA.enemies[d.enemyKey].stats.lpr, 1, '漏进保护目标点扣 1 点目标生命值');
    assert.ok(Number.isInteger(d.routeIndex) && d.routeIndex >= 0 && d.routeIndex < opts.routes.length, 'a wave route');
    assert.ok(Number.isFinite(d.time) && d.time >= 0, 'in the wave\'s own time window');
  }
  // additive and pure: the wave it mixes into comes back untouched before the one added spec
  const list = [{ time: 3, enemyKey: 'enemy_1000_gopro_2', routeIndex: 0, count: 2, interval: 1, mods: { slot: 'N' } }];
  const out = duckSpawnsFor(m, ps, list);
  assert.equal(out.length, 2);
  assert.equal(out[0], list[0], 'the wave is never edited');
  assert.equal(out[1].tag, DUCK_TAG);
  assert.equal(out[1].mods?.slot ?? null, null, 'the host\'s slot class is dropped (duckReplace)');
  assert.equal(duckSpawnsFor(m, ps, list, { preview: true }).length, 2, 'a rehearsal preview sees the same kind of wave');
  m.dispose();
});

test('a leaked duck is a real leak: lpr 1, one counted leak, 完美作战 broken, no fund (real Battle)', () => {
  const { m, ps } = versusAtEventPrep(7302);
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  const opts = m._normalOpts(ps);
  const spec = opts.spawns.find((s) => s.tag === DUCK_TAG);
  assert.ok(spec, 'the duck');
  // the duck alone, at once (its real route and round multipliers) — no operators, so it walks into the goal
  const b = new Battle({ data: m.ds, content: m.battleContent, logger: QUIET, ...opts, spawns: [{ ...spec, time: 0 }], timeLimit: 600 });
  for (let t = 0; t < 600 * 30 && !b.finished; t++) b.step();
  const res = b.result();
  const pp = res.perPlayer[ps.playerId];
  assert.equal(pp.total, 1, 'one scheduled enemy');
  assert.equal(pp.leaked.length, 1, 'the duck alone leaks');
  assert.equal(pp.leaked[0].enemyKey, spec.enemyKey);
  assert.equal(pp.leaked[0].lpr, 1, '漏进保护目标点扣 1 点目标生命值 (the data lpr)');
  assert.equal(pp.leaked[0].counted, true, 'a real leak (settle charges min(lpCapPerRound, counted))');
  assert.equal(pp.perfect, false, '照常破坏完美作战');
  assert.equal(pp.coins, 0, 'no knock-out, no fund');
  m.dispose();
});

test('击倒者获得 1 资金: the duck spec\'s bounty pays the KILLER\'s player — a 联防 helper included', () => {
  const { m, ps } = versusAtEventPrep(7303);
  // the exact spec duckSpawnsFor mixes into an event round's wave (its bounty / tag), on a 联防-shaped field
  const [spec] = duckSpawnsFor(m, ps, []);
  assert.equal(spec.tag, DUCK_TAG);
  assert.deepEqual(spec.bounty, { coins: DUCK_COINS, ownerPlayerId: ps.playerId });
  // the shape of test/sim/feedback5-bounty-payee.test.js's 联防 field: helper ai_1's operator lands the blow
  const GUN = chessRec({ id: 't_gun', profession: 'SNIPER', projectile: 'none', stats: { atk: 50, maxHp: 1e7, bat: 1, blockCnt: 0 }, rangeGrid: [[0, 0]], skill: null });
  const helper = (playerId, seat, side, colOffset, units = []) => ({ playerId, seat, side, colOffset, units, bonds: {}, layers: {} });
  const h = makeBattle({
    kind: 'unite', content: 'none', autoFinish: false, timeLimit: 60,
    players: [helper(ps.playerId, 0, 'L', 0), helper('ai_1', 1, 'R', 8, [{ uid: 1, kind: 'chess', chessId: 't_gun', row: 10, col: 4 }])],
    defs: { chess: { t_gun: GUN }, enemies: { [spec.enemyKey]: enemyRec({ key: spec.enemyKey, hp: 100, speed: 0 }) } },
    enemies: [{
      key: spec.enemyKey, pos: [10, 15],
      bounty: spec.bounty, tag: spec.tag, ownerPlayerId: spec.ownerPlayerId,
    }],
  });
  h.step();
  const d = h.b.enemies.find((e) => e.defId === spec.enemyKey);
  const gun = h.b.allies().find((u) => u.ownerId === 'ai_1');
  assert.ok(d && gun, 'the duck and the helper\'s operator');
  h.b.dealDamage(gun, d, { amount: 500, type: 'phys' });
  assert.ok(!d.alive, 'the helper\'s operator knocked it out');
  const pay = {};
  for (const e of h.eventsOf('bounty')) pay[e[1]] = (pay[e[1]] || 0) + e[2];
  assert.deepEqual(pay, { ai_1: DUCK_COINS }, '击倒者获得 1 资金 — the killer\'s player, even though the bounty is the leaker\'s');
  assert.equal(h.result().perPlayer[ps.playerId].coins, 0);
  assert.equal(h.result().perPlayer.ai_1.coins, DUCK_COINS);
  m.dispose();
});

test('deterministic (seeded stream): the same match replays the same duck; a rehearsal\'s preview never moves the draw', () => {
  const duckAt = (mm, pid) => {
    const s = mm._normalOpts(mm.players.get(pid)).spawns.find((x) => x.tag === DUCK_TAG);
    assert.ok(s, 'the duck');
    return `${s.enemyKey}@${s.time}r${s.routeIndex}:${s.bounty.coins}`;
  };
  const a = versusAtEventPrep(4242);
  const aDuck = duckAt(a.m, 'p_0');
  a.m.dispose();
  const b = versusAtEventPrep(4242);
  for (let i = 0; i < 3; i++) {
    assert.ok(b.m._normalOpts(b.ps, { preview: true }).spawns.some((s) => s.tag === DUCK_TAG), 'the rehearsal sees the duck');
  }
  assert.equal(duckAt(b.m, 'p_0'), aDuck, 'the previews never moved the real draw');
  b.m.dispose();
});

test('同盟狩猎 gets one per player too; solo has no 事件期 round and no duck', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 3, fake: true, seed: 909 }).start();
  h.autoHumans();
  const m = h.m;
  assert.equal(m.eventRounds.length, 3);
  const r = m.eventRounds[0];
  assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === r, { maxSteps: 3e6 }), `PREP R${r} (phase ${m.phase} R${m.round})`);
  isolateEventDuck(m);
  const alive = m.alivePlayers();
  assert.ok(alive.length >= 2, 'AI teammates have seats too');
  for (const p of alive) {
    const ducks = m._normalOpts(p).spawns.filter((s) => s.tag === DUCK_TAG);
    assert.equal(ducks.length, 1, `${p.playerId}: 每名玩家 1 只`);
    assert.deepEqual(ducks[0].bounty, { coins: DUCK_COINS, ownerPlayerId: p.playerId });
  }
  m.dispose();

  const s = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 5, fake: true }).start();
  const sm = s.m;
  assert.deepEqual(sm.eventRounds, [], 'solo has no hunt, hence no 事件期 round');
  assert.equal(duckRound(sm), false);
  s.toPrep(4);
  assert.equal(sm._normalOpts(s.ps('p_0')).spawns.filter((x) => x.tag === DUCK_TAG).length, 0, 'no duck outside the event rounds');
  sm.dispose();
});
