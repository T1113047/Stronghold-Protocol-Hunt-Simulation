// 本回合的词条 — the small strip under the team panel's last seat row (ui/roundBuffs.js, rendered by ui/teamPanel.js).
// The ALLY lines are "who received it" (m.public.event.ally.history + ally.targets[picker][target]), not "what I
// picked"; the monster line is this round's foe entry with its 强力属性 merged in. The names / effect numbers must be the
// 事件期 overlay's (ui/eventOverlay.js), never a second copy of the tables, and the strip disappears (not an empty row)
// outside a hunt mode or on a round without an event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundBuffRows, eventReceiver } from '../../public/js/ui/roundBuffs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LANGS = ['en', 'ja', 'ko', 'zh-TW'];
const PACK = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(read(`public/i18n/${l}.json`))]));

/** m.public of a co-op-less 2V2 event round: a, b on one team; c, d on the other. */
function pubWith(history, over = {}) {
  return {
    round: 8,
    phase: 'PREP',
    players: [
      { playerId: 'a', name: 'A', seat: 0 }, { playerId: 'b', name: 'B', seat: 1 },
      { playerId: 'c', name: 'C', seat: 2 }, { playerId: 'd', name: 'D', seat: 3 },
    ],
    event: {
      ally: {
        round: 8,
        index: 2,
        active: false,
        targets: {
          a: { self: 'a', mate: 'b', oppA: 'c', oppB: 'd' },
          b: { self: 'b', mate: 'a', oppA: 'c', oppB: 'd' },
          c: { self: 'c', mate: 'd', oppA: 'a', oppB: 'b' },
          d: { self: 'd', mate: 'c', oppA: 'a', oppB: 'b' },
        },
        available: {},
        picks: {},
        history,
      },
      foe: { round: 8, card: 3, key: 'fangs', kind: 'unfavor', elite: { share: 0.1, attr: 'swift', count: 2 } },
      ...over,
    },
  };
}

test('the strip lists the entries I RECEIVED this round — from my own pick and from other players — then the monster entry', () => {
  const pub = pubWith([
    // b gives their entry to their mate = a (me)
    { round: 8, index: 2, playerId: 'b', target: 'mate', targetId: 'a', card: 1, key: 'whetstone', kind: 'up', mag: 1 },
    // an opponent gives theirs to a (me) — the "目标" rule, not "my pick"
    { round: 8, index: 2, playerId: 'c', target: 'oppA', targetId: 'a', card: 3, key: 'armor_break', kind: 'up', mag: 1 },
    // my own entry at 自己 is doubled (mag 2, EVENT_SELF_MUL)
    { round: 8, index: 2, playerId: 'a', target: 'self', targetId: 'a', card: 4, key: 'blunted', kind: 'down', mag: 2 },
    // someone else's self entry: not mine, never shown
    { round: 8, index: 2, playerId: 'c', target: 'self', targetId: 'c', card: 1, key: 'whetstone', kind: 'up', mag: 2 },
    // an earlier round: already gone
    { round: 4, index: 1, playerId: 'b', target: 'mate', targetId: 'a', card: 2, key: 'tailwind', kind: 'up', mag: 1 },
  ]);
  const rows = roundBuffRows(pub, 'a');
  assert.deepEqual(rows.map((r) => r.kind), ['ally', 'ally', 'ally', 'foe']);
  assert.deepEqual(rows.map((r) => r.name), ['磨刃', '破甲', '钝口', '獠牙']);
  assert.deepEqual(rows.slice(0, 3).map((r) => r.effect), ['攻击力 +20%', '无视防御 +22%', '攻击力 -18%']);
  assert.equal(rows[3].effect, '敌人攻击力 ×1.15', 'the monster entry, in the overlay\'s wording');
  assert.equal(rows[3].elite, '本回合 10% 的敌人带「疾行」', '强力属性 merged into the monster line');
  assert.equal(rows[0].title, '磨刃 攻击力 +20%', 'the full line stays in the title when CSS truncates the text');
  assert.equal(rows[0].left, 4, 'four rounds left on the pick round');
  assert.equal(rows[3].left, 1, 'the monster entry is this round only');
});

test('the receiver is ally.targets[picker][target]; a missing map falls back to the record\'s targetId; no target means no row', () => {
  assert.equal(eventReceiver({ playerId: 'b', target: 'mate', targetId: 'a' }, { b: { mate: 'a' } }), 'a');
  // the picker / key is no longer in the map (a co-op mate was recomputed after a teammate left): the server's own
  // targetId is the record's authority
  assert.equal(eventReceiver({ playerId: 'gone', target: 'mate', targetId: 'a' }, {}), 'a');
  // the map wins over a stale targetId
  assert.equal(eventReceiver({ playerId: 'b', target: 'mate', targetId: 'd' }, { b: { mate: 'a' } }), 'a');
  // an old record from before the server sent `target`: degraded to "not shown", never guessed
  assert.equal(eventReceiver({ playerId: 'b', targetId: 'a' }, { b: { mate: 'a' } }), null);
  const rows = roundBuffRows(pubWith([{ round: 8, index: 2, playerId: 'b', targetId: 'a', card: 1, key: 'whetstone' }]), 'a');
  assert.deepEqual(rows.map((r) => r.kind), ['foe'], 'the ally line is dropped, the monster line still renders');
});

test('an ally entry shows while in force (picked … picked+3) and disappears at picked+4', () => {
  const pub = pubWith([]);
  pub.event.foe = null;
  const rec = { round: 5, index: 1, playerId: 'b', target: 'mate', targetId: 'a', card: 1, key: 'whetstone', kind: 'up', mag: 1 };
  pub.event.ally.history = [rec];
  // the server publishes the window (m.public.event.ally.duration); the shared constant is the fallback
  for (const [round, shown] of [[5, true], [6, true], [7, true], [8, true], [9, false]]) {
    pub.round = round;
    pub.event.ally.round = round;
    const rows = roundBuffRows(pub, 'a');
    assert.equal(rows.length, shown ? 1 : 0, `R${round} ${shown ? 'still in force' : 'expired'}`);
    if (shown) assert.equal(rows[0].name, '磨刃');
  }
  pub.round = 8;
  pub.event.ally.round = 8;
  assert.equal(roundBuffRows(pub, 'a').length, 1, 'without an explicit duration the constant (4) applies');
  pub.event.ally.duration = 2;
  assert.deepEqual(roundBuffRows(pub, 'a'), [], 'the server duration wins when present');
});

test('nothing renders outside a hunt mode, without an event this round, or for a seat that received nothing', () => {
  assert.deepEqual(roundBuffRows(null, 'a'), []);
  assert.deepEqual(roundBuffRows({ round: 8 }, 'a'), [], 'no m.public.event — a non-hunt mode');
  const staleFoe = pubWith([], { foe: { round: 4, card: 3, key: 'fangs' } });
  assert.deepEqual(roundBuffRows(staleFoe, 'a'), [], 'the previous event round\'s monster entry is not this round\'s');
  const mine = pubWith([]);
  mine.event.ally.history = [{ round: 8, index: 2, playerId: 'c', target: 'oppB', targetId: 'b', card: 1, key: 'whetstone' }];
  mine.event.foe = null;
  assert.deepEqual(roundBuffRows(mine, 'a'), [], 'an entry given to a teammate is not mine');
});

test('经济类负面词条（空手而归）在 P4 词条条只显示 1 回合，弹窗显示持续 1 回合', () => {
  const pub = pubWith([{ round: 8, index: 2, playerId: 'a', target: 'self', targetId: 'a', card: 23, key: 'empty_handed', kind: 'down', mag: 2 }]);
  pub.event.foe = null;
  const r8 = roundBuffRows(pub, 'a');
  assert.equal(r8.length, 1);
  assert.equal(r8[0].detail.duration, 1);
  assert.equal(r8[0].effect, '每回合金币 -4', 'self doubles the -2');
  pub.round = 9;
  pub.event.ally.round = 9;
  assert.deepEqual(roundBuffRows(pub, 'a'), [], 'the economy debuff is gone after its own round');
});

test('the component reuses the 事件期 overlay: no second card table, no new msgid, one line per row under P4', () => {
  const src = read('public/js/ui/roundBuffs.js');
  const team = read('public/js/ui/teamPanel.js');
  const game = read('public/js/screens/game.js');
  const overlay = read('public/js/ui/eventOverlay.js');
  const css = read('public/css/screens/game.css');
  assert.match(src, /from '\.\/eventOverlay\.js'/, 'the names / effects come from ui/eventOverlay.js');
  for (const name of ['ALLY_NAMES', 'FOE_NAMES', 'allyEffect', 'foeEffect', 'eventAllyCard', 'eventFoeCard']) {
    assert.match(src, new RegExp(`\\b${name}\\b`), `roundBuffs imports ${name}`);
    assert.match(overlay, new RegExp(`export (const|function) ${name}\\b`), `eventOverlay exports ${name}`);
  }
  assert.doesNotMatch(src, /EVENT_CARDS|EVENT_FOE_CARDS|EVENT_FOE_ELITES/, 'no duplicated card tables');
  // every literal msgid in the strip is already in all four packs — this change adds none
  const msgids = [...src.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]);
  for (const id of msgids) for (const l of LANGS) assert.equal(typeof PACK[l][id], 'string', `${l}: missing ${id}`);
  // the panel renders it after the seat rows and passes the two props it needs
  assert.ok(team.indexOf('<${RoundBuffs}') > team.indexOf('players.map'), 'below the P4 row');
  assert.ok(team.indexOf('<${RoundBuffs}') < team.indexOf('</aside>'));
  assert.match(team, /<\$\{RoundBuffs\} pub=\$\{pub\} myId=\$\{myId\} \/>/);
  assert.match(game, /<\$\{TeamPanel\}[^\n]*pub=\$\{pub\}[^\n]*myId=\$\{myId\}/, 'game.js already hands pub / myId to TeamPanel');
  // one line, small, truncated; a thin border and the amber / red mark, no layout of its own
  assert.match(css, /\/\* ---- \[EVBUFF\]/);
  assert.match(css, /\.rbuff \{[^}]*font-size: max\(calc\(\.10 \* var\(--t\)\), 10px\)[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis/s);
  assert.match(css, /\.rbuffs \{[^}]*max-width: min\(2\.5rem, 90vw\)[^}]*pointer-events: auto/);
  assert.match(css, /\.rbuff__left \{/);
});

test('each strip row carries the 词条说明 popup payload: class icon, kind tone, base vs doubled effect, rounds left', () => {
  const pub = pubWith([
    { round: 8, index: 2, playerId: 'a', target: 'self', targetId: 'a', card: 4, key: 'blunted', kind: 'down', mag: 2 },
    { round: 6, index: 1, playerId: 'b', target: 'mate', targetId: 'a', card: 2, key: 'tailwind', kind: 'up', mag: 1 },
  ]);
  const rows = roundBuffRows(pub, 'a');
  const ally = rows.find((r) => r.name === '钝口');
  assert.ok(ally.detail, 'an ally row has the popup payload');
  assert.equal(ally.detail.icon, 'sword', 'output entries use the sword icon');
  assert.equal(ally.detail.tone, 'red', 'a down entry is red');
  assert.equal(ally.detail.classLabel, '输出');
  assert.equal(ally.detail.base, '攻击力 -9%', 'the base effect at ×1');
  assert.equal(ally.detail.now, '攻击力 -18%', 'self doubles it');
  assert.equal(ally.detail.mag, 2);
  assert.equal(ally.detail.picked, 8);
  assert.equal(ally.detail.round, 8);
  assert.equal(ally.detail.targetLabel, '自己');
  const tail = rows.find((r) => r.name === '追风');
  assert.equal(tail.detail.picked, 6);
  assert.equal(tail.detail.mag, 1, 'a mate\'s entry stays at ×1');
  const foe = rows.find((r) => r.kind === 'foe');
  assert.equal(foe.detail.icon, 'sword');
  assert.equal(foe.detail.tone, 'red', 'an unfavourable monster entry is red');
  assert.equal(foe.detail.elite.name, '疾行');
  assert.equal(foe.detail.elite.share, 10);
  assert.equal(foe.detail.elite.count, 2);
  assert.equal(foe.detail.elite.effect, '敌人移动速度 ×1.2');
  // the popup is mounted once at the game root, above the event overlay's stacking context, not inside the HUD strip
  const game = read('public/js/screens/game.js');
  const detail = read('public/js/ui/entryDetail.js');
  assert.match(game, /useEntryDetail\(\)/);
  assert.match(game, /<\$\{EntryDetailDialog\} detail=\$\{entryDetail\} onClose=\$\{closeEntryDetail\} \/>/);
  assert.match(detail, /export function openEntryDetail/);
  assert.match(detail, /EVENT_DURATION_ROUNDS/);
  assert.match(detail, /选择「自己」时所有数值 ×2/);
  assert.match(detail, /多个词条按环境乘区相乘/);
});
