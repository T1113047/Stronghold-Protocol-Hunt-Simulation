// test/match/confront-traits.test.js — the 狩猎期 特性 pricing (2V2): every enemy of the confront pool carries a grade,
// a stat stick keeps its stat value exactly, and the graded part takes VERSUS_CONFRONT.traitShare (30 %) of the value
// table. The grades themselves live in server/match/match/confrontTraits.js (hand-reviewed, 2026-10-17).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE, VERSUS_CONFRONT } from '../../shared/constants.js';
import { confrontPool, confrontValue } from '../../server/match/match/confront.js';
import { CONFRONT_TRAIT_GRADE, confrontTraitGrade } from '../../server/match/match/confrontTraits.js';

/** 4 seats laid out as two teams of two (0,1 → team 0; 2,3 → team 1). */
const vsSeats = () => ([
  { seat: 0, playerId: 'p_0', name: 'A0', isBot: false, connected: true, team: 0 },
  { seat: 1, playerId: 'ai_1', name: 'A1', isBot: true, connected: true, team: 0 },
  { seat: 2, playerId: 'ai_2', name: 'B0', isBot: true, connected: true, team: 1 },
  { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
]);

describe('狩猎期 特性分档 (2V2)', () => {
  test('every enemy of the confront pool carries a grade 1 / 2 / 3 in the table', () => {
    const m = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 11, fake: true }).start().m;
    const pool = confrontPool(m.data.factions);
    assert.ok(pool.length > 0, 'a non-empty pool');
    for (const k of pool) {
      assert.ok(m.data.enemies[k], `${k} is in the data`);
      assert.ok(Object.prototype.hasOwnProperty.call(CONFRONT_TRAIT_GRADE, k), `${k} is missing from confrontTraits.js`);
      assert.ok([1, 2, 3].includes(confrontTraitGrade(k)), `${k}: illegal grade ${confrontTraitGrade(k)}`);
    }
  });

  test('a grade-1 monster keeps its stat value and the graded part is the configured share of the table', () => {
    const m = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 11, fake: true }).start().m;
    const scale = m.confrontScale();
    const step = m.confrontTraitStep();
    assert.ok(step > 0, `a positive 特性 step (${step})`);
    let stat = 0;
    let graded = 0;
    const times = m.confrontTimesKeys();
    for (const k of confrontPool(m.data.factions)) {
      const e = m.data.enemies[k];
      if (!e) continue;
      // the SAME base confrontValueOf prices: 频次怪 (TIMES) carries its manual 1.5× (user 2026-10-21) on the stat half
      const s = Math.round(confrontValue(e, scale) * (times.has(k) ? 1.5 : 1));
      const v = m.confrontValueOf(k, scale);
      const g = confrontTraitGrade(k);
      stat += s;
      graded += v - s;
      if (g === 1) assert.equal(v, s, `${k}: a stat stick adds no 特性 value`);
      else assert.equal(v - s, step * (g - 1), `${k}: grade ${g} adds ${step} × ${g - 1}`);
    }
    const share = graded / (stat + graded);
    assert.ok(Math.abs(share - VERSUS_CONFRONT.traitShare) < 0.005, `the 特性 part is ${(share * 100).toFixed(2)} % of the table`);
  });

  test('频次怪（TIMES）的手动 1.5 倍计价（user 2026-10-21）', () => {
    const m = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 11, fake: true }).start().m;
    const scale = m.confrontScale();
    const times = [...m.confrontTimesKeys()];
    assert.ok(times.length >= 10, `the TIMES type lists its monsters (${times.length})`);
    const pool = new Set(confrontPool(m.data.factions));
    const scores = m.huntCfg().traitStepScores;
    let n = 0;
    for (const k of times) {
      if (!pool.has(k) || !m.data.enemies[k]) continue;
      const raw = confrontValue(m.data.enemies[k], scale);
      const trait = m.confrontTraitStep() * (scores[confrontTraitGrade(k) - 1] || 0);
      assert.equal(m.confrontValueOf(k, scale), Math.round(raw * 1.5) + trait, `${k}: stat half × 1.5 + its trait step`);
      n++;
    }
    assert.ok(n >= 10, `${n} TIMES monsters priced 1.5×`);
  });

  test('the priced value is what the groups, a submission and the bounty use', () => {
    const h = makeMatch({ mode: 'versus', difficulty: 'FUNNY', seats: vsSeats(), seed: 192, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.CONFRONT && m.confrontStage === 'target', { maxSteps: 3e6 }), 'reached the 狩猎期');
    const row = m.confrontGroups()[0].rows[0];
    assert.equal(row.value, m.confrontValueOf(row.key, m.confrontScale()), 'a group row carries the priced value');
    assert.equal(m.confrontSpent([{ enemyKey: row.key, gate: 'lower' }]), row.value, 'a submission costs the priced value');
    assert.ok(m.confrontBounty(row.key) >= 1, 'a bounty of at least 1');
    assert.deepEqual(h.logs.error, [], 'no engine errors');
  });
});
