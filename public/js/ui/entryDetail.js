// 词条说明 (entry detail): the small popup behind every 事件期 entry shown in the team panel's 本回合词条 strip
// (ui/roundBuffs.js), the 事件期 overlay's monster card, its pack roster and its pick history. It answers "what does
// this do, and how is the number computed" without sending the player to the docs:
//   * the entry's kind (增益 / 交换 / 减益, or a monster entry's 有利 / 中性 / 不利) and its class (输出 / 生存 / 技力 /
//     经济, or 攻击 / 生存 / 速度 / 数量) as a coloured badge + icon;
//   * 归属 (0.0.5 需求 2): which pack the entry was dealt from — 我方包 / 对面包 / 默认包;
//   * 作用对象: WHOSE units the effect touches — 「X 的干员」/ 「X 的敌人」 / the player itself (a monster entry is
//     always 双方战场的敌人) — and the effect itself at its base value;
//   * how long it lasts (EVENT_DURATION_ROUNDS) and how many rounds are left;
//   * the two rules that are easy to get wrong: how the packs are dealt (one per selection, 默认包 for the unchosen)
//     and the environment multiplier bucket (two +20 % entries are ×1.44; flat ASPD / SP values are added to the panel
//     first) and that monster entries only touch that round's enemy wave.
//
// The caller (ui/eventOverlay.js detailOf, ui/roundBuffs.js) resolves names, effects and subjects through the SAME
// tables the rest of the UI uses and passes a plain payload, so this module never keeps a second copy of the 24 + 12
// cards. The dialog is mounted once at the game screen's root (screens/game.js): rendering it inside the team panel
// would put it below the 事件期 overlay (.spov, z-index 20) in the HUD's stacking context.
import { html, Icon, Modal, Button } from './components.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { t } from '../../../shared/i18n.js';
import { EVENT_DURATION_ROUNDS } from '../../../shared/constants.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

// class → label + icon (the two families share 生存 / 攻击 / 速度 / 数量 / 输出 / 技力 / 经济). The labels are UI text but
// travel through t() as variables in entryLook below (the scanner cannot follow that), so each table line carries the
// documented `// i18n-ignore` (docs/I18N.md): the msgids exist in every pack and entryLook translates them.
const ALLY_CLASS = {
  output: ['输出', 'sword'], survival: ['生存', 'shield'], sp: ['技力', 'refresh'], economy: ['经济', 'crown'], // i18n-ignore
};
const FOE_CLASS = {
  attack: ['攻击', 'sword'], survival: ['生存', 'shield'], speed: ['速度', 'signal'], count: ['数量', 'users'], // i18n-ignore
};
// kind → label + tone (the badge colour)
const ALLY_KIND = { up: ['增益', 'mint'], mid: ['交换', 'gold'], down: ['减益', 'red'] }; // i18n-ignore
const FOE_KIND = { favor: ['有利', 'mint'], mid: ['中性', 'gold'], unfavor: ['不利', 'red'] }; // i18n-ignore

/**
 * The badge / icon of one entry.
 * @param {'ally'|'foe'} kind
 * @param {{ class?: string, kind?: string }} card an EVENT_CARDS / EVENT_FOE_CARDS row
 * @returns {{ icon: string, tone: 'mint'|'gold'|'red', kindLabel: string, classLabel: string }}
 */
export function entryLook(kind, card) {
  const ally = kind === 'ally';
  const [classLabel, icon] = (ally ? ALLY_CLASS : FOE_CLASS)[card && card.class] || ['词条', 'info']; // i18n-ignore
  const [kindLabel, tone] = (ally ? ALLY_KIND : FOE_KIND)[card && card.kind] || ['词条', 'mint']; // i18n-ignore
  return { icon, tone, kindLabel: t(kindLabel), classLabel: t(classLabel) };
}

// ---- the one dialog's state (module store; the game screen renders it once) --------------------------------------
let current = null;
const listeners = new Set();
const emit = () => { for (const fn of [...listeners]) fn(current); };

/** Open the detail popup for a payload built by ui/eventOverlay.js detailOf. */
export function openEntryDetail(detail) {
  if (!detail) return;
  current = detail;
  emit();
}

/** Close it (backdrop / Esc / the 关闭 button). */
export function closeEntryDetail() {
  if (!current) return;
  current = null;
  emit();
}

/** The game screen's subscription: the current payload, or null. */
export function useEntryDetail() {
  const [value, setValue] = useState(current);
  useEffect(() => {
    listeners.add(setValue);
    setValue(current);
    return () => { listeners.delete(setValue); };
  }, []);
  return value;
}

/**
 * The popup itself. `detail` is plain text resolved by the caller:
 *   { kind, key, name, icon, tone, kindLabel, classLabel, base, now, mag, subject, packLabel, targetLabel, picked,
 *     round, elite?: { name, share, count, effect } }
 */
export function EntryDetailDialog({ detail, onClose }) {
  if (!detail) return null;
  const ally = detail.kind === 'ally';
  const duration = Math.max(1, Math.min(EVENT_DURATION_ROUNDS, Math.trunc(Number(detail.duration) || EVENT_DURATION_ROUNDS)));
  const picked = detail.picked != null && Number.isFinite(Number(detail.picked)) ? Number(detail.picked) : null;
  const round = detail.round != null && Number.isFinite(Number(detail.round)) ? Number(detail.round) : null;
  const left = picked != null && round != null ? Math.max(0, picked + duration - round) : null;
  return html`<${Modal} open=${true} title=${detail.name} micro=${`ENTRY // ${t('词条说明')}`} tone=${detail.tone}
      width="min(92vw, 5.4rem)" onClose=${onClose} class="entrydlg"
      actions=${html`<${Button} variant="secondary" size="md" onClick=${onClose}>${t('关闭')}<//>`}>
    <div class="entrydlg__meta">
      <span class=${cx('entrydlg__badge', `is-${detail.tone}`)}>
        <${Icon} name=${detail.icon} />${detail.kindLabel}
      </span>
      <span class="entrydlg__class">${detail.classLabel}</span>
      ${left != null ? html`<span class="entrydlg__left">${t('剩余 {n} 回合', { n: left })}</span>` : null}
    </div>

    ${ally && detail.packLabel ? html`<p class="entrydlg__row">
      <span class="entrydlg__k">${t('归属')}</span>
      <span class="entrydlg__v" data-testid="entry-pack">${detail.packLabel}</span>
    </p>` : null}

    <p class="entrydlg__row">
      <span class="entrydlg__k">${t('作用对象')}</span>
      <span class="entrydlg__v">${detail.subject || detail.targetLabel || t('目标玩家')}${ally ? html` · ${t('持续 {n} 回合', { n: duration })}` : ''}</span>
    </p>

    <p class="entrydlg__row"><span class="entrydlg__k">${t('当前效果')}</span><span class="entrydlg__v">${detail.now || detail.base || '—'}</span></p>

    ${!ally && detail.elite ? html`<div class="entrydlg__elite">
      <p class="entrydlg__row"><span class="entrydlg__k">${t('强力属性')}</span><span class="entrydlg__v"><b>${detail.elite.name}</b>
        ${detail.elite.effect ? html` · ${detail.elite.effect}` : null}</span></p>
      <p class="entrydlg__row"><span class="entrydlg__k">${t('范围')}</span><span class="entrydlg__v">${t('本回合 {share}% 的敌人带「{attr}」', {
        share: Number(detail.elite.share) || 0, attr: detail.elite.name })} · ${t('共 {count} 只', { count: Number(detail.elite.count) || 0 })}</span></p>
    </div>` : null}

    <div class="entrydlg__notes">
      ${ally
        ? html`<p>${t('选对面发对面包（1 减益 + 2 中性），选自己或队友发我方包（1 增益 + 2 中性）；没被选中的玩家拿默认包（3 中性）')}</p>
          <p>${t('多个词条按环境乘区相乘：两个 +20% 是 ×1.44；攻速、技力等固定值先加到面板，不参与乘区。')}</p>`
        : html`<p>${t('怪物词条只改本回合双方战场的敌人波次，不改赏金。')}</p>${detail.elite ? html`<p>${t('强力属性在怪物词条之上再乘一次。')}</p>` : null}`}
    </div>
  <//>`;
}
