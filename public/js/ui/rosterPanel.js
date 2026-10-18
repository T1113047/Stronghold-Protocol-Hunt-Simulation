// 公示面板 (roster) — the ONE presentation the hunt / event holds share (user 2026-10-17): the 2V2 悬赏名单, the
// 同盟狩猎 本回合投放公示 and the 事件期 词条公示 are the same shape, so they must not keep three copies:
//
//   <RosterPanel title rows until>  →  a title, one row per line (callers pass the row's own markup), and the server's
//   countdown ("X 秒后开始作战") driven by `until` through the existing ticker + secondsLeft (solo pause / clock offset
//   already handled there). The component owns no game data: `rows` may be strings, vnodes or { key, body, class }, and
//   `children` is the optional block under the list (a 投放公示's monster entry + 强力属性, a tip…).
//
// Callers: ui/confrontOverlay.js (2V2 roster + coop plans + the post-battle clash), ui/eventOverlay.js (词条公示).
import { html, MicroLabel, useTicker, secondsLeft } from './components.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const isRow = (r) => r && typeof r === 'object' && !Array.isArray(r);
const bodyOf = (r) => (isRow(r) && 'body' in r ? r.body : r);

/**
 * @param {{ title: any, micro?: any, tone?: string, rows?: any[], until?: number, note?: any,
 *   children?: any, className?: string, testid?: string }} props
 *   rows: a string / vnode / { key, body, class, heading } — `heading` draws a group line ('我方' / '对面').
 *   until: server epoch ms of the hold (0 / absent = no countdown, e.g. the post-battle clash).
 */
export function RosterPanel({ title, micro = null, tone = 'gold', rows = [], until = 0, note = null, children = null, className = '', testid = 'roster-panel' }) {
  const live = Number(until) > 0;
  useTicker(live ? 250 : 0);
  const remain = live ? secondsLeft(until) : null;
  if (!rows.length && !children) return null;
  return html`<div class=${cx('spov rospov', className)} role="dialog" aria-label=${typeof title === 'string' ? title : ''} data-testid=${testid}>
    <div class="spov__veil" aria-hidden="true"></div>
    <div class="spov__inner">
      <header class="spov__head">
        <div class="spov__titles">
          <h2 class="spov__title"><span class="spov__name">${micro ? html`<${MicroLabel} tone=${tone}>${micro}</${MicroLabel}>` : null}${title}</span></h2>
        </div>
        ${remain != null ? html`<span class="rospov__timer" data-testid="roster-timer" role="timer">
          ${t('{s} 秒后开始作战', { s: remain })}
        </span>` : null}
      </header>
      ${rows.length ? html`<ul class="rospov__rows" data-testid="roster-rows">
        ${rows.map((r, i) => (isRow(r) && r.heading
          ? html`<li key=${r.key || `h${i}`} class="rospov__group">${r.heading}</li>`
          : html`<li key=${(isRow(r) && r.key) || i} class=${cx('rospov__row', isRow(r) && r.class)}>${bodyOf(r)}</li>`))}
      </ul>` : null}
      ${children || null}
      ${note ? html`<p class="rospov__note t-dim">${note}</p>` : null}
    </div>
  </div>`;
}
