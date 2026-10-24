// 事件期 (PHASE.EVENT) UI, 2026-10-17 (0.0.5 rework 2026-10-24): the client half of the 2V2 event period — the panel
// that shows the round's monster entry and 强力属性 BEFORE anyone picks, the four targets (对面 A / 对面 B / 队友 / 自己)
// with their names and P numbers, the picked-pack result line and the match's three selections. The server rule (three
// periods, a target repeatable since 0.0.5, one pack per selection, 20 s, the AI's spread auto-pick) lives in
// server/match/match/event.js and test/match/event.test.js; this file keeps the CLIENT wiring, the testids and the
// strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PHASE, EVENT_TARGETS, EVENT_PICK_SECONDS, EVENT_FINAL_ROUND, EVENT_CARDS, EVENT_FOE_CARDS, eventRoundsFor,
} from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LANGS = ['en', 'ja', 'ko', 'zh-TW'];
const PACK = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(path.join(ROOT, 'public/i18n', `${l}.json`), 'utf8'))]));
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;

const OVERLAY = src('public/js/ui/eventOverlay.js');
const GAME = src('public/js/screens/game.js');
const ACTIONS = src('public/js/ui/gameActions.js');
const CSS = src('public/css/screens/game-panels.css');

/** The msgid must be translated in every pack (the English one carries no Chinese). */
function inEveryPack(msgid) {
  for (const l of LANGS) {
    const v = PACK[l][msgid];
    assert.equal(typeof v, 'string', `${l}: missing ${JSON.stringify(msgid)}`);
    assert.ok(v.trim(), `${l}: empty ${JSON.stringify(msgid)}`);
    if (l === 'en') assert.ok(!HAN.test(v), `en: Chinese left in ${JSON.stringify(v)}`);
  }
}

test('the panel exists for PHASE.EVENT with its title, the 第 n/3 次 line and a live 20 s countdown', () => {
  assert.equal(PHASE.EVENT, 'EVENT');
  assert.equal(EVENT_PICK_SECONDS, 20, 'the server window is 20 s');
  // three periods per match, E3 the R13 最终狩猎 (the server's eventRoundsFor)
  assert.deepEqual(eventRoundsFor(4), [4, 8, EVENT_FINAL_ROUND]);
  assert.deepEqual(eventRoundsFor(6), [6, 10, EVENT_FINAL_ROUND]);
  assert.equal(eventRoundsFor(null).length, 0, 'no event period without a hunt mode (2V2 or 同盟狩猎)');
  assert.match(OVERLAY, /export function EventOverlay\(\{ pub, busy = false, onPick \}\)/);
  assert.match(OVERLAY, /data-testid="event-phase"/);
  assert.match(OVERLAY, /role="dialog" aria-label=\$\{t\('事件期'\)\}/);
  assert.match(OVERLAY, /<h2 class="spov__title"><span class="spov__name">/);
  assert.match(OVERLAY, /EVENT PHASE \/\/ \$\{t\('事件期'\)\}<\/\$\{MicroLabel\}>\$\{t\('事件期'\)\}<\/span>/);
  assert.match(OVERLAY, /t\('第 \{n\}\/\{total\} 次', \{ n: index, total \}\)/);
  // the countdown: the server deadline of THIS period (ally.deadline), EVENT_PICK_SECONDS as the gauge total
  assert.match(OVERLAY, /<div class="spov__timer" data-testid="event-timer">/);
  assert.match(OVERLAY, /<\$\{Countdown\} deadline=\$\{deadline\} total=\$\{EVENT_PICK_SECONDS\} size="sm" \/>/);
  assert.match(OVERLAY, /const deadline = Number\(ally\.deadline\) > 0 \? ally\.deadline\s*\n\s*: \(Number\(pub\.deadline\) > 0 \? pub\.deadline : 0\);/);
  // no panel outside the phase (ally.active)
  assert.match(OVERLAY, /if \(!ally \|\| !ally\.active\) return null;/);
});

test('the four targets: 对面 A / 对面 B / 队友 / 自己, each with a name, a P number and its own testid', () => {
  // the server's keys and the panel's four literal testids
  assert.deepEqual([...EVENT_TARGETS], ['self', 'mate', 'oppA', 'oppB']);
  for (const key of ['oppA', 'oppB', 'mate', 'self']) {
    assert.match(OVERLAY, new RegExp(`testid: 'event-target-${key}'`), `event-target-${key}`);
  }
  assert.match(OVERLAY, /data-testid=\$\{testid\}/);
  // the panel lists the opponents first, the teammate and 自己 last
  assert.match(OVERLAY, /const TARGETS = \[\s*\{ key: 'oppA'[\s\S]*?\{ key: 'oppB'[\s\S]*?\{ key: 'mate'[\s\S]*?\{ key: 'self'/);
  // name + P number (P1 / P2 …) and the target-kind label
  assert.match(OVERLAY, /<span class="evotarget__label">\$\{t\(label\)\}<\/span>/);
  assert.match(OVERLAY, /<span class="evotarget__name">\$\{st\.player \? \(st\.player\.name \|\| '\?'\) : '—'\}<\/span>/);
  assert.match(OVERLAY, /<span class="evotarget__p confseat num">\$\{pNo\(st\.player\)\}<\/span>/);
  assert.match(OVERLAY, /const pNo = \(p\) => \(p && Number\.isInteger\(p\.seat\) \? `P\$\{p\.seat \+ 1\}` : ''\);/);
  for (const k of ['对面 A', '对面 B', '队友', '自己']) inEveryPack(k);
});

test('the round\'s monster entry and 强力属性 come first, before the targets, with name + effect', () => {
  const foeAt = OVERLAY.indexOf('data-testid="event-foe"');
  const targetsAt = OVERLAY.indexOf("cx('evov__targets'");
  assert.ok(foeAt > 0 && targetsAt > foeAt, 'the monster block is above the target buttons');
  assert.match(OVERLAY, /data-testid="event-foe"/);
  assert.match(OVERLAY, /data-testid="event-elite"/);
  assert.match(OVERLAY, /t\('本回合的怪物词条'\)/);
  assert.match(OVERLAY, /t\('强力属性'\)/);
  // the name is the server's Chinese msgid mapped from `key` (id as the fallback)
  assert.match(OVERLAY, /const foeCard = foe \? \(FOE_BY_KEY\.get\(foe\.key\) \|\| FOE_BY_ID\.get\(foe\.card\) \|\| null\) : null;/);
  assert.match(OVERLAY, /<b class="evov__name">\$\{t\(FOE_NAMES\[foeCard\.key\] \|\| foeCard\.key\)\}<\/b>/);
  assert.match(OVERLAY, /<span class="evov__eff">\$\{foeEffect\(foeCard\)\}<\/span>/);
  // 本回合 {share}% 的敌人带「{attr}」，共 {count} 只 — the share is a ratio in the protocol (0.1…0.25)
  assert.match(OVERLAY, /const eliteShare = elite \? Math\.round\(\(Number\(elite\.share\) \|\| 0\) \* 100\) : 0;/);
  assert.match(OVERLAY, /t\('本回合 \{share\}% 的敌人带「\{attr\}」', \{ share: eliteShare, attr: t\(eliteName\) \}\)/);
  assert.match(OVERLAY, /t\('共 \{count\} 只', \{ count: Number\(elite\.count\) \|\| 0 \}\)/);
  assert.match(OVERLAY, /<span class="evov__eff">\$\{eliteEffect\(elite\.attr\)\}<\/span>/);
  // every card of both channels has its msgid mapping
  for (const c of EVENT_CARDS) assert.match(OVERLAY, new RegExp(`${c.key}: N_\\('`), `ally entry ${c.key}`);
  for (const c of EVENT_FOE_CARDS) assert.match(OVERLAY, new RegExp(`${c.key}: N_\\('`), `monster entry ${c.key}`);
  // 0.0.5 需求 2: every effect line names its subject (「X 的干员」/「X 的敌人」/「双方战场的敌人」)
  assert.match(OVERLAY, /t\('\{who\}的干员攻击力 \{v\}%', \{ who, v: pct\(card\.atkPct \* mag\) \}\)/);
  assert.match(OVERLAY, /t\('\{who\}的敌人移动速度 \{v\}%', \{ who, v: pct\(card\.enemySpeed \* mag\) \}\)/);
  assert.match(OVERLAY, /t\('双方战场的敌人攻击力 ×\{v\}', \{ v: num\(card\.atkMul\) \}\)/);
  assert.match(OVERLAY, /export function allySubject\(card, who = t\('目标玩家'\)\)/);
  assert.match(OVERLAY, /const pct = \(ratio\) => signed\(Number\(ratio\) \* 100\);/);
  for (const k of ['本回合的怪物词条', '强力属性', '本回合 {share}% 的敌人带「{attr}」', '共 {count} 只',
    '{who}的干员', '{who}的敌人', '目标玩家', '双方战场的敌人']) inEveryPack(k);
});

test('a target may be picked again (0.0.5): the only lock is the one pick per period and the seat\'s own state', () => {
  // the one-target-per-match limit is gone (server event.js eventAvailableTargets): a used target is never greyed
  assert.doesNotMatch(OVERLAY, /本局已用过/);
  assert.doesNotMatch(OVERLAY, /wasUsed/);
  assert.match(OVERLAY, /const usable = available \? available\.has\(key\) : !!pid;/);
  assert.match(OVERLAY, /const disabled = !!myPick \|\| busy \|\| dead \|\| !player \|\| !usable;/);
  assert.match(OVERLAY, /disabled=\$\{st\.disabled\}/);
  assert.match(OVERLAY, /aria-disabled=\$\{st\.disabled \? 'true' : 'false'\}/);
  assert.match(OVERLAY, /if \(dead\) why = t\('你已被淘汰'\);/);
  assert.match(OVERLAY, /else if \(!pid\) why = versus \? t\('没有这个座位'\) : t\('没有可选的队友'\);/);
  assert.match(OVERLAY, /else if \(busy\) why = t\('正在提交…'\);/);
  assert.match(OVERLAY, /\$\{st\.why \? html`<span class="evotarget__why">\$\{st\.why\}<\/span>` : null\}/);
  assert.match(OVERLAY, /onClick=\$\{\(\) => \{ if \(!st\.disabled\) onPick && onPick\(key\); \}\}/);
  // the look: dimmed while disabled, the chosen one framed
  assert.match(OVERLAY, /class=\$\{cx\('evotarget', st\.sel && 'is-sel'\)\}/);
  assert.match(CSS, /\.evotarget:disabled \{ opacity: \.45; cursor: default; \}/);
  assert.match(CSS, /\.evotarget\.is-sel \{ border-color: var\(--mint-400\);/);
  for (const k of ['没有这个座位', '没有可选的队友', '正在提交…', '事件期已结束']) inEveryPack(k);
});

test('co-op hunt (同盟狩猎) renders only 队友 / 自己 in two columns and keeps both pickable every period', () => {
  // the server's `targets` map carries oppA / oppB in 2V2 and only self / mate in a co-op hunt (COOP_HUNT.targets)
  assert.match(OVERLAY, /const versus = \['oppA', 'oppB'\]\.some\(\(k\) => Object\.prototype\.hasOwnProperty\.call\(targets, k\)\);/);
  assert.match(OVERLAY, /const targetList = versus \? TARGETS : TARGETS\.filter\(\(\{ key \}\) => key === 'self' \|\| key === 'mate'\);/);
  assert.match(OVERLAY, /\$\{targetList\.map\(\(\{ key, label, testid \}\) => \{/);
  assert.match(OVERLAY, /cx\('evov__targets', !versus && 'evov__targets--duo'\)/);
  assert.match(CSS, /\.evov__targets--duo \{ grid-template-columns: repeat\(2, 1fr\); \}/);
  // no 对面包 in co-op: the hint says both targets keep dealing 我方包 and the 默认包 floor stays
  assert.match(OVERLAY, /\$\{versus \? t\('选对面发对面包（1 减益 \+ 2 中性），选自己或队友发我方包（1 增益 \+ 2 中性）；没被选中的玩家拿默认包（3 中性）'\) : t\('选自己或队友发我方包（1 增益 \+ 2 中性）；没被选中的玩家拿默认包（3 中性）'\)\}/);
  inEveryPack('选自己或队友发我方包（1 增益 + 2 中性）；没被选中的玩家拿默认包（3 中性）');
  inEveryPack('选对面发对面包（1 减益 + 2 中性），选自己或队友发我方包（1 增益 + 2 中性）；没被选中的玩家拿默认包（3 中性）');
});

test('the picked pack names WHO got it and what it holds: 你收到了 for self, 送给{目标} for a mate / opponent', () => {
  assert.match(OVERLAY, /data-testid="event-result"/);
  // the entry lands on the TARGET (server event.js targetPs.eventEntries): the sentence names the target and the pack
  assert.match(OVERLAY, /const pickedTarget = myPick \? myPick\.target : null;/);
  assert.match(OVERLAY, /const packKindOf = \(rec\) => \(rec && rec\.packKind\) \|\| \(rec && \(rec\.target === 'oppA' \|\| rec\.target === 'oppB'\) \? 'opp' : 'own'\);/);
  assert.match(OVERLAY, /const pickedPackLabel = t\(PACK_LABEL\[packKindOf\(myPick\)\] \|\| PACK_LABEL\.own\);/);
  assert.match(OVERLAY, /t\('已选择 → 你收到了\{pack\}：\{cards\}', \{ pack: pickedPackLabel, cards: pickedNames \}\)/);
  assert.match(OVERLAY, /t\('已选择 → 送给\{target\}\{pack\}：\{cards\}', \{ target: pickedTargetLabel, pack: pickedPackLabel, cards: pickedNames \}\)/);
  // every entry of the pack is named and every effect line names its subject (X 的干员 / X 的敌人)
  assert.match(OVERLAY, /const pickedNames = pickedCards\.map\(\(c\) => `「\$\{t\(ALLY_NAMES\[c\.key\] \|\| c\.key\)\}」`\)\.join\(''\);/);
  assert.match(OVERLAY, /const pickedEffects = pickedCards\.map\(\(c\) => allyEffect\(c, pickedWho\)\)\.filter\(Boolean\)\.join\(' · '\);/);
  assert.match(OVERLAY, /\$\{pickedEffects \? html`<span class="evov__eff">\$\{pickedEffects\}<\/span>` : null\}/);
  assert.match(OVERLAY, /data-testid="event-history"/);
  assert.match(OVERLAY, /data-testid="event-history-row"/);
  // one row per period of the match (3), the current one marked, filled from the history or this period's pick
  assert.match(OVERLAY, /const rounds = Array\.isArray\(ally\.rounds\) && ally\.rounds\.length \? ally\.rounds : \[null, null, null\];/);
  assert.match(OVERLAY, /const mine = history\.filter\(\(r\) => r\.index === n\);/);
  assert.match(OVERLAY, /<span class="evohist__n">\$\{t\('第 \{n\} 次', \{ n: r\.n \}\)\}<\/span>/);
  assert.match(OVERLAY, /class=\$\{cx\('evohist__row', r\.n === index && 'is-cur'\)\}/);
  assert.match(OVERLAY, /t\('尚未选择'\)/);
  assert.match(CSS, /\.evohist__row\.is-cur \{ border-color: var\(--mint-800\);/);
  for (const k of ['已选择 → 你收到了{pack}：{cards}', '已选择 → 送给{target}{pack}：{cards}',
    '已选择，等待其他玩家', '本局选择记录', '第 {n} 次', '尚未选择', '被选 {n} 次', '来自 {name}',
    '我方包', '对面包', '默认包']) inEveryPack(k);
});

test('wiring: game.js renders it on PHASE.EVENT, actions.eventPick sends g.event.pick', () => {
  assert.match(GAME, /import \{ EventOverlay \} from '\.\.\/ui\/eventOverlay\.js';/);
  assert.match(GAME, /\$\{phase === PHASE\.EVENT \? html`<\$\{EventOverlay\} pub=\$\{pub\} busy=\$\{eventBusy\}/);
  assert.match(GAME, /onPick=\$\{async \(target\) => \{ setEventBusy\(true\); try \{ await actions\.eventPick\(target\); \} finally \{ setEventBusy\(false\); \} \}\}/);
  assert.match(GAME, /const \[eventBusy, setEventBusy\] = useState\(false\);/);
  assert.match(ACTIONS, /eventPick: \(target\) => act\('g\.event\.pick', \{ target \}, \{ sfx: 'confirm' \}\)/);
  // the server answers the same intent (the client never invents a field)
  assert.match(src('server/match/match/intents.js'), /case 'g\.event\.pick': return this\.pickEvent\(ps, msg\.target\);/);
  // the panel is read-only over m.public.event
  assert.match(OVERLAY, /const ally = ev && ev\.ally;/);
  assert.match(OVERLAY, /const myPick = \(ally\.picks && ally\.picks\[myId\]\) \|\| null;/);
  assert.match(OVERLAY, /const list = Array\.isArray\(ally\.available && ally\.available\[myId\]\) \? ally\.available\[myId\] : null;/);
});

test('the panel is phone-landscape first: it scrolls inside, sizes in var(--t), and names the phase in every pack', () => {
  const block = CSS.slice(CSS.indexOf('/* 2V2 事件期 overlay'), CSS.indexOf('/* 对抗期 clash'));
  assert.ok(block.length > 500, 'the event styles are present');
  assert.match(block, /\.evov__body \{ flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow-y: auto;/);
  assert.match(block, /-webkit-overflow-scrolling: touch/);
  assert.match(block, /@media \(max-height: 431\.98px\) \{/);
  assert.match(block, /\.evov__targets \{ display: grid; grid-template-columns: repeat\(4, 1fr\);/);
  assert.doesNotMatch(block, /font-size:\s*\d/, 'no px-like fixed font sizes: every one goes through var(--t)');
  assert.match(block, /font-size: calc\(\.26 \* var\(--t\)\)/, 'the entry name follows the text scale');
  // every new player-visible string is translated, and the brand name of the inspiration never appears
  for (const k of [
    '事件期', '第 {n}/{total} 次', '选择这次词条送给谁',
    '选对面发对面包（1 减益 + 2 中性），选自己或队友发我方包（1 增益 + 2 中性）；没被选中的玩家拿默认包（3 中性）',
    '磨刃', '追风', '破甲', '钝口', '重弩', '连击', '猎人披挂', '营地篝火', '铁衣', '血痕', '轻装远行', '负甲', '陷足',
    '蓄势', '静息', '轻省', '滞涩', '换息', '回环', '猎人佣金', '赏金嗅觉', '轻捷', '空手而归', '集市换货',
    '锈刃', '换骨', '獠牙', '创口', '坚壳', '厚皮', '迟缓', '盘踞', '疾行', '稀疏', '替换', '增援',
  ]) inEveryPack(k);
  assert.ok(!/海克斯/.test(OVERLAY), 'no 海克斯 in the overlay');
  for (const l of LANGS) {
    const branded = Object.keys(PACK[l]).filter((k) => !k.startsWith('_') && (/海克斯/.test(k) || /\bhex\b/i.test(PACK[l][k])));
    assert.deepEqual(branded, [], `${l}: the event entries carry no brand name`);
  }
});
