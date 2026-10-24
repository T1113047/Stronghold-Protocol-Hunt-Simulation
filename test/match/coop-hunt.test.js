// test/match/coop-hunt.test.js — 同盟狩猎 (COOP_HUNT, user 2026-10-17): a `mode_multi_*` co-op room keeps its four-player
// gameplay, but every 狩猎期 is filled by the SYSTEM. The rhythm is the 2V2 one (drawn start round R4/R5/R6, 5 % +2 %/round,
// cap 15 %, R13 最终狩猎 50 %), the prey comes from the official 特训敌人 types within the round's budget and is INSERTED
// into the shared wave. Killing it banks its bounty at 坎诺特 (never gold); the 事件期 keeps three periods with only
// self / mate targets. Solo and 2V2 are untouched.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE, ERR, COOP_HUNT, VERSUS_CONFRONT, merchantCapFor } from '../../shared/constants.js';
import { gateOf, isFlyKey } from '../../server/match/waves.js';

const coop = (o = {}) => makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, fake: true, ...o });

/** A co-op match driven to the PREP of its drawn 狩猎期 start round (humans answer drafts / ready). */
const huntPrep = (seed = 3, o = {}) => {
  const h = coop({ seed, ...o }).start();
  h.autoHumans();
  const m = h.m;
  assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === m.contestStartRound, { maxSteps: 3e6 }),
    `reached the hunt prep (phase ${m.phase} R${m.round}, contest ${m.contestStartRound})`);
  return h;
};

/** The prey of a built spawn list: banked bounties that are not the round's own 赏金怪 (tag 'bounty'). */
const preyOf = (spawns) => (spawns || []).filter((s) => s && s.bounty && s.bounty.bank === true && s.tag !== 'bounty');

const vsSeats = () => ([
  { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
  { seat: 1, playerId: 'ai_1', name: 'A1', isBot: true, connected: true, team: 0 },
  { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
  { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
]);

describe('同盟狩猎: the mode switch and the 狩猎期 window', () => {
  test('COOP_HUNT is on for co-op only; its rhythm matches the 2V2 table', () => {
    assert.equal(COOP_HUNT.enabled, true);
    for (const k of ['ratioBase', 'ratioStep', 'ratioMax', 'huntRound', 'huntRatio', 'budgetMul', 'maxPicks', 'bountyCaps', 'finalHuntBounty', 'killIncomeShare', 'merchantRates', 'merchantRoundCap', 'merchantUncappedRound']) {
      assert.deepEqual(COOP_HUNT[k], VERSUS_CONFRONT[k], `${k} is shared with the 2V2 rhythm`);
    }
    const h = coop({ seed: 3 }).start();
    const m = h.m;
    assert.equal(m.coopHuntOn, true);
    assert.equal(m.huntMode, true);
    assert.ok([4, 5, 6].includes(m.contestStartRound), `drawn start round ${m.contestStartRound}`);
    assert.deepEqual(m.eventRounds, [...new Set([m.contestStartRound, Math.min(12, m.contestStartRound + 4), 13])].sort((a, b) => a - b));
    assert.equal(m.eventRounds.at(-1), 13, 'E3 is the R13 最终狩猎');
    h.m.dispose();

    const solo = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 3, fake: true }).start();
    assert.equal(solo.m.coopHuntOn, false);
    assert.equal(solo.m.huntMode, false);
    assert.equal(solo.m.contestStartRound, null);
    assert.deepEqual(solo.m.eventRounds, []);
    assert.equal(solo.m.merchantView(solo.m.order[0]), null);
    solo.m.dispose();

    const vs = makeMatch({ mode: 'versus', difficulty: 'NORMAL', seats: vsSeats(), seed: 3, fake: true }).start();
    assert.equal(vs.m.coopHuntOn, false, '2V2 keeps its own 对抗期');
    assert.equal(vs.m.isVersus, true);
    assert.ok([4, 5, 6].includes(vs.m.contestStartRound));
    assert.equal(vs.m.coopHuntPlan(vs.m.order[0]), null);
    vs.m.dispose();
  });

  test('the window runs from the drawn start round to the round before R14; R14 / R15 never hunt', () => {
    const h = coop({ seed: 3 }).start();
    const m = h.m;
    const start = m.contestStartRound;
    m.round = start - 1;
    assert.equal(m.coopHuntActive(), false);
    m.round = start;
    assert.equal(m.coopHuntActive(), true);
    m.round = 13;
    assert.equal(m.coopHuntActive(), true, 'the R13 最终狩猎 is a hunt round');
    m.round = m.gd.bossRound;
    assert.equal(m.coopHuntActive(), false, 'R14 最终攻势');
    assert.equal(m.coopHuntPlans(), null);
    m.round = m.gd.bossRound + 1;
    assert.equal(m.coopHuntActive(), false, 'R15 隐秘核心');
    m.dispose();
  });

  test('the ratio ramp is 5 % +2 %/round, capped at 15 %, with R13 at a flat 50 %', () => {
    const h = coop({ seed: 3 }).start();
    const m = h.m;
    m.contestStartRound = 4;
    m.round = 4;
    assert.equal(m.confrontRatio(), 0.05);
    m.round = 5;
    assert.equal(m.confrontRatio(), 0.07);
    m.round = 8;
    assert.ok(Math.abs(m.confrontRatio() - 0.13) < 1e-9, String(m.confrontRatio()));
    m.round = 9;
    assert.equal(m.confrontRatio(), 0.15);
    m.round = 12;
    assert.equal(m.confrontRatio(), 0.15, 'the cap holds');
    m.round = 13;
    assert.equal(m.confrontRatio(), 0.5, '最终狩猎');
    assert.equal(m.confrontHunt(), true);
    m.dispose();
  });

  test('the COOP_HUNT switch (enabled / opts.coopHunt) turns the whole feature off without touching the mode', () => {
    const h = coop({ seed: 3, coopHunt: false }).start();
    const m = h.m;
    assert.equal(m.coopHuntOn, false);
    assert.equal(m.huntMode, false);
    assert.equal(m.contestStartRound, null);
    assert.deepEqual(m.eventRounds, []);
    assert.equal(m.coopHuntPlans(), null);
    m.dispose();
  });
});

describe('同盟狩猎: the system deployment (one plan per alive player)', () => {
  const four = (seed = 3) => huntPrep(seed, { bots: 3 });

  test('four players get four different totals and (while the types last) four different main types', () => {
    const h = four(3);
    const m = h.m;
    const plans = m.coopHuntPlans();
    assert.equal(plans.size, 4, 'one plan per alive player');
    const list = [...plans.values()];
    for (const plan of list) {
      assert.equal(plan.round, m.contestStartRound);
      assert.equal(plan.budget, Math.round(m.confrontWaveValue() * m.confrontRatio()), 'per-player budget = wave value × ratio (no ×2)');
      assert.ok(plan.budget < Math.round(m.confrontWaveValue() * m.confrontRatio() * COOP_HUNT.budgetMul), 'co-op inserts: no 2V2 budget multiplier');
      assert.ok(plan.picks.length >= 1, 'every player gets at least one prey');
      assert.ok(plan.picks.length <= COOP_HUNT.maxPicks);
      assert.ok(plan.value <= plan.budget, `spent ${plan.value} / ${plan.budget}`);
      // explicit semantics: `value` is the total VALUE, `count` is the number of monsters (no ambiguous `total`)
      assert.equal(plan.value, m.confrontSpent(plan.picks));
      assert.equal(plan.count, plan.picks.length);
      assert.equal(Object.prototype.hasOwnProperty.call(plan, 'total'), false, 'the old ambiguous total field is gone');
      assert.ok(['front', 'mid', 'back'].includes(plan.position));
      const offered = new Set(m.confrontGroups().flatMap((g) => g.rows.map((r) => r.key)));
      for (const p of plan.picks) {
        assert.ok(offered.has(p.enemyKey), `${p.enemyKey} is an official 特训敌人`);
        assert.ok(['upper', 'lower'].includes(p.gate));
      }
      // the bounty is priced once, at deployment time, per plan
      assert.deepEqual(plan.coins, m.confrontBountyPlan(plan.picks));
      assert.equal(plan.coins.reduce((a, b) => a + b, 0), m.confrontBountyOf(plan.picks));
    }
    const totals = list.map((p) => p.value);
    assert.equal(new Set(totals).size, 4, `totals must be pairwise different: ${totals.join(', ')}`);
    const groups = list.map((p) => p.group);
    assert.equal(new Set(groups).size, 4, `main types must differ while 7 types exist: ${groups.join(', ')}`);
    assert.equal(new Set(list.map((p) => p.category)).size, 4);
    m.dispose();
  });

  test('each plan is inserted into its OWN player\'s wave (not a shared batch), and the preview matches', () => {
    const h = four(3);
    const m = h.m;
    const plans = m.coopHuntPlans();
    const sigs = new Set();
    for (const ps of m.alivePlayers()) {
      const plan = plans.get(ps.playerId);
      const spawns = m._normalOpts(ps).spawns;
      const prey = preyOf(spawns);
      assert.equal(prey.length, plan.count, `${ps.playerId} meets its own prey`);
      assert.deepEqual(prey.map((s) => s.enemyKey), plan.picks.map((p) => p.enemyKey));
      const preview = m.nextEnemiesFor(ps);
      for (const s of prey) {
        assert.equal(s.countInTotal, false, 'a leaked prey costs no 目标生命值 (like a 2V2 placement)');
        assert.equal(s.bounty.bank, true, '赏金 is banked at 坎诺特');
        assert.equal(s.bounty.total, plan.count);
        assert.equal(s.ownerPlayerId, ps.playerId);
        // the preview shows the REAL gate / movement class of the prey, not previewOf's lower / ground default
        const row = preview.find((e) => e.enemyKey === s.enemyKey && e.t === s.time && e.count === s.count);
        assert.ok(row, `${s.enemyKey} is previewed at its spawn time`);
        const route = m.wave.routes[s.routeIndex];
        assert.equal(row.gate, gateOf(route.start, false), `${s.enemyKey}: preview gate matches the route`);
        assert.equal(row.fly, isFlyKey(m.gd, s.enemyKey), `${s.enemyKey}: preview flying flag matches the data`);
        assert.equal(row.source, 'prey', 'a prey preview is marked display-only');
        assert.equal(row.countInTotal, false, 'prey stays out of the HUD denominator');
      }
      // the HUD capsule denominator is the same number on both sides: scheduled enemies (= spec `total`, prey excluded)
      const scheduled = (list) => list.filter((s) => s && s.tag !== 'boss' && s.tag !== 'part' && s.countInTotal !== false)
        .reduce((n, s) => n + Math.max(1, Math.floor(Number(s.count) || 1)), 0);
      const shown = preview.filter((e) => e.countInTotal !== false).reduce((n, e) => n + e.count, 0);
      assert.equal(shown, scheduled(spawns), `${ps.playerId}: Σ preview (HUD entries) = the capsule denominator`);
      sigs.add(plan.picks.map((p) => p.enemyKey).join('+'));
    }
    // with four different main types the deployments normally differ; at least the totals do (asserted above)
    assert.ok(sigs.size >= 2, 'the system does not hand everyone the same batch');
    m.dispose();
  });

  test('the same seed reproduces the same four deployments; another seed changes them', () => {
    const sig = (h) => [...h.m.coopHuntPlans().values()].map((p) => ({
      playerId: p.playerId, budget: p.budget, position: p.position, category: p.category,
      picks: p.picks, coins: p.coins, value: p.value,
    }));
    const h1 = four(3);
    const h2 = four(3);
    assert.deepEqual(sig(h1), sig(h2), 'same seed → the same plans');
    const h3 = four(3);
    const h4 = four(4);
    assert.notDeepEqual(sig(h3), sig(h4), 'another seed → different plans');
    h1.m.dispose();
    h2.m.dispose();
    h3.m.dispose();
    h4.m.dispose();
  });

  test('dead / eliminated players are skipped; their slot passes to the next living player', () => {
    const h = four(3);
    const m = h.m;
    assert.equal(m.coopHuntPlans().size, 4);
    const dead = h.ps('ai_1');
    dead.eliminate(m.round);
    m._coopHuntPlans = null; // rebuild the distribution as the next round's start would
    m._coopHuntRound = 0;
    const plans = m.coopHuntPlans();
    assert.equal(plans.size, 3, 'only the alive seats get a plan');
    assert.equal(plans.has('ai_1'), false);
    assert.equal(new Set([...plans.values()].map((p) => p.group)).size, 3, 'the rotation still gives three different types');
    assert.equal(new Set([...plans.values()].map((p) => p.value)).size, 3, 'three distinct totals');
    for (const plan of plans.values()) assert.ok(plan.picks.length >= 1);
    m.dispose();
  });

  test('the prey appears only in the hunt rounds (never R1–R3, never the R14 / R15 boss rounds)', () => {
    const h = coop({ seed: 3 }).start();
    h.autoHumans();
    const m = h.m;
    const start = m.contestStartRound;
    if (start > 1) {
      assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === 1, { maxSteps: 3e6 }));
      assert.equal(m.coopHuntActive(), false);
      assert.equal(m.coopHuntPlans(), null);
      assert.equal(preyOf(m._normalOpts(h.ps('p_0')).spawns).length, 0, 'no system prey before the start round');
    }
    m.dispose();
  });
});

describe('同盟狩猎: 赏金 → 坎诺特 bank → 取钱 (never gold)', () => {
  test('a battle bank lands in PlayerState.bountyBank and not in the purse', () => {
    let h = null;
    h = coop({
      seed: 3,
      script: (b) => (h && b.round === h.m.contestStartRound ? { bank: { p_0: 4 } } : {}),
    }).start();
    h.autoHumans();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.SETTLE && m.round === m.contestStartRound, { maxSteps: 3e6 }), 'settled the hunt round');
    const ps = h.ps('p_0');
    assert.equal(ps.bountyBank, 4, 'the battle bank is banked');
    assert.equal(ps.bountyEarned, 4, 'and counted as 本局赏金收入');
    assert.equal(ps.pendingFunds, 0, 'a banked 赏金 never becomes funds (no coins in the report)');
    m.dispose();
  });

  test('the merchant panel and withdrawal work in co-op with the 2V2 rate / ceil-floor / cap rules', () => {
    const h = huntPrep(33);
    const m = h.m;
    const ps = h.ps('p_0');
    const view = m.merchantView(ps);
    assert.ok(view, 'm.private.merchant is present in a co-op hunt');
    assert.equal(view.rate, m.merchantRate());
    assert.equal(view.cap, 4);
    assert.equal(m.publicView().merchant.rate, m.merchantRate(), 'm.public carries the round rate');
    assert.equal(m.publicView().players.find((p) => p.playerId === 'p_0').rate, m.merchantRate());
    assert.equal(m.publicView().players.find((p) => p.playerId === 'p_0').bank, 0);

    m.round = 9; // rate 0.3, cap 4
    ps.withdrawnThisRound = 0;
    ps.bountyBank = 100;
    const w = (gold) => m.handle('p_0', { t: 'g.confront.withdraw', gold });
    const funds0 = ps.funds;
    const gained0 = ps.stats.fundsGained;
    assert.deepEqual(w(1), { ok: true });
    assert.equal(ps.bountyBank, 96, 'ceil(1 / 0.3) = 4');
    assert.equal(ps.stats.fundsGained, gained0 + 1, 'the withdrawal is counted once (addFunds already credits it)');
    assert.deepEqual(w(1), { ok: true });
    assert.equal(ps.bountyBank, 93, 'floor(1 / 0.3) = 3');
    assert.deepEqual(w(2), { ok: true });
    assert.equal(ps.bountyBank, 87, 'floor(2 / 0.3) = 6');
    assert.equal(ps.withdrawnThisRound, 4);
    assert.equal(w(1).error, ERR.MERCHANT_CAP, 'the round cap is a hard stop');
    assert.equal(ps.funds, funds0 + 4, 'the purse holds exactly what was withdrawn');

    m.round = 15; // 隐秘核心: 1:1, no cap
    ps.withdrawnThisRound = 0;
    ps.bountyBank = 12;
    assert.deepEqual(w(12), { ok: true });
    assert.equal(ps.bountyBank, 0);
    assert.equal(ps.funds, funds0 + 16);
    assert.equal(merchantCapFor(15, COOP_HUNT), Infinity);
    m.dispose();
  });
});

describe('同盟狩猎: the 事件期 has only self / mate', () => {
  test('targets, availability and validation exclude the opponents; both targets stay usable every event (0.0.5)', () => {
    const h = coop({ seed: 3 }).start();
    h.autoHumans();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.EVENT && m.round === m.contestStartRound, { maxSteps: 3e6 }), 'reached E1');
    assert.deepEqual(m.eventTargetKeys(), ['self', 'mate']);
    const view = m.eventView();
    assert.ok(view, 'm.public.event exists for a co-op hunt');
    const ps = h.ps('p_0');
    assert.deepEqual(m.eventTargetIds(ps), { self: 'p_0', mate: m.coopEventMate(ps).playerId });
    assert.equal(m.coopEventMate(ps), m.aliveAlliesOf(ps).find((p) => p !== ps), 'mate comes from the LIVING allies');
    assert.notEqual(m.eventTargetMap(ps).mate, ps);
    assert.deepEqual(m.eventAvailableTargets(ps), ['self', 'mate']);
    assert.equal(m.pickEvent(ps, 'oppA').error, ERR.BAD_TARGET);
    assert.equal(m.pickEvent(ps, 'oppB').error, ERR.BAD_TARGET);
    assert.deepEqual(m.pickEvent(ps, 'self'), { ok: true });
    // 0.0.5: the one-target-per-match limit is gone everywhere — a used target stays offered and may repeat
    ps.eventTargets.push('mate');
    assert.deepEqual(m.eventAvailableTargets(ps), ['self', 'mate']);
    // a co-op bot has no 对面 side at all: botEventTarget falls back to 自己
    assert.equal(m.botEventTarget(ps), 'self');
    // the monster channel still runs (the 2V2 entries / 强力属性 apply to the co-op wave)
    assert.ok(m.foeEvent && m.foeEvent.card, 'a monster entry is drawn for the event');
    assert.ok(m.foeWaveSpawns([{ enemyKey: 'enemy_1007_slime', count: 2, mods: {} }]).length > 0);
    assert.equal(m.publicFoeElite() != null, true, 'the 强力属性 subset is announced');
    m.dispose();
  });

  test('a dead / departed teammate is never the mate target; a lone survivor has only self', () => {
    const h = coop({ seed: 3, bots: 3 }).start();
    h.autoHumans();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.EVENT && m.round === m.contestStartRound, { maxSteps: 3e6 }), 'reached E1');
    const ps = h.ps('p_0');
    const dead = m.coopEventMate(ps);
    assert.ok(dead && dead !== ps);
    dead.eliminate(m.round);
    const mate = m.coopEventMate(ps);
    assert.ok(mate && mate !== ps && mate.alive && !mate.left, 'the next living teammate');
    assert.notEqual(mate, dead, 'never the eliminated teammate');
    assert.ok(m.eventAvailableTargets(ps).includes('mate'));
    // eliminate every remaining teammate: only self is left, and `mate` is refused
    for (const p of m.aliveAlliesOf(ps)) if (p !== ps) p.eliminate(m.round);
    assert.equal(m.coopEventMate(ps), null);
    assert.deepEqual(m.eventAvailableTargets(ps), ['self']);
    assert.equal(m.pickEvent(ps, 'mate').error, ERR.BAD_TARGET);
    m.dispose();
  });
});
