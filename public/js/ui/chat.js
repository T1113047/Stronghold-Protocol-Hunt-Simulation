// [CHAT] In-match text chat — the free-text counterpart of ui/emotes.js (the 交流 wheel needs no typing).
//
//   ChatBox          the bottom-left control (above the 交流 row): a text field + send key, and a scrollback of the
//                    last lines (name: text), expanded by default (click the icon to fold it; the icon then carries an
//                    unread dot). Enter sends, Escape folds. Rendered by screens/game.js in the corner stack; a
//                    spectator gets it read-only with the `lockHint`; an eliminated seat may still type (the server
//                    accepts chat from eliminated-but-online seats — the [CHATLOG] rule, mirrored here).
//   chatBubblesActive keeps the newest line per sender within `ttl`, so the team panel shows a short bubble beside the
//                    sender's avatar (same idea as activeBubbles for emotes; the panel reuses the .ebubble--text style).
//
// Text is plain (Preact escapes it) and the server already trimmed / capped / stripped control characters; here we only
// trim for the send button's enabled state. Strings use Chinese msgids with an automatic fallback (shared/i18n.js).

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { GIcon } from './gameComponents.js';
import { t } from '../../../shared/i18n.js';

/** How long a chat bubble stays beside the sender's avatar. */
export const CHAT_BUBBLE_MS = 5000;

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** playerId → display name, from the match's public players (fallback for a line without its own `name`). */
function namesOf(pub) {
  const map = new Map();
  for (const p of Array.isArray(pub?.players) ? pub.players : []) {
    if (p && typeof p.playerId === 'string') map.set(p.playerId, String(p.name || ''));
  }
  return map;
}

/**
 * Newest chat line per sender still within `ttl`, keyed by playerId. Skips clock-skewed future timestamps.
 * @param {Array<{playerId:string,name?:string,text:string,seq:number,at:number}>} messages
 * @param {number} now
 * @param {number} [ttl]
 * @returns {Map<string, {text:string, seq:number, at:number}>}
 */
export function chatBubblesActive(messages, now, ttl = CHAT_BUBBLE_MS) {
  const out = new Map();
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m.text !== 'string' || !m.text) continue;
    if (!(now - m.at < ttl) || m.at > now + 1000) continue;
    const cur = out.get(m.playerId);
    if (!cur || cur.seq < m.seq) out.set(m.playerId, { text: m.text, seq: m.seq, at: m.at });
  }
  return out;
}

/**
 * Sender's short speech bubble beside the team row (reuses the emote bubble's .ebubble--text look; its ttl is the
 * --ebubble-ttl CSS var, so a chat line can linger longer than an emote). The parent keys it by the line's seq.
 * @param {{ text: string, at?: number, ttl?: number, class?: string }} props
 */
export function ChatBubble({ text, at, ttl = CHAT_BUBBLE_MS, class: cls }) {
  const life = Math.max(300, Number(ttl) || CHAT_BUBBLE_MS);
  const [age] = useState(() => {
    const a = Number.isFinite(at) ? Date.now() - at : 0;
    return a > 0 ? Math.min(a, life) : 0;
  });
  const style = [`--ebubble-ttl:${life}ms`, age && `--ebubble-age:${Math.round(age)}ms`].filter(Boolean).join(';');
  return html`<div class=${cx('ebubble', 'ebubble--text', cls)} style=${style} role="log">
    <span class="ebubble__txt">${text}</span>
  </div>`;
}

/**
 * Bottom-left chat control (局内对话).
 *   * 常驻展开：默认展开并显示最近发言；点击左上角图标收起、再点展开（收起时图标出未读红点）。
 *   * 点击组件外部不再自动收起（常驻展开）。
 *   * 仅在线且在局内可发送：`disabled` 为真时只读（可看历史、输入与发送禁用），`lockHint` 给出禁用原因。
 * @param {{ messages: Array<{playerId:string,name?:string,text:string,seq:number,at:number}>, pub: any, myId: string,
 *   onSend: (text:string)=>void, disabled?: boolean, lockHint?: string|null }} props
 */
export function ChatBox({ messages, pub, myId, onSend, disabled = false, lockHint = null }) {
  const [open, setOpen] = useState(true); // 常驻展开（默认展开，点击收起）
  const [text, setText] = useState('');
  const [unread, setUnread] = useState(0);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const seenRef = useRef(0);
  const names = namesOf(pub);
  const list = Array.isArray(messages) ? messages : [];
  const lastSeq = list.length ? list[list.length - 1].seq : 0;

  // mark everything already present as read on mount (rejoining a match shows no stale unread; `lastSeq` of that render)
  useEffect(() => { if (seenRef.current === 0) seenRef.current = lastSeq; }, []);

  // unread badge: count lines that arrive while the log is collapsed (the same `list` as the render above)
  useEffect(() => {
    if (open) { seenRef.current = lastSeq; setUnread(0); return; }
    if (lastSeq > seenRef.current) setUnread(list.filter((m) => m.seq > seenRef.current).length);
  }, [lastSeq, open]);

  // while open: pin the log to the newest line
  useEffect(() => {
    if (!open) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, list.length]);

  // 不自动聚焦输入框：常驻展开也不把光标放进输入框（不抢游戏键盘；要打字时玩家自己点输入框）
  const toggle = () => setOpen((v) => !v);
  const send = () => {
    const body = text.trim();
    if (!body || disabled) return;
    onSend(body);
    setText('');
  };
  const onKeyDown = (e) => {
    e.stopPropagation(); // never let a game hotkey see the typing
    if (e.key === 'Enter') { e.preventDefault(); send(); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); e.currentTarget.blur(); }
  };
  const placeholder = disabled && lockHint ? lockHint : t('发送消息…');

  return html`<div class=${cx('gchat', open && 'is-open')}>
    <button type="button" class="gchat__toggle" aria-label=${t('聊天')} aria-expanded=${open ? 'true' : 'false'}
      title=${open ? t('收起聊天') : t('聊天')} onClick=${toggle}>
      <${GIcon} name="chat" />
      ${unread > 0 && !open ? html`<span class="gchat__badge" role="status" aria-label=${t('有 {n} 条新消息', { n: unread })}></span>` : null}
    </button>
    ${open ? html`<div class="gchat__log" ref=${logRef} role="log" aria-label=${t('聊天记录')}>
      ${list.length
        ? list.map((m) => html`<div key=${m.seq} class=${cx('gchat__line', m.playerId === myId && 'is-self')}>
            <span class="gchat__name">${m.name || names.get(m.playerId) || t('队友')}</span>
            <span class="gchat__text">${m.text}</span>
          </div>`)
        : html`<div class="gchat__empty">${t('暂无聊天')}</div>`}
    </div>` : null}
    <input class="gchat__input" type="text" inputmode="text" autocomplete="off" maxlength="80" ref=${inputRef}
      placeholder=${placeholder} aria-label=${placeholder} disabled=${disabled}
      value=${text} onInput=${(e) => setText(e.currentTarget.value)} onKeyDown=${onKeyDown}
      onFocus=${() => setOpen(true)} />
    <button type="button" class="gchat__send" aria-label=${t('发送')} title=${t('发送')}
      disabled=${disabled || !text.trim()} onClick=${send}>
      <${GIcon} name="send" />
    </button>
  </div>`;
}
