// test/match/ai-hunter.test.js — 「猎手 AI」(AI 狩猎模式, 0.0.5): the counter model, the tier dial, and the two places
// a bot's 狩猎期 placement changes. The rule this suite guards is the one the spec calls non-negotiable: the hunter
// changes the CHOICE only — same budget, same candidate pool, same caps, and every plan it produces is accepted only
// after the human gate `_confrontMember` passes it (server/match/match/confront.js). FUNNY and every non-versus mode
// must be identical to the pre-0.0.5 greedy fill, and the locked versus golden family proves that on the real seeds.
//
// Run: node --test test/match/ai-hunter.test.js
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { PHASE, AI_HUNT, VERSUS_CONFRONT } from '../../shared/constants.js';
import { aiHuntTierOf, enemyTagsOf, boardReadout, counterScore } from '../../server/match/match/aiHunter.js';

/** Four AI seats as two teams of two: the 对抗期 decides everything the moment it opens. */
const botSeats = () => ['p_0', 'p_1', 'p_2', 'p_3'].map((playerId, seat) => ({ seat, playerId, name: `B${seat}`, isBot: true, connected: true, team: Math.floor(seat / 2) }));
/** One live human seat + three AI: step 1 waits for the human, so step 2 (the monster window) can be observed. */
const vsSeats = () => ([
  { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
  { seat: 1, playerId: 'ai_1', name: 'A1', isBot: true, connected: true, team: 0 },
  { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
  { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
]);

/** Run a whole all-AI 对抗期 and hand back the submissions the round applied (`m.confront`). */
function huntedRound(difficulty, seed) {
  const h = makeMatch({ mode: 'versus', difficulty, seats: botSeats(), seed, fake: true }).start();
  const m = h.m;
  const ok = h.drive(() => m.confront && m.confront.size > 0, { maxSteps: 3e6 });
  assert.ok(ok, `an all-AI 对抗期 decided itself (phase ${m.phase} R${m.round})`);
  return { h, m, subs: m.confront };
}

/** Drive to step 1, let the human name its target, and stop inside step 2: the bots have submitted, the human has not. */
function monsterWindow(difficulty, seed) {
  const h = makeMatch({ mode: 'versus', difficulty, seats: vsSeats(), seed, fake: true }).start();
  const m = h.m;
  assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), `reached step 1 (phase ${m.phase} R${m.round})`);
  const opp = [...m.players.values()].filter((p) => p.alive && p.team !== m.players.get('p_0').team).map((p) => p.playerId);
  assert.ok(opp.length >= 2, 'a 2V2 has two opponents to aim at');
  assert.deepEqual(m.handle('p_0', { t: 'g.confrontTarget', targetPlayerId: opp[1] }), { ok: true }, 'the human picks');
  assert.equal(m.confrontStage, 'monster', 'every seat now holds a target, so step 2 opened');
  return { h, m };
}

/** A stand-in gamedata object: boardReadout / enemyTagsOf each call exactly one accessor. */
const fakeGd = (chess, enemies) => ({ chess: (id) => chess[id] ?? null, enemy: (key) => enemies[key] ?? null });

describe('the tier dial (K1: bound to the difficulty)', () => {
  test('every difficulty maps, FUNNY never hunts, and nothing outside 2V2 hunts', () => {
    assert.equal(aiHuntTierOf('FUNNY', true), 'off', '轻松房不针对人');
    assert.equal(aiHuntTierOf('NORMAL', true), 'weak');
    assert.equal(aiHuntTierOf('HARD', true), 'mid');
    assert.equal(aiHuntTierOf('ABYSS', true), 'strong');
    // an unknown difficulty must not silently start hunting
    assert.equal(aiHuntTierOf('NIGHTMARE', true), 'off');
    assert.equal(aiHuntTierOf(undefined, true), 'off');
    for (const d of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) assert.equal(aiHuntTierOf(d, false), 'off', 'coop / solo never hunt');
    assert.equal(typeof AI_HUNT.enabled, 'boolean');
  });

  test('the table is self-consistent: every tier has a width and a slot list, and the weights name real tags', () => {
    const tiers = ['weak', 'mid', 'strong'];
    for (const t of tiers) {
      assert.ok(Number.isInteger(AI_HUNT.width[t]) && AI_HUNT.width[t] >= 1, `width ${t}`);
      assert.ok(Array.isArray(AI_HUNT.positions[t]) && AI_HUNT.positions[t].length, `positions ${t}`);
      for (const p of AI_HUNT.positions[t]) assert.ok(VERSUS_CONFRONT.positions.includes(p), `${t}: ${p} is a real slot`);
    }
    assert.deepEqual([...AI_HUNT.positions.weak], ['mid'], 'weak keeps today\'s slot');
    for (const t of AI_HUNT.bossTiers) assert.ok(tiers.includes(t), `bossTiers: ${t}`);
    assert.ok(!AI_HUNT.bossTiers.includes('weak') && !AI_HUNT.bossTiers.includes('mid'), 'K3: only the strongest tier uses the boss 格');
    assert.deepEqual(AI_HUNT.width.weak > AI_HUNT.width.strong, true, 'weak plays sloppier than strong');
    assert.equal(VERSUS_CONFRONT.maxPicks > 0, true);
  });
});

describe('the counter model (pure functions)', () => {
  const gd = fakeGd({
    flyShot: { stats: { atk: 100, aspd: 1, blockCnt: 0, hpRecoveryPerSec: 0 }, canHitFly: true, dmgType: 'phys', attackKind: 'ranged' },
    wall: { stats: { atk: 50, aspd: 1, blockCnt: 3, hpRecoveryPerSec: 0 }, canHitFly: false, dmgType: 'phys', attackKind: 'melee' },
    mage: { stats: { atk: 80, aspd: 1, blockCnt: 0, hpRecoveryPerSec: 0 }, canHitFly: false, dmgType: 'arts', attackKind: 'ranged' },
  }, {
    eFly: { isFlyEnemy: true, acTypes: ['FLY'], stats: {} },
    eStealth: { acTypes: ['INVISIBLE'], stats: {} },
    eArmor: { acTypes: [], stats: { def: AI_HUNT.refs.def + 100, res: 0 } },
    eResist: { acTypes: [], stats: { def: 0, res: AI_HUNT.refs.res } },
    eBurst: { acTypes: ['TIMES'], stats: { atk: AI_HUNT.refs.atk, hpRecoveryPerSec: 2 }, summons: ['t'] },
  });

  test('boardReadout sums only what is on the field', () => {
    const board = new Map([['1,2', { kind: 'chess', id: 'flyShot' }], ['2,3', { kind: 'chess', id: 'wall' }]]);
    assert.deepEqual(boardReadout(gd, board), { pieces: 2, atk: 150, antiAir: 100, arts: 0, phys: 150, block: 3, melee: 1, ranged: 1, burst: 100, regen: 0 });
    const zero = { pieces: 0, atk: 0, antiAir: 0, arts: 0, phys: 0, block: 0, melee: 0, ranged: 0, burst: 0, regen: 0 };
    assert.deepEqual(boardReadout(gd, new Map()), zero, 'an empty board reads as zeros, never NaN');
    assert.deepEqual(boardReadout(gd, null), zero, 'no board at all is not an error');
    assert.equal(boardReadout(gd, new Map([['1,1', { kind: 'item', id: 'flyShot' }]])).pieces, 0, 'an item on a tile is not an operator');
    assert.equal(boardReadout(gd, new Map([['1,1', { kind: 'chess', id: 'unknown' }]])).pieces, 0, 'a piece with no chess record is skipped');
    assert.deepEqual(boardReadout(gd, new Map([['1,1', { kind: 'chess', id: 'mage' }]])).arts, 80, 'the arts share is what 高甲 cares about');
  });

  test('enemyTagsOf reads the shipped markers, not a second table', () => {
    assert.deepEqual(enemyTagsOf(gd, 'eFly'), ['fly']);
    assert.deepEqual(enemyTagsOf(gd, 'eStealth'), ['invisible']);
    assert.deepEqual(enemyTagsOf(gd, 'eArmor'), ['armor']);
    assert.deepEqual(enemyTagsOf(gd, 'eResist'), ['resist']);
    assert.deepEqual(enemyTagsOf(gd, 'eBurst'), ['times', 'sustain', 'summon', 'hard']);
    assert.deepEqual(enemyTagsOf(gd, 'nope'), [], 'an unknown key answers nothing');
    assert.deepEqual(Object.keys(AI_HUNT.weights).sort(), [...enemyTagsOf(gd, 'eBurst'), 'fly', 'ranged', 'invisible', 'dot', 'element', 'reflection', 'armor', 'resist', 'elite'].sort(), 'every weight names a tag the model can produce');
  });

  test('the whole 狩猎期 pool carries every tag the table prices', () => {
    // the round's 4-card type draw is too narrow to prove this (a round can hold no 飞行 type at all): walk the pool the
    // 特训 types actually offer, exactly as confront.js builds it
    const pool = new Set();
    for (const v of Object.values(DATA.factions.templateSlots || {})) if (typeof v === 'string') pool.add(v);
    for (const t of Object.values(DATA.factions.types || {})) {
      for (const k of t.pool || []) pool.add(k);
      for (const k of t.entries || []) pool.add(k);
    }
    assert.ok(pool.size > 100, `the confront pool (${pool.size} monsters)`);
    const { m } = monsterWindow('NORMAL', 9);
    const seen = new Map();
    for (const key of pool) for (const t of enemyTagsOf(m.gd, key)) seen.set(t, (seen.get(t) || 0) + 1);
    m.dispose();
    for (const t of Object.keys(AI_HUNT.weights)) {
      assert.ok(seen.get(t) > 0, `no ${t} monster in the pool — that weight would be dead`);
    }
    assert.ok(seen.get('fly') >= 10 && seen.get('invisible') >= 10, '飞行 / 隐匿 stay the headline counters');
  });

  test('counterScore points at the engine rule behind each tag', () => {
    const thin = { pieces: 3, atk: 300, antiAir: 0, arts: 0, phys: 300, block: 0, melee: 3, ranged: 0, burst: 100, regen: 0 };
    assert.ok(counterScore(['fly'], thin) > counterScore(['fly'], { ...thin, antiAir: 300 }), '飞行惩罚缺对空的阵容');
    assert.ok(counterScore(['invisible'], thin) > counterScore(['invisible'], { ...thin, block: AI_HUNT.refs.block }), '阻挡能暴露隐匿，挡得住的人不怕隐形');
    const artsBoard = { ...thin, arts: 300, phys: 0 };
    assert.ok(counterScore(['armor'], thin) > counterScore(['armor'], artsBoard), '高甲惩罚纯物理');
    assert.ok(counterScore(['resist'], artsBoard) < counterScore(['resist'], thin), '高法抗反过来惩罚纯法伤');
    const big = { ...thin, burst: AI_HUNT.refs.atk * 2 };
    assert.ok(counterScore(['reflection'], big) > counterScore(['reflection'], thin), '反射怪奖励单点爆发（打它就是打自己）');
    assert.ok(counterScore(['times'], thin) > counterScore(['times'], big), '频次怪惩罚缺爆发');
    assert.ok(counterScore(['summon'], thin) > counterScore(['summon'], big), '召唤怪惩罚清不干净的爆发');
    assert.equal(counterScore([], thin), 0, 'no tag, no complaint');
    for (const s of [counterScore(['fly', 'armor', 'elite'], thin), counterScore(['fly'], { ...thin, atk: 0 }), counterScore(['times'], { pieces: 0 })]) {
      assert.ok(Number.isFinite(s) && s >= 0, `a finite, non-negative score, got ${s}`);
    }
  });
});

describe('the hunt inside a real 狩猎期', () => {
  test('every AI plan passes the HUMAN gate and stays inside budget, caps and pool', () => {
    for (const difficulty of ['NORMAL', 'HARD', 'ABYSS']) for (const seed of [31, 32, 33]) {
      const { m, subs } = huntedRound(difficulty, seed);
      const allowed = new Set((m.confrontGroups() || []).flatMap((g) => (g.rows || []).map((r) => r.key)));
      const bossPool = new Set(m.confrontBossOpen() ? m.confrontBossPool().map((b) => b.key) : []);
      assert.equal(subs.size > 0, true, 'the all-AI round produced submissions');
      for (const [pid, sub] of subs) {
        const ps = m.players.get(pid);
        assert.ok(sub.picks.length <= VERSUS_CONFRONT.maxPicks, `${difficulty}/${seed} ${pid}: the human count cap`);
        assert.ok(m.confrontSpent(sub.picks) <= m.confrontBudget(), 'the human budget — an AI is never handed more');
        assert.equal(sub.bosses.length <= m.confrontBossCap(), true, 'the event boss cap');
        for (const p of sub.picks) {
          assert.ok(allowed.has(p.enemyKey), `${p.enemyKey} is offered to a human too`);
          assert.ok(['upper', 'lower'].includes(p.gate), 'a real gate');
        }
        for (const b of sub.bosses) assert.ok(bossPool.has(b.enemyKey), 'every boss comes from the 机变悬赏 pool');
        assert.ok(VERSUS_CONFRONT.positions.includes(sub.position), `${sub.position} is a real slot`);
        assert.ok(sub.group >= 1 && sub.group <= (m.confrontGroups() || []).length, 'a real type tab');
        // the gate a human `g.confront` passes is the gate this plan passed, and it is still the same plan
        const again = m._confrontMember(ps, sub.group, sub.position, sub.picks, sub.bosses);
        assert.ok(again && !again.error, `re-validated by _confrontMember (${again && again.error})`);
        assert.deepEqual(JSON.parse(JSON.stringify(again.sub)), JSON.parse(JSON.stringify(sub)), 'and it comes back identical');
      }
      m.dispose();
    }
  });

  test('FUNNY is the old greedy fill: the hunter returns null and the plan keeps its invariants', () => {
    const { m } = monsterWindow('FUNNY', 41);
    assert.equal(m.aiHuntTier(), 'off');
    for (const ps of m.alivePlayers()) {
      if (!ps.botControlled) continue;
      assert.equal(m.aiHunterPlan(ps), null, 'no hunted plan on FUNNY');
      const sub = m.confrontSubs.get(ps.playerId);
      assert.ok(sub && sub.picks.length, 'the legacy plan still filled the budget');
      assert.equal(sub.position, 'mid', 'the legacy slot');
      assert.deepEqual(sub.bosses, [], 'the legacy submission never names a boss ([ASSUMED] user 2026-10-21)');
      const values = sub.picks.map((p) => m.confrontValueOf(p.enemyKey));
      for (let i = 1; i < values.length; i++) assert.ok(values[i] <= values[i - 1], 'still the value-descending greedy order');
    }
    m.dispose();
  });

  test('the same seed hunts the same way twice (the ai-hunt stream is the only randomness)', () => {
    const dump = ({ subs }) => JSON.stringify([...subs.entries()].map(([pid, s]) => [pid, s.position, s.picks, s.bosses]));
    const a = huntedRound('HARD', 51);
    const b = huntedRound('HARD', 51);
    assert.equal(dump(a), dump(b));
    assert.ok(a.subs.size > 0);
    a.m.dispose();
    b.m.dispose();
  });

  test('it aims at an answer, not at the first empty seat', () => {
    const aimed = new Set();
    for (const seed of [61, 62, 63, 64, 65, 66, 67, 68]) {
      const { m, subs } = huntedRound('ABYSS', seed);
      for (const [, sub] of subs) if (sub.target) aimed.add(sub.target);
      m.dispose();
    }
    assert.ok(aimed.size > 1, `the aim spreads over the opponents (saw ${[...aimed].sort().join(', ')})`);
  });

  test('the tier changes the plan (width is not decoration)', () => {
    const planOf = (difficulty, seed) => {
      const { m } = monsterWindow(difficulty, seed);
      const ps = m.alivePlayers().find((p) => p.botControlled);
      const sub = m.aiHunterPlan(ps) || m.confrontSubs.get(ps.playerId);
      const out = `${sub.position}|${sub.picks.map((p) => p.enemyKey).join(' ')}|${sub.bosses.length}`;
      m.dispose();
      return out;
    };
    const weak = [];
    const strong = [];
    for (const seed of [71, 72, 73, 74, 75, 76]) { weak.push(planOf('NORMAL', seed)); strong.push(planOf('ABYSS', seed)); }
    assert.ok(weak.every((s) => s.startsWith('mid|')), 'weak keeps the mid slot');
    assert.ok(strong.some((s) => !s.startsWith('mid|')), 'strong uses the timing axis');
    assert.notDeepEqual(weak, strong, 'two tiers do not produce the same hunt');
  });

  test('the read-out is cheap: 200 plans average well under a millisecond', () => {
    const { m } = monsterWindow('ABYSS', 81);
    const ps = m.alivePlayers().find((p) => p.botControlled);
    const t0 = process.hrtime.bigint();
    let plans = 0;
    for (let i = 0; i < 200; i++) if (m.aiHunterPlan(ps)) plans++;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(plans >= 100, `the plans kept being produced (${plans})`);
    const mean = ms / plans;
    assert.ok(mean < 5, `${plans} plans in ${ms.toFixed(1)} ms (mean ${mean.toFixed(3)} ms) — a hunt decision must not stall the single-process server`);
    m.dispose();
  });
});
