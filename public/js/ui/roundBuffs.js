// 本回合的词条 (team panel): a small, always-on strip under the last seat row (P4) that says which 事件期 entries are in
// effect THIS round — one line per entry, with the same names and effect numbers as the 事件期 overlay.
//
// Sources (m.public.event, server/match/match/event.js eventView):
//   ally.history  every pick of the match: { round, index, playerId, target, targetId, card, key, kind, mag, auto }
//   ally.targets  { [pickerId]: { self, mate, oppA, oppB } } — the playerId of each target key
//   foe           this period's monster entry: { round, card, key, elite: { share, attr, count } }
//
// The ally lines are "who RECEIVED it", not "what I picked": another player may send their entry to me. A record counts
// when it is still in force this round (`round` ∈ [picked, picked + duration − 1], EVENT_DURATION_ROUNDS — an expired
// entry is no longer shown) and its receiver resolves to myId. The receiver is
// ally.targets[pickerId][target] (the map's meaning at view time) or, when that map no longer carries the picker / key,
// the record's own `targetId` (written by the server at pick time — a co-op mate can be recomputed when a teammate
// leaves). A record predating `target` has no receiver at all and is SKIPPED — never guessed, never thrown on.
// The monster line is this round's foe entry only (`foe.round === pub.round`), with the 强力属性 share / attribute
// merged into the same line. Outside a hunt mode m.public.event is null, so nothing renders there; a round without an
// event renders nothing either, and no empty row is left behind.
//
// The names, the effect lines and the receiver rule come from ui/eventOverlay.js (ALLY_NAMES / FOE_NAMES / allyEffect /
// foeEffect / eventAllyCard / eventFoeCard / eventReceiver) — never a second copy of the 24 + 12 card tables. No new
// msgids: the 强力属性 line is the overlay's own 「本回合 {share}% 的敌人带「{attr}」」.
import { html, Icon } from './components.js';
import { t } from '../../../shared/i18n.js';
import { EVENT_DURATION_ROUNDS } from '../../../shared/constants.js';
import { ALLY_NAMES, FOE_NAMES, allyEffect, foeEffect, eventAllyCard, eventFoeCard, eventReceiver, detailOf } from './eventOverlay.js';
import { openEntryDetail } from './entryDetail.js';

export { eventReceiver };

/**
 * The strip's rows, in reading order: every entry I received that is still in force this round (in history order),
 * then the round's monster entry with its 强力属性. An ally entry lasts `duration` rounds from its pick
 * (`EVENT_DURATION_ROUNDS`; server m.public.event.ally.duration, falling back to the shared constant). Empty outside a
 * hunt mode, without an event this round, or on a spectator seat with nothing in force.
 * @param {any} pub m.public
 * @param {string|null} myId the viewer's playerId
 * @returns {Array<{ kind: 'ally'|'foe', key: string, name: string, effect: string, elite: string, title: string }>}
 */
export function roundBuffRows(pub, myId) {
  const ev = pub && pub.event;
  if (!ev || !myId) return [];
  const round = Math.trunc(Number(pub.round));
  if (!Number.isFinite(round) || round <= 0) return [];
  const ally = ev.ally || {};
  const foe = ev.foe || null;
  const targets = ally.targets && typeof ally.targets === 'object' ? ally.targets : {};
  const history = Array.isArray(ally.history) ? ally.history : [];
  const fallbackDuration = Math.max(1, Math.trunc(Number(ally.duration) || EVENT_DURATION_ROUNDS));
  const rows = [];
  for (const rec of history) {
    const picked = Math.trunc(Number(rec && rec.round));
    if (!Number.isFinite(picked)) continue;
    const card = eventAllyCard(rec);
    if (!card) continue;
    const duration = Math.max(1, Math.trunc(Number(rec.duration ?? card.duration) || fallbackDuration));
    if (round < picked || round >= picked + duration) continue;
    if (eventReceiver(rec, targets) !== myId) continue;
    const mag = Number(rec.mag) || 1;
    const name = t(ALLY_NAMES[card.key] || card.key);
    const effect = allyEffect(card, mag);
    rows.push({
      kind: 'ally', key: card.key, name, effect, elite: '', title: effect ? `${name} ${effect}` : name,
      detail: detailOf('ally', card, { mag, picked, round, target: 'self', duration }),
    });
  }
  if (foe && Number(foe.round) === round) {
    const card = eventFoeCard(foe);
    if (card) {
      const name = t(FOE_NAMES[card.key] || card.key);
      const effect = foeEffect(card);
      const e = foe.elite;
      const attr = e && e.attr ? (FOE_NAMES[e.attr] ? t(FOE_NAMES[e.attr]) : String(e.attr)) : '';
      // the server's share is a 0…1 fraction of the wave (event.js _drawFoeElite); the overlay rounds it the same way
      const elite = attr ? t('本回合 {share}% 的敌人带「{attr}」', { share: Math.round((Number(e.share) || 0) * 100), attr }) : '';
      rows.push({
        kind: 'foe', key: card.key, name, effect, elite, title: [name, effect, elite].filter(Boolean).join(' '),
        detail: detailOf('foe', card, { elite: e }),
      });
    }
  }
  return rows;
}

/**
 * The team panel's 本回合词条 strip (rendered after the player rows, i.e. under P4). Each row is one line; CSS truncates
 * it with an ellipsis and the `title` carries the whole text.
 * @param {{ pub: any, myId: string|null }} props
 */
export function RoundBuffs({ pub, myId }) {
  const rows = roundBuffRows(pub, myId);
  return html`<div class="rbuffs" data-testid="round-buffs">
    <div class="rbuffs__title">${t('本期事件词条')}</div>
    ${rows.length
      ? rows.map((r, i) => html`<button key=${`${r.kind}:${i}`} type="button"
          class=${`rbuff rbuff--${r.kind} rbuff--${(r.detail && r.detail.tone) || 'mint'}`}
          data-testid=${`round-buff-${r.kind}`} title=${`${r.title} · ${t('点击查看词条说明')}`}
          onClick=${() => openEntryDetail(r.detail)}>
          <span class="rbuff__icon"><${Icon} name=${(r.detail && r.detail.icon) || 'info'} /></span>
          <b class="rbuff__name">${r.name}</b>${r.effect ? html` <span class="rbuff__eff">${r.effect}</span>` : null}${r.elite ? html` <span class="rbuff__elite">${r.elite}</span>` : null}
          <span class="rbuff__more"><${Icon} name="info" /></span>
        </button>`)
      : html`<div class="rbuff rbuff--none" data-testid="round-buff-none">${t('暂无')}</div>`}
  </div>`;
}
