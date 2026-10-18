// 对抗期 overlay (2V2, PHASE.CONFRONT) — two steps, both sides in step:
//   step 1 ('target'): pick the OPPONENT this seat attacks. The panel shows the opponents as '?' with their P number and
//     their team's colour — no name, no avatar. Inside a team it is first come, first served (the server hands the
//     teammate whatever is left).
//   step 2 ('monster'): fill this seat's VALUE BUDGET (server confront.js confrontBudget — PER PLAYER, no count limit)
//     with monsters of ONE of the OFFICIAL 特训敌人 types (特异 / 飞行 / 频次 / 元素 / 持续 / 隐匿 / 折射, data/factions.json
//     — one group per type, named and iconed like the briefing's), each on a gate (上路 'upper' / 下路 'lower'), all
//     inserted together at one position of the wave (靠前/靠中/靠后 = 25/50/75 % of the round's monster count). Submitting
//     early is fine; the step ends as soon as every alive player has submitted.
// Texts go through t() (docs/I18N.md).
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, Countdown } from '../ui/components.js';
import { Img, GIcon, PlayerAvatar, useGameData } from '../ui/gameComponents.js';
import { enemyIconUrl, factionIconUrl } from '../ui/assetUrls.js';
import { useStore } from '../store.js';
import { toast } from '../ui/toasts.js';
import { RosterPanel } from './rosterPanel.js';
import { FOE_NAMES, foeEffect, eliteEffect, eventFoeCard } from './eventOverlay.js';
import { t, N_ } from '../../../shared/i18n.js';
import { VERSUS_CONFRONT } from '../../../shared/constants.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
// module-level, so the labels are msgids (N_) and translated where they are shown (t(label))
const POSITIONS = [['front', N_('靠前')], ['mid', N_('靠中')], ['back', N_('靠后')]];
/**
 * A 特训敌人 type's short label: the data name is 特训敌人·隐匿, the shown label drops the translated prefix (the same
 * expression the enemy drawer's faction chips use).
 */
const typeLabel = (name) => String(name || '').replace(t('特训敌人·'), '');
/**
 * The localized name / description of a 特训敌人 type group. The server sends the raw game data text (`g.name` /
 * `g.desc`, always Chinese), so the client maps the group's `id` through the localized game data (data/i18n — the same
 * source the enemy drawer and the 机变 overlay read) and keeps the sent text as the fallback (the Chinese source locale,
 * or before the overlays have loaded).
 */
const groupName = (gd, g) => (g && gd.factions?.types?.[g.id]?.name) || (g && g.name) || '';
const groupDesc = (gd, g) => (g && gd.factions?.types?.[g.id]?.desc) || (g && g.desc) || '';
/** The localized name of one monster row (`gd.enemy`), the server's Chinese name as the fallback. */
const enemyName = (gd, key, sent) => (gd.enemy(key)?.name) || sent || key;
/**
 * The squad this browser last submitted (module-level: the overlay unmounts between rounds, the page does not). The
 * 沿用上轮 button refits these kinds to the CURRENT round's budget — values and the groups' membership move per round.
 */
let lastSquad = null;

/** P1 / P2 … of a player row (the seat number) — how the panel tells hidden opponents apart. */
const pNo = (p) => (p && Number.isInteger(p.seat) ? `P${p.seat + 1}` : '');

/** The roster row of ONE 2V2 placement: attacker → target, the monsters sent, their count and the announced bounty. */
function clashRowBody(gd, players, r) {
  const pNoOf = (p) => (p && Number.isInteger(p.seat) ? `P${p.seat + 1}` : '?');
  const side = (p) => (p && p.team === 1 ? 'red' : 'blue');
  const foe = players.find((p) => p.playerId === r.sub.target) || null;
  const picks = Array.isArray(r.sub.picks) ? r.sub.picks : [];
  return html`<div class="confclash__row" data-testid="confront-clash-row">
    <span class=${cx('confclash__side', `confclash__side--${side(r.atk)}`)}>
      <${PlayerAvatar} player=${r.atk} size="sm" />
      <span class="confclash__p confseat num">${pNoOf(r.atk)}</span>
    </span>
    <span class="confclash__mid">
      ${picks.slice(0, 8).map((pk, i) => html`<${Img} key=${`${pk.enemyKey}:${i}`} src=${enemyIconUrl(gd.m, pk.enemyKey)} fallback=${html`<${GIcon} name="target" />`} />`)}
      <span class="confclash__vs">→</span>
    </span>
    <span class=${cx('confclash__side', `confclash__side--${side(foe)}`)}>
      <span class="confclash__q">?</span>
      <span class="confclash__p confseat num">${pNoOf(foe)}</span>
    </span>
    <span class="confclash__count num">${t('共 {count} 只', { count: picks.length })}</span>
    <span class="confclash__coin num">${t('赏金 +{n}', { n: r.sub.coins || 0 })}</span>
  </div>`;
}

/**
 * The 2V2 名单 rows (both teams, own team first) from the applied submissions. `myTeam` only decides the order / the
 * 我方 / 对面 headings — the roster itself is public (server messaging.js keeps both teams while the roster runs).
 * @returns {Array<{ key: string, heading?: any, body?: any }>}
 */
function clashRows(gd, pub, conf, myTeam) {
  const players = pub.players || [];
  const subs = (conf && conf.subs) || {};
  const list = players
    .filter((p) => p.team != null && subs[p.playerId] && (subs[p.playerId].picks || []).length)
    .map((p) => ({ atk: p, sub: subs[p.playerId], mine: myTeam != null && p.team === myTeam }));
  const mine = list.filter((r) => r.mine);
  const foes = list.filter((r) => !r.mine);
  const out = [];
  if (mine.length) out.push({ key: 'mine', heading: t('我方') });
  for (const r of mine) out.push({ key: r.atk.playerId, body: clashRowBody(gd, players, r) });
  if (foes.length) out.push({ key: 'foe', heading: t('对面') });
  for (const r of foes) out.push({ key: r.atk.playerId, body: clashRowBody(gd, players, r) });
  return out;
}

/** The round's monster entry (name + effect, then 强力属性), if THIS round's event published one. */
function rosterFoe(pub, round) {
  const foe = pub && pub.event && pub.event.foe ? pub.event.foe : null;
  if (!foe || Number(foe.round) !== Number(round)) return null;
  const card = eventFoeCard(foe);
  if (!card) return null;
  const elite = foe.elite || null;
  const attr = elite && elite.attr ? (FOE_NAMES[elite.attr] ? t(FOE_NAMES[elite.attr]) : String(elite.attr)) : '';
  return html`<section class="rospov__foe" data-testid="roster-foe">
    <h3 class="rospov__h">${t('本回合的怪物词条')}</h3>
    <p class="rospov__foeline"><b>${t(FOE_NAMES[card.key] || card.key)}</b><span>${foeEffect(card)}</span></p>
    ${attr ? html`<p class="rospov__foeline is-elite"><b>${t('强力属性')}</b>
      <span>${t('本回合 {share}% 的敌人带「{attr}」', { share: Math.round((Number(elite.share) || 0) * 100), attr })}</span>
      <span>${t('共 {count} 只', { count: Number(elite.count) || 0 })}</span>
      <span>${eliteEffect(elite.attr)}</span>
    </p>` : null}
  </section>`;
}

/** The roster panel of the 同盟狩猎 投放公示: one public plan per alive player (`plans`), plus this round's entry. */
function coopRosterPanel(gd, pub, conf, players) {
  const roster = conf.roster || {};
  const rows = (Array.isArray(roster.plans) ? roster.plans : []).map((p) => {
    const ps = players.find((x) => x.playerId === p.playerId) || { seat: p.seat, name: '?' };
    const cat = p.category ? typeLabel(groupName(gd, { id: p.category, name: p.categoryName })) : '';
    return {
      key: p.playerId,
      body: html`<span class="rospov__plan">
        <b class="rospov__who num">${pNo(ps)}</b>
        <span class="rospov__name">${ps.name || '?'}</span>
        <span class="rospov__sep">·</span><span class="rospov__cat">${cat || '—'}</span>
        <span class="rospov__sep">·</span><span>${t('总价值 {v}', { v: p.value })}</span>
        <span class="rospov__sep">·</span><span>${t('共 {count} 只', { count: p.count })}</span>
      </span>`,
    };
  });
  const until = Number(roster.until) || Number(pub.deadline) || 0;
  return html`<${RosterPanel} title=${t('本回合投放公示')} micro=${'DELIVERY // ' + t('本回合投放公示')} tone="gold"
    testid="coop-roster" rows=${rows} until=${until} note=${t('猎物漏过不扣目标生命')}>
    ${rosterFoe(pub, conf.round != null ? conf.round : pub.round)}
  <//>`;
}


/** A small enemy chip: icon + name + value (used in the group cards and the placement panel).
 *  `blocked` = the monster does not fit the remaining budget: greyed and marked `aria-disabled`, and a tap only shows
 *  the hint — never a request the server would refuse (user's "防止无效请求" rule). `disabled` is the hard state (the
 *  step is over): the button is natively disabled. */
function EnemyChip({ m, rec, count, onAdd, disabled, blocked, hint }) {
  const gd = useGameData();
  const name = enemyName(gd, rec.key, rec.name);
  const off = !!disabled || !!blocked;
  return html`<button type="button" class=${cx('cchip', off && 'is-disabled')} disabled=${disabled}
      aria-disabled=${off ? 'true' : 'false'} data-testid="confront-chip"
      onClick=${() => { if (blocked && !disabled) hint && hint(rec); else onAdd && onAdd(rec); }}
      title=${`${name}（${rec.value}）`}>
    <span class="cchip__icon"><${Img} src=${enemyIconUrl(m, rec.key)} fallback=${html`<${GIcon} name="target" />`} /></span>
    <span class="cchip__name">${name}</span>
    <span class="cchip__val num">${rec.value}</span>
    ${count ? html`<span class="cchip__count num">×${count}</span>` : null}
  </button>`;
}

/**
 * @param {{ pub:any, busy?:boolean, onTarget:(targetPlayerId:string)=>void, onConfirm:(group:number, position:string, picks:object[])=>void }} props
 */
export function ConfrontOverlay({ pub, busy = false, onTarget, onConfirm }) {
  const gd = useGameData();
  const myId = useStore((s) => s.me.playerId);
  const conf = pub && pub.confront;
  const [group, setGroup] = useState(null);
  const [picks, setPicks] = useState([]); // [{ enemyKey, gate }]
  const [position, setPosition] = useState('mid');
  useEffect(() => { setGroup(null); setPicks([]); setPosition('mid'); }, [conf && conf.round]);
  if (!conf || !conf.active) return null;
  const m = gd.m;
  const groups = Array.isArray(conf.groups) ? conf.groups : [];
  const players = pub.players || [];
  const me = players.find((p) => p.playerId === myId) || null;
  const myTeam = me ? me.team : null;
  const mates = players.filter((p) => p.team != null && p.team === myTeam);
  const foes = players.filter((p) => p.team != null && myTeam != null && p.team !== myTeam);
  const targets = conf.targets || {};
  const myTarget = targets[myId] || null;
  const stage = conf.stage || 'target';
  // every monster a type offers, deduped (a monster may belong to TWO 特训敌人 types): the player MAY MIX TYPES — step
  // into one, spend part of the budget, step into another and add more — so the budget, not the type, is the cap.
  const rowByKey = new Map();
  for (const g of groups) for (const r of g.rows || []) if (!rowByKey.has(r.key)) rowByKey.set(r.key, r);
  const allRows = [...rowByKey.values()];
  const sel = group != null && groups[group - 1] ? groups[group - 1].rows || [] : [];
  // step 2: the placement cap is this seat's VALUE budget — no count limit, only Σ value ≤ budget
  const budget = Math.max(0, Number(conf.budget) || 0);
  // the share of the opponent's wave this round's intervention replaces (and spends) — 5→15 %, 50 % on the 最终狩猎 round
  const pct = Math.round((Number(conf.ratio) || 0) * 100);
  const valOf = (key) => (rowByKey.get(key) || {}).value || 0;
  /** The greedy fill (most expensive that fits) of `rows` up to the budget — the same walk the AI uses. */
  const plan = (rows) => {
    const out = [];
    let left = budget;
    for (const r of rows.slice().sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)))) {
      if (r.value > left) continue;
      left -= r.value;
      out.push({ enemyKey: r.key, gate: out.length % 2 ? 'upper' : 'lower' });
    }
    return out;
  };
  /** The tab (1-based) of the first 特训敌人 type offering `key` — where to land after 自动选择 / 沿用上轮. */
  const groupOfKey = (key) => {
    const i = groups.findIndex((g) => (g.rows || []).some((r) => r.key === key));
    return i >= 0 ? i + 1 : 1;
  };
  const spent = picks.reduce((s, p) => s + valOf(p.enemyKey), 0);
  const remaining = Math.max(0, budget - spent);
  const fits = (rec) => !busy && rec.value <= remaining;
  const overBudget = (rec) => rec.value > remaining;
  // 本回合还能放 n 只 (user 2026-10-17): the remaining value ÷ the CURRENT type's cheapest monster, recomputed on every
  // render — switching the type tab or placing/removing a monster updates it at once. Bounded by the protocol's picks
  // cap too, so the panel never invites a request the server would refuse (ERR.CONFRONT_COUNT).
  const poolRows = sel.length ? sel : allRows;
  const cheapest = poolRows.reduce((lo, r) => Math.min(lo, Number(r.value) || 0), Infinity);
  const byValue = Number.isFinite(cheapest) && cheapest > 0 ? Math.floor(remaining / cheapest) : 0;
  const maxPicks = Math.max(1, Number(conf.maxPicks) || VERSUS_CONFRONT.maxPicks);
  const canPlace = Math.max(0, Math.min(byValue, maxPicks - picks.length));
  /** A tap on a greyed (unaffordable) monster: a light hint, never a submit/place. */
  const notEnough = () => toast(t('剩余价值不足，放不下这只怪物'), 'warn');
  const add = (rec) => {
    if (overBudget(rec)) return notEnough();
    if (!fits(rec)) return;
    setPicks((p) => [...p, { enemyKey: rec.key, gate: 'lower' }]);
  };
  const remove = (i) => setPicks((p) => p.filter((_, k) => k !== i));
  // 队列交互: a placed monster defaults to 下路 — TAP it to switch the gate, PRESS AND HOLD it to drag it in the order.
  // (The up/down buttons and the per-row gate buttons are gone: both actions live on the row itself.)
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const press = useRef({ i: null, timer: null, x: 0, y: 0, armed: false });
  const toggleGate = (i) => setPicks((p) => p.map((x, k) => (k === i ? { ...x, gate: x.gate === 'lower' ? 'upper' : 'lower' } : x)));
  const moveTo = (from, to) => setPicks((p) => {
    if (from === to || from < 0 || to < 0 || from >= p.length || to >= p.length) return p;
    const c = p.slice();
    const [x] = c.splice(from, 1);
    c.splice(to, 0, x);
    return c;
  });
  const rowDown = (e, i) => {
    if (submitted) return;
    const s = press.current;
    clearTimeout(s.timer);
    s.i = i;
    s.x = e.clientX;
    s.y = e.clientY;
    s.armed = false;
    s.timer = setTimeout(() => { if (press.current.i === i) { press.current.armed = true; setDragIdx(i); setOverIdx(i); } }, 380);
  };
  const listMove = (e) => {
    const s = press.current;
    if (s.i == null) return;
    if (!s.armed) {
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12) { clearTimeout(s.timer); s.i = null; }
      return;
    }
    if (e.cancelable) e.preventDefault();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el && typeof el.closest === 'function' ? el.closest('[data-qidx]') : null;
    if (row) setOverIdx(Number(row.getAttribute('data-qidx')));
  };
  const listUp = () => {
    const s = press.current;
    clearTimeout(s.timer);
    if (s.i != null) {
      if (s.armed) { if (overIdx != null && overIdx !== s.i) moveTo(s.i, overIdx); }
      else toggleGate(s.i);
    }
    s.i = null;
    s.armed = false;
    setDragIdx(null);
    setOverIdx(null);
  };
  const mine = conf.subs ? conf.subs[myId] : null;
  const submitted = !!mine;
  const foesPicked = mates.every((p) => targets[p.playerId]);
  /**
   * 自动选择: fill the budget the way the AI does — most expensive monster that still fits, walking the types in order
   * (特异 first) and each type by value. It may mix types. The player tweaks from there — and a player who never submits
   * gets exactly this at the window's end (server confront.js botConfront / finishConfront).
   */
  const autoPick = () => {
    if (submitted || busy) return;
    const out = plan(allRows);
    if (!out.length) return;
    setGroup(groupOfKey(out[0].enemyKey));
    setPicks(out);
    setPosition('mid');
  };
  /**
   * 沿用上轮: the kinds this browser submitted last time, in the same order, refitted to THIS round's budget — and the
   * LEFTOVER is topped up with the auto-selection's greedy walk (when nothing more fits, the leftover simply stays).
   */
  const reuse = () => {
    if (submitted || busy || !lastSquad || !lastSquad.keys.length) return;
    const out = [];
    const used = new Set();
    let left = budget;
    for (const key of lastSquad.keys) {
      const rec = rowByKey.get(key);
      if (!rec || used.has(key) || rec.value > left) continue;
      left -= rec.value;
      used.add(key);
      out.push({ enemyKey: key, gate: lastSquad.gates[out.length] || (out.length % 2 ? 'upper' : 'lower') });
    }
    for (const r of allRows) {
      if (used.has(r.key) || r.value > left) continue;
      left -= r.value;
      used.add(r.key);
      out.push({ enemyKey: r.key, gate: 'lower' });
    }
    if (!out.length) return;
    setGroup(groupOfKey(out[0].enemyKey));
    setPicks(out);
    setPosition(lastSquad.position || 'mid');
  };
  const confirm = () => {
    if (!picks.length) return;
    lastSquad = { keys: picks.map((p) => p.enemyKey), gates: picks.map((p) => p.gate), position };
    onConfirm(group, position, picks);
  };

  // 悬赏名单 / 投放公示 (the server's roster hold): the submissions are final, the battles have not started. The pick /
  // submit UI is GONE here — only the announced list and the countdown are shown (ui/rosterPanel.js).
  if (stage === 'roster') {
    if (conf.roster && conf.roster.coop) return coopRosterPanel(gd, pub, conf, players);
    const until = Number(conf.roster && conf.roster.until) || Number(pub && pub.deadline) || 0;
    return html`<${RosterPanel} title=${t('悬赏名单')} micro=${'BOUNTY LIST // ' + t('悬赏名单')} tone="gold"
      testid="confront-roster" rows=${clashRows(gd, pub, conf, myTeam)} until=${until}
      note=${t('击杀对面派来的猎物，赏金归己方')} />`;
  }

  return html`<div class="spov confov" role="dialog" aria-label=${t('狩猎期')}>
    <div class="spov__veil" aria-hidden="true"></div>
    <div class="spov__inner">
      <header class="spov__head">
        <div class="spov__titles">
          ${stage === 'target'
            ? html`<h2 class="spov__title"><span class="spov__name"><${MicroLabel} tone="mint">HUNTING PHASE // ${t('狩猎期')}</${MicroLabel}>${t('选择你要针对的对手')}</span>
                <span class="spov__bar">|</span><span class="spov__desc">${t('第 {r} 回合 · 对手以 ? 显示，只看编号', { r: conf.round })}</span></h2>`
            : html`<h2 class="spov__title"><span class="spov__name"><${MicroLabel} tone="mint">HUNTING PHASE // ${t('狩猎期')}</${MicroLabel}>${t('为 {p} 定制怪物', { p: myTarget ? pNo(foes.find((f) => f.playerId === myTarget)) || '?' : '?' })}</span>
                <span class="spov__bar">|</span><span class="spov__desc">${t('第 {r} 回合 · 你的怪只会出现在这个对手的波次', { r: conf.round })}</span></h2>`}
          <p class="spov__sub">${stage === 'target'
            ? (myTarget ? t('已锁定目标，等待队友与对手') : t('点击一个 ? 头像框锁定你的目标'))
            : (submitted ? t('你已提交，等待其他玩家') : t('点怪加入；可切换类型继续添加（不限数量，只限总价值）'))}</p>
        </div>
        <div class="spov__turn">
          ${conf.hunt ? html`<span class="spov__turntxt is-final">${t('最终狩猎')}</span>` : null}
          <span class="spov__turntxt t-dim">${t('本轮替换 {pct}%', { pct })}</span>
          ${Number(pub?.deadline) > 0 ? html`<${Countdown} deadline=${pub.deadline} size="sm" />` : null}
          ${stage === 'monster'
            ? (submitted
              ? html`<span class="spov__turntxt is-done"><${Icon} name="check" />${t('已提交')}</span>`
              : html`<span class="spov__turntxt">${t('已用价值 {spent}/{budget}', { spent, budget })}</span>`)
            : null}
          ${stage === 'monster' && !submitted ? html`<${Button} variant="secondary" size="md" title=${t('按价值自动挑满预算，之后可以手动调整')} onClick=${autoPick}>${t('自动选择')}<//>` : null}
          ${stage === 'monster' && !submitted && lastSquad ? html`<${Button} variant="secondary" size="md" title=${t('沿用上一轮的编队（按本轮预算重新装填）')} onClick=${reuse}>${t('沿用上轮')}<//>` : null}
          ${stage === 'monster' && !submitted && group != null ? html`<${Button} variant="primary" size="lg" icon="check" loading=${busy}
            disabled=${picks.length === 0} onClick=${confirm}>${t('提交（{n} 只 · {spent}/{budget}）', { n: picks.length, spent, budget })}<//>` : null}
        </div>
      </header>

      ${stage === 'monster' ? html`<p class="confov__remain" data-testid="confront-remain">
        <b class="num">${t('本回合还能放 {n} 只', { n: canPlace })}</b>
        <span class="num t-dim">${t('（剩余价值 {left} / {budget}）', { left: remaining, budget })}</span>
      </p>` : null}

      ${stage === 'target' ? html`<div class="confov__targets">
        <div class="confov__foes">
          ${foes.map((f) => html`<button key=${f.playerId} type="button" class=${cx('conffoe', `conffoe--${f.team === 0 ? 'blue' : 'red'}`, myTarget === f.playerId && 'is-sel')}
            disabled=${!!myTarget || busy} onClick=${() => onTarget(f.playerId)}>
            <span class="conffoe__q">?</span>
            <span class="conffoe__p confseat num">${pNo(f)}</span>
          </button>`)}
        </div>
        <div class="confov__pairs">
          ${mates.map((p) => html`<span key=${p.playerId} data-testid="confront-seat" class=${cx('confpair', 'confseat', p.playerId === myId && 'is-self')}>
            <b class="num">${pNo(p)}</b>
            <span class="confpair__state">${targets[p.playerId] ? t('已选择') : t('未选择')}</span>
          </span>`)}
        </div>
        <p class="confov__hint t-dim">${foesPicked ? t('双方都选好了，马上开始定制怪物') : t('对手被随机分配：先选的先得，队友自动拿剩下的那一个')}</p>
      </div>` : html`
      <div class="confov__groups">
        ${groups.map((g, i) => {
          const total = (g.rows || []).reduce((s, r) => s + r.value, 0);
          const isSel = group === i + 1;
          return html`<button key=${g.id || i} type="button" class=${cx('confgroup', isSel && 'is-sel')} disabled=${submitted}
            title=${groupDesc(gd, g) || typeLabel(groupName(gd, g))} onClick=${() => setGroup(i + 1)}>
            <span class="confgroup__head">
              <b class="confgroup__name">${g.icon ? html`<${Img} src=${factionIconUrl(m, g.icon)} class="confgroup__ficon" />` : null}${typeLabel(groupName(gd, g)) || `G${i + 1}`}</b>
              <span class="confgroup__meta num">${(g.rows || []).length} ${t('种')} · ${t('总价值 {v}', { v: total })}</span>
            </span>
            <span class="confgroup__icons">
              ${(g.rows || []).map((r) => html`<span key=${r.key} class="confgroup__ic" title=${`${enemyName(gd, r.key, r.name)}（${r.value}）`}><${Img} src=${enemyIconUrl(m, r.key)} fallback=${html`<${GIcon} name="target" />`} /></span>`)}
            </span>
          </button>`;
        })}
      </div>

      ${group != null ? html`<div class="confov__body">
        <section class="confov__pool">
          <h3 class="confov__h">${t('{g} 的怪物（点击加入）', { g: typeLabel(groupName(gd, groups[group - 1])) || t('G{n}', { n: group }) })} <span class="num t-dim">${t('剩余价值 {v}', { v: remaining })}</span></h3>
          <div class="confov__chips">
            ${sel.map((r) => html`<${EnemyChip} key=${r.key} m=${m} rec=${r} count=${picks.filter((p) => p.enemyKey === r.key).length} disabled=${submitted} blocked=${overBudget(r)} hint=${notEnough} onAdd=${add} />`)}
          </div>
        </section>
        <section class="confov__placed">
          <h3 class="confov__h">${t('已放置（出怪顺序）')} <span class="num">${picks.length} · ${spent}/${budget}</span></h3>
          <p class="confov__tip t-dim">${t('点一下换门 · 长按拖动排序（默认下路）')}</p>
          ${picks.length ? html`<ol class="confov__list" onPointerMove=${listMove} onPointerUp=${listUp} onPointerCancel=${listUp} onPointerLeave=${listUp}>
            ${picks.map((p, i) => {
              const rec = rowByKey.get(p.enemyKey) || { key: p.enemyKey, name: p.enemyKey, value: 0 };
              return html`<li key=${`${p.enemyKey}:${i}`} data-qidx=${i}
                  class=${cx('confrow', p.gate === 'upper' && 'is-upper', dragIdx === i && 'is-drag', overIdx === i && dragIdx != null && dragIdx !== i && 'is-over')}
                  title=${t('点击换门 · 长按拖动排序')} onPointerDown=${(e) => rowDown(e, i)}>
                <span class="confrow__idx num">${i + 1}</span>
                <span class="confrow__icon"><${Img} src=${enemyIconUrl(m, rec.key)} fallback=${html`<${GIcon} name="target" />`} /></span>
                <span class="confrow__name">${enemyName(gd, rec.key, rec.name)}</span>
                <span class="confrow__gate2">${t(p.gate === 'upper' ? '上路' : '下路')}</span>
                <span class="confrow__order">
                  <button type="button" disabled=${submitted} onPointerDown=${(e) => e.stopPropagation()} onClick=${() => remove(i)} aria-label=${t('移除')}><${Icon} name="close" /></button>
                </span>
              </li>`;
            })}
          </ol>` : html`<p class="confov__empty t-dim">${t('还没有放置怪物')}</p>`}
          <p class="confov__hint t-dim">${t('猎物漏过不扣目标生命')}</p>
          <h3 class="confov__h">${t('出怪位置')}</h3>
          <div class="confpos">
            ${POSITIONS.map(([id, label]) => html`<button key=${id} type="button" class=${cx('confpos__opt', position === id && 'is-on')}
              disabled=${submitted} onClick=${() => setPosition(id)}>${t(label)}<span class="confpos__pct num">${id === 'front' ? '25%' : id === 'mid' ? '50%' : '75%'}</span></button>`)}
          </div>
        </section>
      </div>` : html`<p class="confov__hint t-dim">${t('先选择上面的一个怪物组')}</p>`}
      `}
    </div>
  </div>`;
}

/**
 * The 悬赏名单 AFTER the phase: once the battles start, the applied submissions stay on the public view for a moment —
 * both teams' boards are revealed (who sent what at whom, and what killing it pays). Display only: it fades out by
 * itself. The roster hold itself is rendered by this file's ConfrontOverlay (stage 'roster').
 * @param {{ pub:any }} props
 */
export function ConfrontClash({ pub }) {
  const gd = useGameData();
  const myId = useStore((s) => s.me.playerId);
  const conf = pub && pub.confront;
  const [shown, setShown] = useState(true);
  const round = conf && conf.round;
  useEffect(() => {
    setShown(true);
    const h = setTimeout(() => setShown(false), 5200);
    return () => clearTimeout(h);
  }, [round]);
  if (!conf || conf.active || !conf.subs || !shown) return null;
  const players = pub.players || [];
  const me = players.find((p) => p.playerId === myId) || null;
  const myTeam = me ? me.team : null;
  const rows = clashRows(gd, pub, conf, myTeam);
  if (!rows.length) return null;
  return html`<${RosterPanel} title=${t('悬赏名单')} micro=${'BOUNTY LIST // ' + t('悬赏名单')} tone="gold"
    className="rospov--clash" testid="confront-clash" rows=${rows} note=${t('击杀对面派来的猎物，赏金归己方')} />`;
}
