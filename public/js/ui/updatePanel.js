// [UPDATE] 设置 → 游戏更新：从本仓库的 GitHub Release 检查并应用更新。
//
// 只在服务器本机可见（/api/update/status 对非回环返回 404，本组件随之不渲染）。
// 两种包：更新包（只覆盖 UPDATE.json.from 里的版本，不允许跨版本）与精简包（可跨版本）。
import { html, Button, MicroLabel } from './components.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { t } from '../../../shared/i18n.js';

/** Compare two dotted versions; >0 when a is newer. */
function cmp(a, b) {
  const x = String(a || '').split(/[.+-]/).slice(0, 3).map((n) => Number(n) || 0);
  const y = String(b || '').split(/[.+-]/).slice(0, 3).map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** @param {{ fetchImpl?: typeof fetch }} [props] (tests inject a stub) */
export function UpdateSection({ fetchImpl = globalThis.fetch } = {}) {
  const [current, setCurrent] = useState(null); // { app, fork } once the server says this machine may update
  const [latest, setLatest] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState(null); // { kind: 'ok'|'warn'|'err', text }

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => fetchImpl('/api/update/status'))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((j) => { if (live && j && j.allowed) setCurrent(j.current || {}); })
      .catch(() => {});
    return () => { live = false; };
  }, [fetchImpl]);

  if (!current) return null;

  const call = async (url, init) => {
    const res = await fetchImpl(url, init);
    const j = await res.json().catch(() => null);
    if (!j) throw new Error('bad reply');
    if (!j.ok) throw new Error(j.detail || j.error || 'failed');
    return j;
  };

  const check = async () => {
    setBusy('check');
    setNote(null);
    try {
      const j = await call('/api/update/check');
      setLatest(j.latest || null);
    } catch (e) {
      setNote({ kind: 'err', text: t('更新失败：{reason}', { reason: String(e.message || e) }) });
    } finally { setBusy(''); }
  };

  const apply = async (kind) => {
    setBusy(kind);
    setNote(null);
    try {
      const j = await call('/api/update/apply', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }),
      });
      setNote({
        kind: 'ok',
        text: j.restart === 'auto'
          ? t('更新完成：{version}，正在重启…', { version: j.version })
          : t('更新完成：{version}，请手动重启服务器', { version: j.version }),
      });
    } catch (e) {
      setNote({ kind: 'err', text: t('更新失败：{reason}', { reason: String(e.message || e) }) });
    } finally { setBusy(''); }
  };

  const newer = latest && cmp(latest.version, current.fork) > 0;
  const hasLite = !!(latest && latest.lite);

  return html`<section class="set-update" aria-labelledby="set-update-title" data-testid="game-update">
    <div class="set-row">
      <span class="set-row__label" id="set-update-title">${t('游戏更新')}<${MicroLabel}>GAME UPDATE<//></span>
      <div class="set-update__now">${current.fork}（${current.app}）</div>
    </div>
    ${latest ? html`<p class="set-hint" data-testid="update-latest">
      ${newer ? t('发现新版本 {version}', { version: latest.tag || latest.version })
              : t('已是最新版本 {version}', { version: latest.tag || latest.version })}
    </p>` : null}
    <div class="set-seg set-update__actions">
      <${Button} variant="secondary" icon="download" disabled=${busy === 'check'} onClick=${check}>
        ${latest ? t('重新检查') : t('检查更新')}<//>
      ${newer && hasLite ? html`<${Button} variant="primary" icon="download" disabled=${!!busy}
        onClick=${apply}>${t('下载并更新（精简包）')}<//>` : null}
    </div>
    ${busy === 'apply' ? html`<p class="set-hint">${t('正在下载并应用…')}</p>` : null}
    ${note ? html`<p class=${`set-hint set-update__note is-${note.kind}`} data-testid="update-note">${note.text}</p>` : null}
    <p class="set-hint">${t('只从本仓库的 GitHub Release 拉取；更新会下载目标版本与当前版本的精简包做差分，只覆盖变化的文件，未变化的本地文件（含本地补丁）保持原样。更新会重启服务器并结束当前对局。')}</p>
  </section>`;
}
