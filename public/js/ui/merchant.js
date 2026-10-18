// 商人「坎诺特」(2V2, user 2026-10-17) — the 赏金 desk of the prep screen. 赏金 (the bounties of killing monsters the
// OPPONENT PLACED) is NOT gold: it is banked on the server-side PlayerState.bountyBank and the ONLY way to turn it into
// 金币 is a withdrawal here (Match.withdrawBounty: rate by absolute round, cost = gold / rate, the round's first
// withdrawal ceil and the later ones floor, at most VERSUS_CONFRONT.merchantRoundCap gold a round — R15 uncapped).
//
// The avatar is the OFFICIAL strategy 坎诺特 (data/bands.json band_cannot, iconId icon_cannot) through the usual band
// icon URL (ui/assetUrls.bandIconUrl) — no new asset. The button sits ABOVE the funds (金币) card; the dialog lists the
// four withdrawals (1 / 2 / 4 / all) with the 赏金 each costs, and takes two taps like every other spend (ui/shopBar.js).
import { useState } from '../../vendor/hooks.module.js';
import { html, Modal, Icon, MicroLabel } from './components.js';
import { Img, CoinGlyph, useGameData } from './gameComponents.js';
import { bandIconUrl } from './assetUrls.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * @param {{ merchant: any, editable?: boolean, busy?: boolean, onWithdraw?: (gold: number) => void, class?: string,
 *   vertical?: boolean, versus?: boolean, remind?: boolean }} props
 *   `merchant` = m.private.merchant (server-authored: { bank, rate, cap, withdrawn, left, max, options[] }) or null.
 *   `versus`: 2V2 (the prey is the opponent's placement) vs 同盟狩猎 (the system places it) — the tip's wording only.
 *   `remind`: the last round and the bank is still non-zero — pulse the merchant until the bounty is withdrawn.
 */
export function Merchant({ merchant, editable = false, busy = false, onWithdraw, class: cls, vertical = false, versus = false, remind = false }) {
  const gd = useGameData();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(null);
  if (!merchant) return null;
  const bank = Math.max(0, Number(merchant.bank) || 0);
  const rate = Math.round((Number(merchant.rate) || 0) * 100);
  const left = merchant.left == null ? null : Math.max(0, Number(merchant.left) || 0);
  // the server's `max` = min(本回合剩余上限, floor(bank × rate)) — what can ACTUALLY be taken this round, not just `left`
  const max = merchant.max != null && Number.isFinite(Number(merchant.max)) ? Math.max(0, Math.trunc(Number(merchant.max))) : left;
  const options = Array.isArray(merchant.options) ? merchant.options : [];
  const one = options.find((o) => o && !o.all && Number(o.gold) === 1) || null;
  const oneCost = one && Number.isFinite(Number(one.cost)) ? Number(one.cost) : null;
  const canOpen = editable && !busy;
  const close = () => { setOpen(false); setArmed(null); };
  const pick = (opt) => {
    if (!canOpen || !opt || !opt.enabled || !(Number(opt.gold) > 0)) return;
    if (armed !== opt.gold) { setArmed(opt.gold); return; }
    setArmed(null);
    onWithdraw?.(opt.gold);
  };
  return html`<div class=${cx('merchant', vertical && 'merchant--v', remind && 'merchant--remind', cls)}>
    <button type="button" class="merchant__btn" data-testid="merchant-btn" disabled=${!canOpen}
      title=${remind ? t('最后一回合：还有赏金未取出，点击坎诺特兑换') : t('存在坎诺特处的赏金')} aria-label=${t('坎诺特')} aria-disabled=${canOpen ? 'false' : 'true'}
      onClick=${() => { if (canOpen) { setOpen(true); setArmed(null); } }}>
      <span class="merchant__art"><${Img} src=${bandIconUrl(gd.m, 'band_cannot')} fallback=${html`<${CoinGlyph} />`} /></span>
      ${bank > 0 ? html`<span class="merchant__bank num" data-testid="merchant-bank">${bank}</span>` : null}
    </button>
    <span class="merchant__label">${remind ? t('最后回合 · 取出赏金') : t('赏金')}</span>

    <${Modal} open=${open} onClose=${close} title=${t('坎诺特')} micro="MERCHANT // BOUNTY" width="6.9rem" class="merchant-dlg">
      <div class="merchant__head">
        <span class="merchant__art merchant__art--lg"><${Img} src=${bandIconUrl(gd.m, 'band_cannot')} fallback=${html`<${CoinGlyph} />`} /></span>
        <div class="merchant__stats">
          <span class="merchant__stat"><b class="num" data-testid="merchant-bank-dlg">${bank}</b><span>${t('赏金')}</span></span>
          <span class="merchant__stat"><b class="num">${rate}%</b><span>${oneCost != null ? t('1 金币 = {cost} 赏金', { cost: oneCost }) : t('当前兑换率')}</span></span>
          <span class="merchant__stat" data-testid="merchant-left"><b class="num">${max == null ? '∞' : max}</b><span>${max == null ? t('本回合取款不限') : t('本回合最多可取 {n} 金币', { n: max })}</span></span>
        </div>
      </div>
      <div class="merchant__opts">
        ${options.map((opt) => html`<button key=${opt.all ? 'all' : opt.gold} type="button"
          class=${cx('merchant__opt', opt.all && 'is-all', !opt.enabled && 'is-off', armed === opt.gold && 'is-armed')}
          disabled=${!canOpen || !opt.enabled} aria-disabled=${canOpen && opt.enabled ? 'false' : 'true'}
          data-testid=${opt.all ? 'merchant-all' : `merchant-gold-${opt.gold}`}
          aria-label=${t('取 {gold} 金币（消耗 {cost} 赏金）', { gold: opt.gold, cost: opt.cost })}
          onClick=${() => pick(opt)}>
          <span class="merchant__optgold">${opt.all ? t('全取出') : t('取 {gold} 金币', { gold: opt.gold })}</span>
          <span class="merchant__optcost num">${t('消耗 {cost} 赏金', { cost: opt.cost })}</span>
          ${armed === opt.gold ? html`<span class="merchant__arm">${t('再次点击确认')}</span>` : null}
        </button>`)}
      </div>
      ${bank <= 0
        ? html`<p class="merchant__lack" data-testid="merchant-lack"><${Icon} name="warn" />${t('赏金不足')}</p>`
        : left === 0
          ? html`<p class="merchant__lack" data-testid="merchant-lack"><${Icon} name="warn" />${t('本回合的取款已达上限')}</p>`
          : max === 0
            ? html`<p class="merchant__lack" data-testid="merchant-lack"><${Icon} name="warn" />${t('至少需要 {cost} 赏金才能取 1 金币', { cost: oneCost ?? 0 })}</p>`
            : null}
      <p class="merchant__tip"><${MicroLabel} tone="gold">BOUNTY → GOLD</MicroLabel>${versus
        ? t('击杀对面投放的怪才能获得赏金，且只能在坎诺特处换成金币。')
        : t('击杀狩猎期的投放怪才能获得赏金，且只能在坎诺特处换成金币。')}</p>
    </${Modal}>
  </div>`;
}
