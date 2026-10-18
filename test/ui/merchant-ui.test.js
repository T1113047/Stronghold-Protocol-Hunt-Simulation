// 商人「坎诺特」 UI (2V2, user 2026-10-17): the 赏金 desk ABOVE the 金币 card, its four withdrawals, the two-tap
// confirm and the strings. The numbers are server-authored (m.private.merchant) — the client never computes a cost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LANGS = ['en', 'ja', 'ko', 'zh-TW'];
const PACK = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(path.join(ROOT, 'public/i18n', `${l}.json`), 'utf8'))]));
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;
const inEveryPack = (k) => {
  for (const l of LANGS) {
    const v = PACK[l][k];
    assert.equal(typeof v, 'string', `${l}: missing ${JSON.stringify(k)}`);
    assert.ok(v.trim(), `${l}: empty ${JSON.stringify(k)}`);
    if (l === 'en') assert.ok(!HAN.test(v), `en: Chinese left in ${JSON.stringify(v)}`);
  }
};

test('the merchant button sits above the 金币 card and uses the official 坎诺特 avatar', () => {
  const shop = src('public/js/ui/shopBar.js');
  const merchant = src('public/js/ui/merchant.js');
  // rendered inside the funds card, BEFORE the coin hex (visually above) — and only when the server sends the panel
  assert.match(shop, /\$\{merchant \? html`<\$\{Merchant\} merchant=\$\{merchant\} editable=\$\{editable\} onWithdraw=\$\{onWithdraw\} vertical=\$\{true\} versus=\$\{versus\} remind=\$\{merchantRemind\} \/>` : null\}/);
  assert.ok(shop.indexOf('<${Merchant}') < shop.indexOf('class="funds__hex"'), 'the merchant is above the coin hex');
  assert.match(shop, /<span class="funds__label">\$\{t\('金币'\)\}<\/span>/, 'the funds card is labelled 金币');
  // the avatar is the strategy 坎诺特 (data/bands.json band_cannot -> icon_cannot) and reuses the band icon URL
  assert.match(merchant, /bandIconUrl\(gd\.m, 'band_cannot'\)/);
  assert.match(merchant, /data-testid="merchant-btn"/);
  assert.match(merchant, /data-testid="merchant-bank"/);
  // wired through the game screen and the action layer
  assert.match(src('public/js/screens/game.js'), /merchant=\$\{priv\?\.merchant \|\| null\} onWithdraw=\$\{\(gold\) => actions\.merchantWithdraw\(gold\)\}/);
  assert.match(src('public/js/ui/gameActions.js'), /merchantWithdraw: \(gold\) => act\('g\.confront\.withdraw', \{ gold \}/);
});

test('the last round with a non-zero bank pulses the merchant and names the reminder', () => {
  const merchant = src('public/js/ui/merchant.js');
  const shop = src('public/js/ui/shopBar.js');
  const game = src('public/js/screens/game.js');
  const css = src('public/css/screens/game-shop.css');
  assert.match(merchant, /remind && 'merchant--remind'/, 'the pulsing class');
  assert.match(merchant, /t\('最后一回合：还有赏金未取出，点击坎诺特兑换'\)/, 'the title explains the reminder');
  assert.match(merchant, /t\('最后回合 · 取出赏金'\)/, 'the label under the icon');
  assert.match(shop, /remind=\$\{merchantRemind\}/, 'ShopBar forwards the reminder');
  assert.match(game, /merchantRemind=\$\{!!priv\?\.merchant && Number\(priv\.merchant\.bank\) > 0 && Number\(pub\?\.round\) >= Number\(pub\?\.lastRound\)\}/,
    'only on the last round, only with a non-zero bank');
  assert.match(css, /\.merchant--remind \.merchant__btn \{[^}]*animation: merchant-remind/);
  assert.match(css, /@keyframes merchant-remind/);
  for (const k of ['最后一回合：还有赏金未取出，点击坎诺特兑换', '最后回合 · 取出赏金']) inEveryPack(k);
});

test('the dialog shows the rate, the bank, the round\'s maximum gold and every option\'s 赏金 cost', () => {
  const merchant = src('public/js/ui/merchant.js');
  for (const k of ['1 金币 = {cost} 赏金', '当前兑换率', '本回合最多可取 {n} 金币', '本回合取款不限', '取 {gold} 金币', '取 {gold} 金币（消耗 {cost} 赏金）', '全取出', '消耗 {cost} 赏金', '赏金', '赏金不足', '本回合的取款已达上限', '至少需要 {cost} 赏金才能取 1 金币', '再次点击确认']) {
    assert.ok(merchant.includes(`t('${k}'`), `the dialog renders ${k}`);
  }
  // M2: the round's takable gold is the server's `max` = min(left, floor(bank × rate)), not the bare per-round cap
  assert.match(merchant, /const max = merchant\.max != null && Number\.isFinite\(Number\(merchant\.max\)\) \? Math\.max\(0, Math\.trunc\(Number\(merchant\.max\)\)\) : left;/);
  assert.match(merchant, /<b class="num">\$\{max == null \? '∞' : max\}<\/b>/);
  // the four options, each disabled when the server says it does not fit; a tap arms, the second sends
  assert.match(merchant, /data-testid=\$\{opt\.all \? 'merchant-all' : `merchant-gold-\$\{opt\.gold\}`\}/);
  assert.match(merchant, /disabled=\$\{!canOpen \|\| !opt\.enabled\}/);
  assert.match(merchant, /if \(armed !== opt\.gold\) \{ setArmed\(opt\.gold\); return; \}/);
  assert.match(merchant, /onWithdraw\?\.\(opt\.gold\)/);
  // the client never prices anything itself: the cost comes from the server's options
  assert.ok(!/Math\.ceil|Math\.floor/.test(merchant), 'no client-side rounding');
  assert.match(merchant, /t\('消耗 \{cost\} 赏金', \{ cost: opt\.cost \}\)/, 'the cost is read from the server option');
  // the two words stay apart: 金币 (funds) and 赏金 (the bank)
  assert.match(merchant, /t\('存在坎诺特处的赏金'\)/, 'the bank is named 赏金, held at 坎诺特');
  assert.match(src('public/css/screens/game-shop.css'), /\.merchant__btn \{/);
  assert.match(src('public/css/screens/game-shop.css'), /\.merchant-dlg \.merchant__opts \{/);
});

test('every merchant string is translated in the four packs, and 赏金 is never translated as gold/coins', () => {
  for (const k of ['金币', '赏金', '存在坎诺特处的赏金', '坎诺特', '取 {gold} 金币', '取 {gold} 金币（消耗 {cost} 赏金）', '全取出', '消耗 {cost} 赏金', '1 金币 = {cost} 赏金', '当前兑换率', '本回合最多可取 {n} 金币', '本回合取款不限', '再次点击确认', '赏金不足', '本回合的取款已达上限', '至少需要 {cost} 赏金才能取 1 金币', '击杀对面投放的怪才能获得赏金，且只能在坎诺特处换成金币。', '击杀狩猎期的投放怪才能获得赏金，且只能在坎诺特处换成金币。']) inEveryPack(k);
  assert.equal(PACK.en['赏金'], 'Bounty');
  assert.ok(!/gold|coin/i.test(PACK.en['赏金']), 'en never calls 赏金 gold/coins');
  assert.ok(PACK.ja['赏金'].includes('賞金'));
  assert.ok(PACK.ko['赏金'].includes('현상금'));
  assert.ok(PACK['zh-TW']['赏金'].includes('賞金'));
  assert.equal(PACK.en['金币'], 'Gold');
});
