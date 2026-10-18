// The text/UI audit's remaining items (local-ext/文本与UI审查-狩猎版-01.md), so they cannot slip back:
//   R3  the 狩猎期 shows the game data's localized type / monster names, never the server's raw Chinese
//   R5  the strategy card's "已选择" corner badge follows the language (<html lang>, :lang() rules in draft.css)
//   R7  the 遠見 toast names its tag once (no "[Foresight] [Foresight] …")
//   R8  ／ 玩法说明 has a 2V2 chapter (VERSUS_HELP) — text, beside the 19 official co-op pages
//   R9  the "a hunted monster that leaks costs no target HP" rule is reachable from the client
//   R10 JA calls 特质 特質, not 堅守特性 (the 堅守 Alliance / 特性)
//   R13 the obsolete strings are gone from all four packs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LANGS = ['en', 'ja', 'ko', 'zh-TW'];
const PACK = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(path.join(ROOT, 'public/i18n', `${l}.json`), 'utf8'))]));
const src = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;

/** The msgid must be translated in every pack, and the English one must carry no Chinese. */
function inEveryPack(msgid) {
  for (const l of LANGS) {
    const v = PACK[l][msgid];
    assert.equal(typeof v, 'string', `${l}: missing ${JSON.stringify(msgid)}`);
    assert.ok(v.trim(), `${l}: empty ${JSON.stringify(msgid)}`);
    if (l === 'en') assert.ok(!HAN.test(v), `en: Chinese left in ${JSON.stringify(v)}`);
  }
}

test('R3: the 狩猎期 names come from the localized game data, not from the server text', () => {
  const overlay = src('public/js/ui/confrontOverlay.js');
  // the type tabs / group title / pool heading read gd.factions.types[g.id]; the rows read gd.enemy(key)
  assert.match(overlay, /gd\.factions\?\.types\?\.\[g\.id\]\?\.name/);
  assert.match(overlay, /gd\.factions\?\.types\?\.\[g\.id\]\?\.desc/);
  assert.match(overlay, /gd\.enemy\(key\)\?\.name/);
  assert.ok(!/\$\{rec\.name\}/.test(overlay), 'the chip/row name no longer renders the server text directly');
  assert.ok(!/typeLabel\(g\.name\)/.test(overlay), 'the type tab no longer reads the raw Chinese name');
  // and the data really has the translations (the mechanism the client relies on)
  for (const l of ['en', 'ja', 'ko']) {
    const f = JSON.parse(readFileSync(path.join(ROOT, 'data/i18n', `${l}.json`), 'utf8')).files.factions.types;
    assert.equal(typeof f.SPECIAL.name, 'string', `${l}: faction type names`);
    assert.equal(typeof JSON.parse(readFileSync(path.join(ROOT, 'data/i18n', `${l}.json`), 'utf8')).files.enemies.enemy_1000_gopro_2.name, 'string', `${l}: enemy names`);
  }
});

test('R5: the strategy card badge is language-aware (:lang()), and the wording is the packs\' own', () => {
  const css = src('public/css/screens/draft.css');
  assert.match(css, /\.dband\.is-mine::after \{ content: '已选择'/);
  for (const [l, word] of [['en', 'Selected'], ['ja', '選択済み'], ['ko', '선택 완료'], ['zh-TW', '已選擇']]) {
    assert.ok(css.includes(`.dband.is-mine:lang(${l})::after { content: '${word}'; }`), `${l} rule`);
    assert.equal(PACK[l]['已选择'], word, `${l}: the badge matches the pack's 已选择`);
  }
});

test('R7: the 遠見 toast names its tag once', () => {
  const k = '【远见】远见干员购买价格永久降低';
  assert.equal(PACK.en[k], "[Foresight] Foresight Operators' purchase price is permanently reduced");
  assert.equal(PACK.ja[k], '【先見】先見のオペレーターの購入価格が永続的に低下');
  assert.equal(PACK.ko[k], '[예견] 예견 오퍼레이터의 구매 가격이 영구적으로 감소');
  for (const l of LANGS) {
    const v = PACK[l][k];
    assert.ok(!v.includes('[Foresight] [Foresight]'), `${l}: doubled tag`);
    assert.ok(!v.includes('【先見】【先見】'), `${l}: doubled tag`);
    assert.ok(!v.includes('[예견] [예견]'), `${l}: doubled tag`);
  }
});

test('R8: 玩法说明 has a 2V2 chapter beside the 19 official pages, and every line is translated', async () => {
  const { GUIDE_CHAPTERS, VERSUS_HELP } = await import('../../public/js/ui/guide.js');
  assert.equal(GUIDE_CHAPTERS.reduce((n, c) => n + c.pages.length, 0), 19, 'the official page list is untouched');
  assert.ok(VERSUS_HELP.length >= 5, 'the 2V2 section has its rule lines');
  for (const k of VERSUS_HELP) inEveryPack(k);
  // the new text is wired into the viewer: a chapter tab and a text stage
  const guide = src('public/js/ui/guide.js');
  assert.match(guide, /HUNT 2V2<\/span>/);
  assert.match(guide, /<nav class="guide__chapters"/);
  assert.match(guide, /vs \? html`<div class="guide__stage guide__stage--text"><\$\{VersusHelp\} \/><\/div>`/);
});

test('R9: the "leaks cost no target HP" rule is shown in the client', () => {
  const k = '猎物漏过不扣目标生命';
  inEveryPack(k);
  assert.match(src('public/js/ui/confrontOverlay.js'), /t\('猎物漏过不扣目标生命'\)/, 'the 狩猎期 placement panel');
  assert.match(src('public/js/ui/guide.js'), /N_\('猎物漏过不扣目标生命'\)/, 'the 2V2 guide page');
});

test('R10: JA calls 特质 特質 — distinct from 特性 and from the 堅守 Alliance', () => {
  assert.equal(PACK.ja['特质'], '特質');
  for (const [k, v] of Object.entries(PACK.ja)) {
    if (typeof v !== 'string' || !/特质/.test(k)) continue;
    assert.ok(!v.includes('堅守特性'), `ja: ${JSON.stringify(k)} still says 堅守特性`);
  }
  // the 卫戍能力 label is a different term and stays as it is
  assert.equal(PACK.ja['卫戍能力'], '堅守特性');
});

test('R13: the obsolete strings are gone from all four packs (no silent dead keys)', () => {
  const gone = [
    "开始模拟前可调整干员携带的技能与模组，干员等级不可调整",
    "选择一组怪物，替换对面本回合 {p}% 的出怪",
    "第 {r} 回合 · 队内协商（对手看不到你的选择）",
    "你已提交，等待队伍完成",
    "选择一组怪物 → 点怪加入 → 排出怪顺序与门",
    "从{route}出",
    "中路",
    "空路",
    "上移",
    "下移",
    "将 {nChanged} 名干员的技能与模组恢复为默认配置？",
    "本机数据 · 仅记录本浏览器中你参与的对局",
  ];
  for (const l of LANGS) for (const k of gone) assert.ok(!(k in PACK[l]), `${l}: ${JSON.stringify(k)} should be gone`);
  // the ones still in use stay
  for (const k of ['上路', '下路', '标准模拟', '险境模拟', '绝境模拟', '终极模拟']) assert.equal(typeof PACK.en[k], 'string', `keep ${k}`);
});
