// 事件期 overlay (2V2, PHASE.EVENT) — three periods per match (E1 = contestStartRound, E2 = E1 + 4, E3 = R13 最终狩猎,
// server/match/match/event.js). Every period draws TWO entries: the ally entry each player gives to ONE of four targets
// (自己 / 队友 / 对面 A / 对面 B, never the same target twice in one match; keeping it doubles the magnitudes), and the
// monster entry, which is drawn once for the whole round and shown BEFORE anyone picks (its share / 强力属性 included).
// The panel is read-only over m.public.event: a target tap sends g.event.pick { target } and the next m.public answers.
// The entry names are the server's Chinese msgids (EVENT_CARDS / EVENT_FOE_CARDS in shared/constants.js); the effect
// lines are rebuilt from those same constants (signs and magnitudes, self ×EVENT_SELF_MUL).
import { html, Icon, MicroLabel, Countdown } from '../ui/components.js';
import { useStore } from '../store.js';
import { RosterPanel } from './rosterPanel.js';
import { openEntryDetail, entryLook } from './entryDetail.js';
import { t, N_ } from '../../../shared/i18n.js';
import {
  EVENT_CARDS, EVENT_FOE_CARDS, EVENT_FOE_ELITES, EVENT_PICK_SECONDS, EVENT_DURATION_ROUNDS,
} from '../../../shared/constants.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

// The four target keys of `g.event.pick` (EVENT_TARGETS), their msgids and their data-testids. The panel lists the
// opponents first, then the teammate and 自己 (the order the player scans them in).
const TARGETS = [
  { key: 'oppA', label: N_('对面 A'), testid: 'event-target-oppA' },
  { key: 'oppB', label: N_('对面 B'), testid: 'event-target-oppB' },
  { key: 'mate', label: N_('队友'), testid: 'event-target-mate' },
  { key: 'self', label: N_('自己'), testid: 'event-target-self' },
];
const TARGET_LABEL = Object.fromEntries(TARGETS.map((x) => [x.key, x.label]));

// Entry names: the server sends `key` (and the numeric id), the msgid is the Chinese name of the entry. Shared with
// ui/roundBuffs.js (the team panel's one-line "this round's entries" strip), so the two views can never show
// different names — neither may keep its own copy of these tables.
export const ALLY_NAMES = {
  whetstone: N_('磨刃'), tailwind: N_('追风'), armor_break: N_('破甲'), blunted: N_('钝口'),
  heavy_crossbow: N_('重弩'), rapid_volley: N_('连击'),
  hunter_cloak: N_('猎人披挂'), campfire: N_('营地篝火'), iron_hide: N_('铁衣'), bloodstain: N_('血痕'),
  light_travel: N_('轻装远行'), burden_armor: N_('负甲'), mired: N_('陷足'),
  build_up: N_('蓄势'), stillness: N_('静息'), frugal: N_('轻省'), stagnant: N_('滞涩'),
  breath_swap: N_('换息'), cycle: N_('回环'),
  hunter_commission: N_('猎人佣金'), bounty_scent: N_('赏金嗅觉'), nimble: N_('轻捷'),
  empty_handed: N_('空手而归'), market_swap: N_('集市换货'),
};
export const FOE_NAMES = {
  rusted_blade: N_('锈刃'), bone_swap: N_('换骨'), fangs: N_('獠牙'), wound: N_('创口'),
  hard_shell: N_('坚壳'), thick_hide: N_('厚皮'), sluggish: N_('迟缓'), coiled: N_('盘踞'),
  swift: N_('疾行'), sparse: N_('稀疏'), replace: N_('替换'), reinforce: N_('增援'),
};

const ALLY_BY_KEY = new Map(EVENT_CARDS.map((c) => [c.key, c]));
const ALLY_BY_ID = new Map(EVENT_CARDS.map((c) => [c.id, c]));
const FOE_BY_KEY = new Map(EVENT_FOE_CARDS.map((c) => [c.key, c]));
const FOE_BY_ID = new Map(EVENT_FOE_CARDS.map((c) => [c.id, c]));
const ELITE_BY_KEY = new Map(EVENT_FOE_ELITES.map((c) => [c.key, c]));

/** The ally entry of a recorded pick (an `ally.history` row or an `ally.picks` value), or null. */
export function eventAllyCard(rec) {
  if (!rec) return null;
  return ALLY_BY_KEY.get(rec.key) || ALLY_BY_ID.get(rec.card) || null;
}

/** The monster entry of `m.public.event.foe` (or a `foe.history` row), or null. */
export function eventFoeCard(foe) {
  if (!foe) return null;
  return FOE_BY_KEY.get(foe.key) || FOE_BY_ID.get(foe.card) || null;
}

/**
 * Who received a recorded pick: the target map's playerId for that picker / key, else the record's own `targetId`.
 * Null when the record carries no `target` (an old record from before the server sent it): the caller skips it.
 * Shared with ui/roundBuffs.js (the 本回合词条 strip), so "who got it" can never be resolved two different ways.
 * @param {any} rec an `ally.history` row
 * @param {Record<string, Record<string, string|null>>} [targets] `m.public.event.ally.targets`
 * @returns {string|null}
 */
export function eventReceiver(rec, targets = {}) {
  if (!rec || typeof rec.target !== 'string' || !rec.target) return null;
  const map = targets && targets[rec.playerId];
  const viaMap = map && typeof map === 'object' ? map[rec.target] : null;
  if (typeof viaMap === 'string' && viaMap) return viaMap;
  return typeof rec.targetId === 'string' && rec.targetId ? rec.targetId : null;
}

/**
 * The 词条公示 rows: every pick of THIS period (ally.history rows with the current index), "who gave「X」to whom" and the
 * entry's effect at its own magnitude. The receiver is resolved through eventReceiver (the target map first, the record's
 * own targetId as the fallback). Rows whose card is unknown are skipped — never guessed.
 * @returns {Array<{ key: string, body: any }>}
 */
export function eventRosterRows(pub, ally, index) {
  const players = Array.isArray(pub && pub.players) ? pub.players : [];
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const targets = (ally && ally.targets) || {};
  const history = (ally && Array.isArray(ally.history) ? ally.history : [])
    .filter((r) => r && Number(r.index) === Number(index));
  const out = [];
  for (const rec of history) {
    const card = eventAllyCard(rec);
    if (!card) continue;
    const picker = byId.get(rec.playerId) || null;
    const rid = eventReceiver(rec, targets);
    const to = rid ? byId.get(rid) || null : null;
    const name = t(ALLY_NAMES[card.key] || card.key);
    const effect = allyEffect(card, Number(rec.mag) || 1);
    out.push({
      key: `event:${rec.playerId}`,
      body: html`<span class="rospov__give">
        <b class="rospov__p num">${pNo(picker)}</b><span class="rospov__name">${(picker && picker.name) || '?'}</span>
        <span class="rospov__verb">${t('把「{card}」给了', { card: name })}</span>
        <b class="rospov__p num">${pNo(to)}</b><span class="rospov__name">${(to && to.name) || '?'}</span>
        ${effect ? html`<span class="rospov__eff">${effect}</span>` : null}
      </span>`,
    });
  }
  return out;
}

/** P1 / P2 … of a player row (the seat number). */
const pNo = (p) => (p && Number.isInteger(p.seat) ? `P${p.seat + 1}` : '');

/** Two decimals at most, trailing zeros dropped ('0.85', '1.2', '36'). */
const num = (v) => String(Math.round(Number(v) * 100) / 100);
/** A signed number for the effect lines ('+20', '-9', '+0.3'). */
const signed = (v) => (Number(v) > 0 ? `+${num(v)}` : num(v));
/** A ratio as a signed percentage ('+20' / '-9'); `mag` is the target's magnitude (self = EVENT_SELF_MUL). */
const pct = (ratio, mag = 1) => signed(Number(ratio) * mag * 100);
/** `base` after the target's magnitude — the same `1 + (m − 1) × mag` the server applies (event.js magMul). */
const scaled = (base, mag = 1) => num(1 + (Number(base) - 1) * mag);

/** The effect of one ally entry at `mag` (1, or EVENT_SELF_MUL for 自己), built from the constants. */
export function allyEffect(card, mag = 1) {
  if (!card) return '';
  const out = [];
  if (card.atkPct) out.push(t('攻击力 {v}%', { v: pct(card.atkPct, mag) }));
  if (card.aspd) out.push(t('攻速 {v}', { v: signed(card.aspd * mag) }));
  if (card.defIgnorePct) out.push(t('无视防御 {v}%', { v: pct(card.defIgnorePct, mag) }));
  if (card.hpPct) out.push(t('生命值 {v}%', { v: pct(card.hpPct, mag) }));
  if (card.regenPct) out.push(t('每秒回复 {v}%', { v: pct(card.regenPct, mag) }));
  if (card.defPct) out.push(t('防御力 {v}%', { v: pct(card.defPct, mag) }));
  if (card.dmgTaken) out.push(t('受到的伤害 {v}%', { v: pct(card.dmgTaken, mag) }));
  if (card.moveMul) out.push(t('移动速度 ×{v}', { v: scaled(card.moveMul, mag) }));
  if (card.enemySpeed) out.push(t('敌人移动速度 {v}%', { v: pct(card.enemySpeed, mag) }));
  if (card.spRecoveryMul) out.push(t('技力回复 ×{v}', { v: scaled(card.spRecoveryMul, mag) }));
  if (card.spRecoveryFlat) out.push(t('每秒技力 {v}', { v: signed(card.spRecoveryFlat * mag) }));
  if (card.spCostFlat) out.push(t('技力消耗 {v}', { v: signed(card.spCostFlat * mag) }));
  if (card.goldPerRound) out.push(t('每回合金币 {v}', { v: signed(card.goldPerRound * mag) }));
  if (card.bountyGold) out.push(t('击杀投放怪的赏金 {v}', { v: signed(card.bountyGold * mag) }));
  if (card.deploy) out.push(t('上场人数 {v}', { v: signed(card.deploy * mag) }));
  if (card.refreshDiscount) {
    out.push(t('刷新费 {v}（每回合 {n} 次）', {
      v: signed(-card.refreshDiscount * mag), n: num((card.refreshUses || 0) * mag),
    }));
  }
  if (card.sellDiscount) out.push(t('出售价 {v}', { v: signed(-card.sellDiscount * mag) }));
  return out.join(' · ');
}

/** The effect of one monster entry (always applied to the enemies). */
export function foeEffect(card) {
  if (!card) return '';
  const out = [];
  if (card.atkMul) out.push(t('敌人攻击力 ×{v}', { v: num(card.atkMul) }));
  if (card.hpMul) out.push(t('敌人生命值 ×{v}', { v: num(card.hpMul) }));
  if (card.defMul) out.push(t('敌人防御力 ×{v}', { v: num(card.defMul) }));
  if (card.speedMul) out.push(t('敌人移动速度 ×{v}', { v: num(card.speedMul) }));
  if (card.countAdd) out.push(t('敌人数量 {v}', { v: signed(card.countAdd) }));
  return out.join(' · ');
}

/** The effect of one 强力属性 on the marked enemies. */
export function eliteEffect(key) {
  const a = ELITE_BY_KEY.get(key);
  if (!a) return '';
  if (a.atkMul) return t('敌人攻击力 ×{v}', { v: num(a.atkMul) });
  if (a.hpMul) return t('敌人生命值 ×{v}', { v: num(a.hpMul) });
  if (a.defMul) return t('敌人防御力 ×{v}', { v: num(a.defMul) });
  if (a.speedMul) return t('敌人移动速度 ×{v}', { v: num(a.speedMul) });
  return '';
}

/**
 * The payload of the 词条说明 popup (ui/entryDetail.js) for one entry. Names and effects go through the same tables as
 * the overlay and the P4 strip; `mag` is the receiver's magnitude (2 for 自己), `picked` / `round` drive the rounds-left
 * line, and `elite` is `m.public.event.foe.elite` for a monster entry. Never throws on an unknown key.
 * @param {'ally'|'foe'} kind
 * @param {any} card an EVENT_CARDS / EVENT_FOE_CARDS row
 * @param {{ mag?: number, round?: number|null, picked?: number|null, target?: string, elite?: any, duration?: number|null }} [opts]
 */
export function detailOf(kind, card, { mag = 1, round = null, picked = null, target = 'self', elite = null, duration = null } = {}) {
  if (!card) return null;
  const ally = kind === 'ally';
  const look = entryLook(kind, card);
  const rounds = Math.max(1, Math.min(EVENT_DURATION_ROUNDS, Math.trunc(Number(duration ?? card.duration) || EVENT_DURATION_ROUNDS)));
  return {
    kind,
    key: card.key,
    name: t((ally ? ALLY_NAMES : FOE_NAMES)[card.key] || card.key),
    ...look,
    base: ally ? allyEffect(card, 1) : foeEffect(card),
    now: ally ? allyEffect(card, mag) : foeEffect(card),
    mag,
    duration: rounds,
    targetLabel: ally
      ? (TARGET_LABEL[target] ? t(TARGET_LABEL[target]) : t(target))
      : t('本回合的敌人'),
    picked: picked != null && Number.isFinite(Number(picked)) ? Number(picked) : null,
    round: round != null && Number.isFinite(Number(round)) ? Number(round) : null,
    elite: elite && elite.attr ? {
      name: t(FOE_NAMES[elite.attr] || elite.attr),
      share: Math.round((Number(elite.share) || 0) * 100),
      count: Number(elite.count) || 0,
      effect: eliteEffect(elite.attr),
    } : null,
  };
}

/**
 * The 事件期 panel: the round's monster entry and 强力属性 on top (visible before picking), then the four targets and
 * the match's three selections under them.
 * @param {{ pub:any, busy?:boolean, onPick:(target:string)=>void }} props
 */
export function EventOverlay({ pub, busy = false, onPick }) {
  const myId = useStore((s) => s.me.playerId);
  const ev = pub && pub.event;
  const ally = ev && ev.ally;
  const foe = ev && ev.foe;
  if (!ally || !ally.active) return null;
  const players = Array.isArray(pub.players) ? pub.players : [];
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const targets = (ally.targets && ally.targets[myId]) || {};
  // 同盟狩猎 has no opposing team: the server sends only `self` / `mate` (COOP_HUNT.targets), so the panel must not
  // render the two dead 对面 seats either (the mode, not a missing seat, is why they do not exist).
  const versus = ['oppA', 'oppB'].some((k) => Object.prototype.hasOwnProperty.call(targets, k));
  const targetList = versus ? TARGETS : TARGETS.filter(({ key }) => key === 'self' || key === 'mate');
  const list = Array.isArray(ally.available && ally.available[myId]) ? ally.available[myId] : null;
  const available = list ? new Set(list) : null;
  const myPick = (ally.picks && ally.picks[myId]) || null;
  const history = Array.isArray(ally.history) ? ally.history.filter((r) => r && r.playerId === myId) : [];
  const used = new Set(history.map((r) => r.target));
  if (myPick) used.add(myPick.target);
  const meP = byId.get(myId) || null;
  // a spectator seat has no row in m.public and cannot be one of the four targets: no panel for it
  if (!meP) return null;
  const dead = meP.alive === false;
  const rounds = Array.isArray(ally.rounds) && ally.rounds.length ? ally.rounds : [null, null, null];
  const index = Number.isInteger(ally.index) && ally.index > 0 ? ally.index : 1;
  const total = Math.max(index, rounds.length);
  const deadline = Number(ally.deadline) > 0 ? ally.deadline
    : (Number(pub.deadline) > 0 ? pub.deadline : 0);

  // the round's monster entry, shown before the targets: name + effect, then the 强力属性 subset (name + effect)
  const foeCard = foe ? (FOE_BY_KEY.get(foe.key) || FOE_BY_ID.get(foe.card) || null) : null;
  const elite = foe && foe.elite ? foe.elite : null;
  const eliteName = elite ? (FOE_NAMES[elite.attr] || elite.attr || '') : '';
  const eliteShare = elite ? Math.round((Number(elite.share) || 0) * 100) : 0;
  const foeDetail = foeCard ? detailOf('foe', foeCard, { elite }) : null;

  // the picked entry (the result line) and the three rows of the match's selections
  const pickedCard = myPick ? (ALLY_BY_KEY.get(myPick.key) || ALLY_BY_ID.get(myPick.card) || null) : null;
  const pickedMag = Number(myPick && myPick.mag) || 1;
  const pickedName = pickedCard ? t(ALLY_NAMES[pickedCard.key]) : ((myPick && myPick.key) || '');
  const pickedTarget = myPick ? myPick.target : null;
  const pickedTargetLabel = pickedTarget && TARGET_LABEL[pickedTarget] ? t(TARGET_LABEL[pickedTarget]) : '';
  // the entry lands on the TARGET (server event.js: targetPs.eventEntries.push): only `self` reads as "you got it";
  // a mate / opponent row says who got it, and its effect line is prefixed so it cannot be read as the picker's own.
  const grantPrefix = pickedTarget === 'self' || !pickedTarget ? null
    : pickedTarget === 'mate' ? t('队友获得：') : t('对方获得：');
  const pickedEffect = allyEffect(pickedCard, pickedMag);
  const rows = rounds.map((round, i) => {
    const n = i + 1;
    const rec = history.find((r) => r.index === n) || (myPick && index === n ? myPick : null);
    const card = rec ? (ALLY_BY_KEY.get(rec.key) || ALLY_BY_ID.get(rec.card) || null) : null;
    const detail = card && rec ? detailOf('ally', card, {
      mag: Number(rec.mag) || 1, picked: rec.round, round: pub.round, target: rec.target,
    }) : null;
    return { n, round, rec, card, detail };
  });

  /** Why a target cannot be picked (null: it can), and its selected state. */
  const targetState = (key) => {
    const pid = targets[key] || null;
    const player = pid ? byId.get(pid) || null : null;
    const sel = !!(myPick && myPick.target === key);
    // 2V2 only: a target cannot be taken twice by the same player in one match. 同盟狩猎 has just self / mate for
    // three periods, so the server deliberately does NOT apply the no-repeat rule there (event.js eventAvailableTargets).
    const wasUsed = versus && used.has(key) && !sel;
    const usable = available ? available.has(key) : !wasUsed && !!pid;
    const disabled = !!myPick || busy || dead || !player || wasUsed || !usable;
    let why = null;
    if (dead) why = t('你已被淘汰');
    else if (wasUsed) why = t('本局已用过');
    else if (!pid) why = versus ? t('没有这个座位') : t('没有可选的队友');
    else if (busy) why = t('正在提交…');
    else if (!ally.active) why = t('事件期已结束');
    return { player, sel, disabled, why };
  };

  // 词条公示 (the server's event roster hold): every pick of this period is final and the picking UI is gone — show
  // who gave which entry to whom, its effect, and the 5 s countdown (ui/rosterPanel.js, shared with the hunt rosters).
  if (ally.stage === 'roster' && ally.roster) {
    const rosterRows = eventRosterRows(pub, ally, index);
    if (rosterRows.length) {
      return html`<${RosterPanel} title=${t('词条公示')} micro=${'ENTRIES // ' + t('词条公示')} tone="mint"
        testid="event-roster" rows=${rosterRows} until=${Number(ally.roster.until) || Number(pub.deadline) || 0} />`;
    }
  }

  return html`<div class="spov evov" role="dialog" aria-label=${t('事件期')} data-testid="event-phase">
    <div class="spov__veil" aria-hidden="true"></div>
    <div class="spov__inner">
      <header class="spov__head">
        <div class="spov__titles">
          <h2 class="spov__title"><span class="spov__name"><${MicroLabel} tone="mint">EVENT PHASE // ${t('事件期')}</${MicroLabel}>${t('事件期')}</span>
            <span class="spov__bar">|</span><span class="spov__desc" data-testid="event-index">${t('第 {n}/{total} 次', { n: index, total })}</span></h2>
          <p class="spov__sub">${myPick ? t('已选择，等待其他玩家') : t('选择这次词条送给谁')}</p>
        </div>
        <div class="spov__turn">
          ${deadline ? html`<div class="spov__timer" data-testid="event-timer">
            <${Countdown} deadline=${deadline} total=${EVENT_PICK_SECONDS} size="sm" />
          </div>` : null}
          ${myPick ? html`<span class="spov__turntxt is-done"><${Icon} name="check" />${t('已选择')}</span>` : null}
        </div>
      </header>

      ${foeCard ? html`<section class="evov__foe" data-testid="event-foe">
        <h3 class="evov__h">${t('本回合的怪物词条')}</h3>
        <button type="button" class="evov__foecard evov__link" data-testid="event-foe-detail" title=${t('点击查看词条说明')}
          onClick=${() => openEntryDetail(foeDetail)}>
          <b class="evov__name">${t(FOE_NAMES[foeCard.key] || foeCard.key)}</b>
          <span class="evov__eff">${foeEffect(foeCard)}</span>
          <span class="evov__more"><${Icon} name="info" /></span>
        </button>
        ${elite ? html`<p class="evov__elite" data-testid="event-elite">
          <b>${t('强力属性')}</b>
          <span>${eliteName ? t('本回合 {share}% 的敌人带「{attr}」', { share: eliteShare, attr: t(eliteName) }) : t('强力属性')}</span>
          <span class="num">${t('共 {count} 只', { count: Number(elite.count) || 0 })}</span>
          <span class="evov__eff">${eliteEffect(elite.attr)}</span>
        </p>` : null}
      </section>` : null}

      <section class="evov__body">
        <h3 class="evov__h">${t('选择这次词条送给谁')}</h3>
        <div class=${cx('evov__targets', !versus && 'evov__targets--duo')}>
          ${targetList.map(({ key, label, testid }) => {
            const st = targetState(key);
            return html`<button key=${key} type="button" class=${cx('evotarget', st.sel && 'is-sel')}
              data-testid=${testid} disabled=${st.disabled}
              aria-disabled=${st.disabled ? 'true' : 'false'}
              title=${st.why || (st.player ? `${st.player.name || ''} ${pNo(st.player)}`.trim() : '')}
              onClick=${() => { if (!st.disabled) onPick && onPick(key); }}>
              <span class="evotarget__label">${t(label)}</span>
              <span class="evotarget__name">${st.player ? (st.player.name || '?') : '—'}</span>
              <span class="evotarget__p confseat num">${pNo(st.player)}</span>
              ${st.why ? html`<span class="evotarget__why">${st.why}</span>` : null}
            </button>`;
          })}
        </div>

        ${myPick ? html`<p class="evov__result" data-testid="event-result">
          <${Icon} name="check" />
          <span>${pickedTarget === 'self' || !pickedTarget
            ? t('已选择 → 你收到了「{card}」', { card: pickedName })
            : t('已选择 → 送给{target}「{card}」', { target: pickedTargetLabel, card: pickedName })}</span>
          <span class="evov__eff">${grantPrefix && pickedEffect ? `${grantPrefix}${pickedEffect}` : pickedEffect}</span>
          ${pickedCard ? html`<button type="button" class="evov__look" title=${t('点击查看词条说明')}
            onClick=${() => openEntryDetail(detailOf('ally', pickedCard, {
              mag: pickedMag, picked: myPick.round, round: pub.round, target: pickedTarget || 'self',
            }))}><${Icon} name="info" />${t('词条说明')}</button>` : null}
          ${myPick.auto ? html`<span class="evov__auto">${t('自动选择')}</span>` : null}
        </p>` : null}

        <p class="evov__hint t-dim">${versus ? t('自己接收时效果翻倍；每个目标一局只能用一次') : t('自己接收时效果翻倍；自己和队友每次都可以选')}</p>

        <h3 class="evov__h">${t('本局选择记录')}</h3>
        <ol class="evohist" data-testid="event-history">
          ${rows.map((r) => html`<li key=${r.n} class=${cx('evohist__row', r.n === index && 'is-cur')} data-testid="event-history-row">
            <span class="evohist__n">${t('第 {n} 次', { n: r.n })}</span>
            <span class="evohist__round num">${r.round ? `R${r.round}` : '—'}</span>
            <span class="evohist__target">${r.rec && TARGET_LABEL[r.rec.target] ? t(TARGET_LABEL[r.rec.target]) : t('尚未选择')}</span>
            ${r.card && r.detail
              ? html`<button type="button" class="evohist__card evohist__link" title=${t('点击查看词条说明')}
                  onClick=${() => openEntryDetail(r.detail)}>「${t(ALLY_NAMES[r.card.key])}」<${Icon} name="info" /></button>`
              : html`<span class="evohist__card">—</span>`}
            ${r.rec && r.rec.auto ? html`<span class="evov__auto">${t('自动选择')}</span>` : null}
          </li>`)}
        </ol>
      </section>
    </div>
  </div>`;
}
