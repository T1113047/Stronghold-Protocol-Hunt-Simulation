// 公示 (roster) rendering, user 2026-10-17: the 2V2 悬赏名单, the 同盟狩猎 投放公示 and the 事件期 词条公示 share ONE
// component (ui/rosterPanel.js: title + rows + the server countdown), and each overlay must show it DURING the hold while
// hiding its picking UI. game.js mounts ConfrontOverlay on `conf.active || conf.roster` and never draws the old
// post-battle clash at the same time. The server holds themselves are covered by test/match/confront-roster.test.js and
// test/match/event.test.js; this file keeps the client wiring and the public row payloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFRONT_ROSTER_MS, EVENT_ROSTER_MS } from '../../shared/constants.js';
import { eventRosterRows } from '../../public/js/ui/eventOverlay.js';
import { roundBuffRows } from '../../public/js/ui/roundBuffs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LANGS = ['en', 'ja', 'ko', 'zh-TW'];
const PACK = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(path.join(ROOT, 'public/i18n', `${l}.json`), 'utf8'))]));
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;

function inEveryPack(msgid) {
  for (const l of LANGS) {
    const v = PACK[l][msgid];
    assert.equal(typeof v, 'string', `${l}: missing ${JSON.stringify(msgid)}`);
    assert.ok(v.trim(), `${l}: empty ${JSON.stringify(msgid)}`);
    if (l === 'en') assert.ok(!HAN.test(v), `en: Chinese left in ${JSON.stringify(v)}`);
  }
}

const ROSTER = 'public/js/ui/rosterPanel.js';
const CONFRONT = 'public/js/ui/confrontOverlay.js';
const EVENT = 'public/js/ui/eventOverlay.js';
const GAME = 'public/js/screens/game.js';

test('the shared component: title + rows + the live server countdown (useTicker + secondsLeft)', () => {
  assert.equal(CONFRONT_ROSTER_MS, 5000);
  assert.equal(EVENT_ROSTER_MS, 5000);
  assert.ok(existsSync(path.join(ROOT, ROSTER)), 'public/js/ui/rosterPanel.js exists');
  const s = src(ROSTER);
  assert.match(s, /export function RosterPanel\(\{ title, micro = null, tone = 'gold', rows = \[\], until = 0/);
  assert.match(s, /const live = Number\(until\) > 0;/);
  assert.match(s, /useTicker\(live \? 250 : 0\);/);
  assert.match(s, /const remain = live \? secondsLeft\(until\) : null;/);
  assert.match(s, /data-testid="roster-timer"/);
  assert.match(s, /t\('\{s\} 秒后开始作战', \{ s: remain \}\)/);
  // heading rows and body rows, one <li> each
  assert.match(s, /rospov__group/);
  assert.match(s, /class=\$\{cx\('rospov__row'/);
  for (const k of ['{s} 秒后开始作战']) inEveryPack(k);
});

test('game.js mounts by conf.active || conf.roster, and the old clash never overlaps it', () => {
  const s = src(GAME);
  assert.match(s, /pub\?\.confront && \(pub\.confront\.active \|\| pub\.confront\.roster\) \? html`<\$\{ConfrontOverlay\}/);
  assert.match(s, /pub\?\.confront && !pub\.confront\.active && !pub\.confront\.roster \? html`<\$\{ConfrontClash\}/);
});

test('ConfrontOverlay: stage roster renders the list (2V2 + coop plans) and hides the pick / submit UI', () => {
  const s = src(CONFRONT);
  const rosterAt = s.indexOf("if (stage === 'roster')");
  const pickUiAt = s.indexOf('const add = (rec) =>');
  const mainAt = s.indexOf('return html`<div class="spov confov"');
  assert.ok(rosterAt > 0 && mainAt > rosterAt, 'the roster branch returns before the normal panel');
  assert.ok(pickUiAt > 0 && pickUiAt < rosterAt, 'the pick helpers stay above it (hooks keep their order)');
  assert.match(s, /import \{ RosterPanel \} from '\.\/rosterPanel\.js';/);
  // 2V2: the existing both-team data (subs + targets) through the shared row builder
  assert.match(s, /testid="confront-roster" rows=\$\{clashRows\(gd, pub, conf, myTeam\)\} until=\$\{until\}/);
  assert.match(s, /const subs = \(conf && conf\.subs\) \|\| \{\};/);
  assert.match(s, /t\('共 \{count\} 只', \{ count: picks\.length \}\)/);
  assert.match(s, /t\('赏金 \+{n}', \{ n: r\.sub\.coins \|\| 0 \}\)/);
  // co-op: roster.plans, one public row per alive player — P号 名字 · 类别 · 总值 · 只数, plus the round's monster entry
  assert.match(s, /if \(conf\.roster && conf\.roster\.coop\) return coopRosterPanel\(gd, pub, conf, players\);/);
  assert.match(s, /Array\.isArray\(roster\.plans\) \? roster\.plans : \[\]/);
  assert.match(s, /t\('总价值 \{v\}', \{ v: p\.value \}\)/);
  assert.match(s, /t\('共 \{count\} 只', \{ count: p\.count \}\)/);
  assert.match(s, /testid="coop-roster"/);
  assert.match(s, /testid="roster-foe"/);
  assert.match(s, /conf\.round != null \? conf\.round : pub\.round/, 'the coop view carries no round: fall back to pub.round');
  assert.match(s, /eventFoeCard\(foe\)/);
  assert.match(s, /eliteEffect\(elite\.attr\)/);
  // the old post-battle board is now the same shared component (no second copy of the row markup)
  assert.match(s, /testid="confront-clash" rows=\$\{rows\}/);
  assert.match(s, /function clashRows\(gd, pub, conf, myTeam\)/);
});

test('EventOverlay: stage roster shows 词条公示 (who got which pack + its entries) and hides the pick UI', () => {
  const s = src(EVENT);
  const branchAt = s.indexOf("if (ally.stage === 'roster' && ally.roster)");
  const pickUiAt = s.indexOf("cx('evotarget', st.sel && 'is-sel')");
  const mainAt = s.indexOf('return html`<div class="spov evov"');
  assert.ok(branchAt > 0 && mainAt > branchAt, 'the roster branch returns before the normal panel');
  assert.ok(pickUiAt > 0 && pickUiAt > branchAt, 'the target buttons are below it');
  assert.match(s, /import \{ RosterPanel \} from '\.\/rosterPanel\.js';/);
  assert.match(s, /testid="event-roster" rows=\$\{rosterRows\} until=\$\{Number\(ally\.roster\.until\)/);
  assert.match(s, /export function eventRosterRows\(pub, ally, index\)/);
  // 0.0.5 需求 1.5: the rows are the period's PACKS — 被选了几次 (selected) + 各收什么包 (packs)
  assert.match(s, /const packs = \(ally && ally\.packs\) \|\| \{\};/);
  assert.match(s, /const selected = \(ally && ally\.selected\) \|\| \{\};/);
  assert.match(s, /const label = t\(PACK_LABEL\[pack\.kind\] \|\| PACK_LABEL\.default\);/);
  assert.match(s, /t\('被选 \{n\} 次', \{ n: times \}\)/);
  assert.match(s, /t\('来自 \{name\}', \{ name: pLabel\(from\) \}\)/);
  // the receiver helper stays here (one implementation; ui/roundBuffs.js re-exports it)
  assert.match(s, /export function eventReceiver\(rec, targets = \{\}\)/);
  inEveryPack('词条公示');
  inEveryPack('被选 {n} 次');
  inEveryPack('来自 {name}');
});

test('eventRosterRows: one row per pack of this period — the receiver, 被选 n 次, 归属 + 来自, the entries', () => {
  const pub = { players: [
    { playerId: 'a', name: 'A', seat: 0 }, { playerId: 'b', name: 'B', seat: 1 },
  ] };
  const ally = {
    index: 2,
    selected: { a: 1, b: 0 },
    packs: {
      a: [{
        kind: 'opp', from: 'b', target: 'oppA', pack: 1,
        entries: [{ card: 1, key: 'whetstone', kind: 'up' }, { card: 5, key: 'heavy_crossbow', kind: 'mid' }, { card: 12, key: 'burden_armor', kind: 'mid' }],
      }],
      b: [{ kind: 'default', from: null, target: null, pack: 1, entries: [{ card: 2, key: 'tailwind', kind: 'mid' }] }],
    },
  };
  const rows = eventRosterRows(pub, ally, 2);
  assert.deepEqual(rows.map((r) => r.key), ['pack:a:1', 'pack:b:1'], 'one row per pack, in seat order');
  // unknown cards are skipped, never guessed
  const bad = eventRosterRows(pub, { index: 2, selected: { a: 1 }, packs: { a: [{ kind: 'own', from: 'a', pack: 1, entries: [{ key: 'nope' }] }] } }, 2);
  assert.equal(bad.length, 0);
  // no packs (an old / empty period) → no rows
  assert.equal(eventRosterRows(pub, { index: 2, selected: {}, packs: {} }, 2).length, 0);
});

test('the team panel strip (本回合词条) is independent of the roster stage and survives it', () => {
  const pub = {
    round: 8,
    players: [{ playerId: 'a', name: 'A', seat: 0 }],
    event: {
      ally: {
        round: 8, index: 2, active: true, stage: 'roster', roster: { until: 0, ms: EVENT_ROSTER_MS },
        targets: { a: { self: 'a', mate: null } },
        history: [{ round: 8, index: 2, playerId: 'a', target: 'self', targetId: 'a', card: 1, key: 'whetstone', mag: 2 }],
      },
      foe: { round: 8, card: 3, key: 'fangs', kind: 'unfavor', elite: null },
    },
  };
  assert.deepEqual(roundBuffRows(pub, 'a').map((r) => r.name), ['磨刃', '獠牙'], 'visible during the roster hold');
  pub.event.ally.stage = null;
  pub.event.ally.active = false;
  pub.event.ally.roster = null;
  assert.deepEqual(roundBuffRows(pub, 'a').map((r) => r.name), ['磨刃', '獠牙'], 'and after it, in this round\'s battle');
  const strip = src('public/js/ui/roundBuffs.js');
  assert.doesNotMatch(strip, /ally\.stage|ally\.active|roster/, 'the strip never gates on the roster');
  assert.match(strip, /import \{[^}]*eventReceiver[^}]*\} from '\.\/eventOverlay\.js';/);
  assert.doesNotMatch(strip, /export function eventReceiver/, 'one implementation, re-exported');
});
