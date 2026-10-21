// 狩猎期 boss 选择页 (2V2, user 2026-10-21): on the EVENT rounds (R4 / R8 / R13) the type card row gains a 5th cell
// named `boss` (m.public.confront.bossPool) that opens the boss 选择页 —
//   #1 the cell renders ONLY when the round sends a boss pool (nothing else of the 4 / 7 type cards changes);
//   #2 a candidate is taken at most once (a taken one greys out, tap again to cancel), any number in total, the
//      selection resets every round;
//   #3 the picked bosses ride along as `bosses` in the g.confront payload (optional — absent when none);
//   #4 the page carries the 特别说明 (kill pays gold directly, never through the 坎诺特 bounty ledger; leaks pay
//      nothing; a boss only enters at the very back of the wave);
//   #5 a boss never spends budget — the budget bar keeps counting only `picks`, the `boss ×N` summary is its own line;
//   #6 every user-visible string is a t() msgid present in all four language packs.
// The bounty / budget rules themselves are covered by test/match/versus.test.js; this file keeps the CLIENT wiring and
// the strings. Source-level assertions, like test/ui/confront-ui.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const OVERLAY = src('public/js/ui/confrontOverlay.js');
const ACTIONS = src('public/js/ui/gameActions.js');
const SCREEN = src('public/js/screens/game.js');
const CSS = src('public/css/screens/game-panels.css');
const LANGS = ['en', 'ja', 'ko', 'zh-TW'];
const PACK = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(path.join(ROOT, 'public/i18n', `${l}.json`), 'utf8'))]));
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;
/** The new msgids of this feature (also asserted one by one below). */
const NOTE = 'boss 被击杀后，击杀方按机变口径直接获得金币（不进坎诺特赏金账本），漏掉不给；boss 只会从波次最后入场。';
const MSGIDS = [
  'boss',
  'boss 已选 {n}/{cap}',
  'boss 候选（点击选择，每种至多选 1 次；本轮上限 {cap} 个）',
  '金币 {n}',
  NOTE,
  '选满上限自动返回；已选的再点一下取消；每轮重置',
];

/** The msgid must be translated in every pack (the English one carries no Chinese). */
function inEveryPack(msgid) {
  for (const l of LANGS) {
    const v = PACK[l][msgid];
    assert.equal(typeof v, 'string', `${l}: missing ${JSON.stringify(msgid)}`);
    assert.ok(v.trim(), `${l}: empty ${JSON.stringify(msgid)}`);
    if (l === 'en') assert.ok(!HAN.test(v), `en: Chinese left in ${JSON.stringify(v)}`);
    const params = [...msgid.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    for (const p of params) assert.ok(v.includes(`{${p}}`), `${l}: ${JSON.stringify(msgid)} drops {${p}}`);
  }
}

test('#1 the 5th cell renders only with a boss pool; the type cards are untouched', () => {
  // the pool comes from the round's public state and is empty (so the cell is absent) on every other round
  assert.match(OVERLAY, /const bossPool = Array\.isArray\(conf\.bossPool\) \? conf\.bossPool : \[\];/);
  assert.match(OVERLAY, /\$\{bossPool\.length \? html`<button key="boss" type="button" class=\$\{cx\('confgroup', 'confgroup--boss', bossPage && 'is-sel'\)\} disabled=\$\{submitted\}/);
  assert.match(OVERLAY, /data-testid="confront-boss-cell" title=\$\{t\('boss 候选（点击选择，每种至多选 1 次；本轮上限 \{cap\} 个）', \{ cap: bossCap \}\)\} onClick=\$\{\(\) => setBossPage\(true\)\}/);
  // its name is `boss`, its meta is the boss ×N summary, its icons are the pool's own candidates (name + gold in the title)
  assert.match(OVERLAY, /<b class="confgroup__name confgroup__name--boss">\$\{t\('boss'\)\}<\/b>/);
  assert.match(OVERLAY, /<span class="confgroup__meta num">\$\{t\('boss 已选 \{n\}\/\{cap\}', \{ n: bosses\.length, cap: bossCap \}\)\}<\/span>/);
  assert.match(OVERLAY, /title=\$\{`\$\{enemyName\(gd, b\.key, b\.name\)\}（\$\{t\('金币 \{n\}', \{ n: b\.coin \}\)\}）`\}/);
  // the 4 / 7 type cards render exactly as before — only their selected state and click know about the boss page
  assert.match(OVERLAY, /const isSel = !bossPage && group === i \+ 1;/);
  assert.match(OVERLAY, /onClick=\$\{\(\) => \{ setBossPage\(false\); setGroup\(i \+ 1\); \}\}/);
  assert.match(OVERLAY, /\$\{bossPage \? html`<\$\{BossPanel\} m=\$\{m\} pool=\$\{bossPool\} bosses=\$\{bosses\} cap=\$\{bossCap\} submitted=\$\{submitted\} onToggle=\$\{toggleBoss\} \/>`\s*: group != null \? html`<div class="confov__body">/);
  assert.match(OVERLAY, /: html`<p class="confov__hint t-dim">\$\{t\('先选择上面的一个怪物组'\)\}<\/p>`\}/);
});

test('#2 one pick per candidate, the cap greys the rest and closes the page (E1 = 1 / E2 = 2 / E3 = 3)', () => {
  // one pick per key: the toggle only appends when the key is not taken yet; at the CAP (the event's ordinal,
  // user 2026-10-21 after playtest) it appends no more and the page returns to the normal panel by itself
  assert.match(OVERLAY, /const taken = bosses\.some\(\(x\) => x\.enemyKey === b\.key\);/);
  assert.match(OVERLAY, /if \(!taken && bossCap > 0 && bosses\.length >= bossCap\) return;/);
  assert.match(OVERLAY, /const next = taken \? bosses\.filter\(\(x\) => x\.enemyKey !== b\.key\) : \[\.\.\.bosses, \{ enemyKey: b\.key, gate: 'lower' \}\];/);
  assert.match(OVERLAY, /if \(!taken && bossCap > 0 && next\.length >= bossCap\) setBossPage\(false\);/);
  assert.match(OVERLAY, /if \(submitted \|\| busy\) return;/);
  // the taken chip greys but stays tappable (a tap cancels); the ones locked by the cap are disabled
  assert.match(OVERLAY, /class=\$\{cx\('cchip', 'cchip--boss', picked && 'is-picked', !picked && atCap && 'is-locked'\)\}/);
  assert.match(OVERLAY, /aria-pressed=\$\{picked \? 'true' : 'false'\} data-testid="confront-boss-chip"/);
  assert.match(OVERLAY, /disabled=\$\{submitted \|\| \(!picked && atCap\)\} aria-pressed=/);
  assert.match(CSS, /\.cchip--boss\.is-picked \{ opacity: \.45; filter: grayscale\(\.55\); border-color: var\(--gold-2\); \}/);
  assert.match(CSS, /\.cchip--boss\.is-locked \{ opacity: \.38; filter: grayscale\(\.7\); cursor: not-allowed; \}/);
  // the page says how the toggle works, and every round starts clean
  assert.match(OVERLAY, /t\('选满上限自动返回；已选的再点一下取消；每轮重置'\)/);
  assert.match(OVERLAY, /useEffect\(\(\) => \{ setGroup\(null\); setPicks\(\[\]\); setPosition\('mid'\); setBosses\(\[\]\); setBossPage\(false\); \}, \[conf && conf\.round\]\);/);
});

test('#3 the picked bosses ride along in the g.confront payload (optional, absent when none)', () => {
  assert.match(OVERLAY, /onConfirm\(group, position, picks, bosses\);/);
  assert.match(SCREEN, /onConfirm=\$\{async \(group, position, picks, bosses\) => \{ setConfBusy\(true\); try \{ await actions\.confront\(group, position, picks, bosses\); \}/);
  assert.match(ACTIONS, /confront: \(group, position, picks, bosses\) => \{/);
  assert.match(ACTIONS, /const sent = \(bosses \|\| \[\]\)\.map\(\(b\) => \(\{ enemyKey: b\.enemyKey, gate: b\.gate === 'upper' \? 'upper' : 'lower' \}\)\);/);
  assert.match(ACTIONS, /if \(sent\.length\) payload\.bosses = sent;/);
  // the picks payload itself is unchanged (same mapping, same shape)
  assert.match(ACTIONS, /const payload = \{ group, position, picks: \(picks \|\| \[\]\)\.map\(\(p\) => \(\{ enemyKey: p\.enemyKey, gate: p\.gate === 'upper' \? 'upper' : 'lower' \}\)\) \};/);
});

test('#3b the g.confront message itself carries the bosses (and stays as it was when none is picked)', async () => {
  const { net } = await import('../../public/js/net.js');
  const { actions } = await import('../../public/js/ui/gameActions.js');
  const sent = [];
  const prev = net.request;
  net.request = (type, fields) => { sent.push({ type, fields }); return Promise.resolve({ ok: true }); };
  try {
    await actions.confront(2, 'mid', [{ enemyKey: 'm1', gate: 'upper' }, { enemyKey: 'm2', gate: 'lower' }],
      [{ enemyKey: 'boss1', gate: 'lower' }, { enemyKey: 'boss2' }]);
    assert.equal(sent[0].type, 'g.confront');
    assert.deepEqual(sent[0].fields, {
      group: 2,
      position: 'mid',
      picks: [{ enemyKey: 'm1', gate: 'upper' }, { enemyKey: 'm2', gate: 'lower' }],
      bosses: [{ enemyKey: 'boss1', gate: 'lower' }, { enemyKey: 'boss2', gate: 'lower' }],
    }, 'the bosses ride along with the untouched picks payload, each on its gate');
    await actions.confront(1, 'front', [{ enemyKey: 'm1', gate: 'lower' }]);
    assert.ok(!('bosses' in sent[1].fields), 'no boss picked → the field is not sent at all');
    await actions.confront(1, 'front', [{ enemyKey: 'm1', gate: 'lower' }], []);
    assert.ok(!('bosses' in sent[2].fields), 'an empty list is the same as none (the contract takes both)');
  } finally {
    net.request = prev;
  }
});

test('#4 the page carries the 特别说明: gold straight to the killer, never the 坎诺特 bounty ledger, and last in the wave', () => {
  assert.match(OVERLAY, /class="confovb__note" data-testid="confront-boss-note"/);
  assert.ok(OVERLAY.includes(`t('${NOTE}')`), 'the 特别说明 is one t() msgid');
  assert.match(OVERLAY, /<\$\{Icon\} name="warn" \/>/);
  for (const l of LANGS) {
    assert.ok(PACK[l][NOTE], `${l}: the note is translated`);
    assert.match(PACK[l][NOTE], /gold|ゴールド|골드|金幣/i, `${l}: the note says the kill pays gold`);
    assert.match(PACK[l][NOTE], /last|最後|마지막|最後/, `${l}: the note says a boss enters last`);
  }
  // prominent: its own gold-framed block, one step ABOVE body text
  assert.match(CSS, /\.confovb__note \{ display: flex; align-items: flex-start; gap: \.08rem; margin: 0; padding: \.08rem \.12rem; flex: 0 0 auto;/);
  assert.match(CSS, /border: 1px solid var\(--gold-2\); border-left-width: 3px; background: rgba\(242, 189, 62, \.12\); color: #ffe6ad;/);
  assert.match(CSS, /\.confovb__note \{[^}]*font-size: max\(calc\(\.15 \* var\(--t\)\), 10px\); font-weight: 700;/s);
});

test('#5 a boss costs no budget: the bar counts only picks, the boss ×N summary is its own line', () => {
  // the budget walk reads only `picks` (the bosses live in their own state and never touch `spent` / `remaining`)
  assert.match(OVERLAY, /const spent = picks\.reduce\(\(s, p\) => s \+ valOf\(p\.enemyKey\), 0\);/);
  assert.ok(!/spent = .*bosses/.test(OVERLAY), 'no boss in the spent value');
  assert.match(OVERLAY, /<h3 class="confov__h">\$\{t\('已放置（出怪顺序）'\)\} <span class="num">\$\{picks\.length\} · \$\{spent\}\/\$\{budget\}<\/span><\/h3>/);
  // …and the summary is a line of its own, shown on the event rounds only
  assert.match(OVERLAY, /class="confovb__sum" data-testid="confront-boss-summary">\$\{t\('boss 已选 \{n\}\/\{cap\}', \{ n: bosses\.length, cap: bossCap \}\)\}<\/p>/);
  assert.match(OVERLAY, /\$\{bossPool\.length \? html`<p class="confovb__sum"/);
  assert.match(CSS, /\.confovb__sum \{ margin: \.05rem 0 0; padding: \.03rem \.08rem; flex: 0 0 auto; border-left: 2px solid var\(--gold-2\);/);
});

test('#6 every user-visible string of the page is a t() msgid in all four packs', () => {
  for (const k of MSGIDS) {
    inEveryPack(k);
    assert.ok(OVERLAY.includes(`t('${k}')`) || OVERLAY.includes(`t('${k}',`), `the overlay shows ${JSON.stringify(k)} through t()`);
  }
  // the candidate chip shows name + gold through t(), the cell name too
  assert.match(OVERLAY, /<span class="cchip__val num">\$\{t\('金币 \{n\}', \{ n: b\.coin \}\)\}<\/span>/);
  // small text carries the repo's px floor, and the panel fits a landscape phone without overflowing
  assert.match(CSS, /\.cchip--boss \.cchip__val \{ color: var\(--gold-2\); font-size: max\(calc\(\.11 \* var\(--t\)\), 10px\); font-weight: 700; \}/);
  assert.match(CSS, /\.confovb__tip \{ margin: 0; font-size: max\(calc\(\.12 \* var\(--t\)\), 10px\); flex: 0 0 auto; \}/);
  assert.match(CSS, /\.confovb__sum \{[^}]*font-size: max\(calc\(\.14 \* var\(--t\)\), 10px\);/s);
  assert.match(CSS, /@media \(max-width: 720px\) \{\s*\.confovb__note \{ font-size: max\(calc\(\.13 \* var\(--t\)\), 10px\); padding: \.06rem \.08rem; \}/);
  assert.match(CSS, /\.confov__chips\.confovb__chips \{ min-height: 0; max-height: 30vh; \}/);
});
