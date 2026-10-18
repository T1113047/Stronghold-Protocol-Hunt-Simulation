// server/http/routes.js — the node:http request listener. Every response gets the security headers (common.js), then:
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//   * a URL longer than 4096 characters → 414; one that does not parse → 400;
//   * /studio and /studio/… → the plugin studio (server/studio/index.js: for this machine and the local network only — any
//     other client gets the 404 page; its API also takes POST / PUT / DELETE), when the server has one;
//   * any method but GET / HEAD → 405 with `Allow: GET, HEAD` (the two loopback ops paths below also take POST);
//   * GET /healthz → JSON status (protocol `version`, release `app`, uptime, the served `build`, the vanilla content
//     hash `content.vanilla`, the modded content sets in use `content.sets` and — only when there are some — how many
//     unofficial plugins the server has, `content.plugins` (the title screen's count before any hello) — DESIGN §32 —,
//     sockets, sessions,
//     rooms, matches), never cached; `?traffic=1` adds the traffic counters (traffic.js: bytes by category since the
//     start, WebSocket wire and payload bytes) for a loopback or private-network client only — the maintainer's
//     decision of 2026-10-12: the figures are the host's, so any other client, also one a tunnel or proxy on this
//     machine forwards, gets the plain report (net.js clientAddress, honouring TRUST_PROXY like the WebSocket limits);
//   * the ops API the local QQ bot uses (server/http/rooms.js — 仅回环，静态处理之前):
//     GET /api/rooms (a snapshot of the rooms) and POST /api/rooms/reap (dispose dead rooms; POST only — a stray GET
//     must never sweep the lobby), plus POST /api/notify
//     (broadcast an `m.notice` to every open socket, net.js Network.broadcastNotice). A non-loopback peer or a
//     request carrying any forwarding header is answered 404, exactly like an unknown path — room codes never reach
//     the internet, and the API must not reveal that it exists;
//   * everything else → the static files (static.js).
// Every response's body bytes count in the traffic counters (traffic.js meter). A route that throws is logged and
// answers 500.

import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/constants.js';
import { buildTag } from './buildTag.js';
import { setSecurityHeaders, sendError, sendJson, splitUrl } from './common.js';
import { isReapPath, readBody, reapRooms, roomsApiAllowed, roomsPayload, REAP_BODY_MAX } from './rooms.js';
import { clientAddress, isLocalIp } from '../net.js';

/** 严格回环（更新接口只认这个；isLocalIp 还包含局域网）。 */
const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

const MAX_URL_LENGTH = 4096;
/** POST /api/notify body cap (one announcement text, net.js NOTICE_MAX_LEN is 200 code points). */
const NOTIFY_BODY_MAX = 4096;

/** `{ plugins: n }` when the server has n > 0 unofficial plugins (the lobby's visual sets count them), else nothing. */
function pluginCount(lobby) {
  let n;
  try { n = Number(lobby?.plugins?.unofficial?.()) || 0; } catch { n = 0; }
  let notices = false;
  try { notices = lobby?.plugins?.hasNotices?.() === true; } catch { /* optional catalogue hint */ }
  return { ...(n > 0 ? { plugins: n } : {}), ...(notices ? { notices: true } : {}) };
}

/** The content sets with gameplay plugins rooms hold now (DESIGN §32.6; 0 without any). */
function contentSets(lobby) {
  try { return Number(lobby?.plugins?.contentInUse?.()) || 0; } catch { return 0; }
}

/**
 * The GET /healthz body (`withTraffic`: plus the traffic counters and the asset index's state, `?traffic=1`).
 * @param {{ startedAt: number, network: import('../net.js').Network, registry: import('../net.js').SessionRegistry,
 *           lobby: import('../lobby.js').Lobby, content?: { cs: string } | null,
 *           traffic?: ReturnType<typeof import('./traffic.js').createTrafficCounter>,
 *           assetIndex?: ReturnType<typeof import('./assetIndex.js').createAssetIndex> | null,
 *           views?: ReturnType<typeof import('./assetViews.js').createManifestViews> | null }} health
 *   content: the server's vanilla content (server/plugins/identity.js)
 * @param {boolean} [withTraffic]
 */
export function healthReport({ startedAt, network, registry, lobby, content = null, traffic, assetIndex, views, trusted }, withTraffic = false) {
  const report = {
    ok: true, version: PROTOCOL_VERSION, app: APP_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    // the runtime the server is serving right now (public/js/ui/buildGuard.js): a page whose own build is
    // older than this reloads itself, so a deploy reaches clients that never reload
    build: buildTag(),
    // what its rooms play (DESIGN §32): the vanilla content hash, and how many content sets with gameplay plugins rooms
    // hold now (P1c, §32.6 — a room's cosmetic plugins leave its cs the vanilla one, §32.3); how many unofficial plugins
    // it has, when it has some (a page's title screen says so; P1a)
    ...(content ? { content: { vanilla: content.cs, sets: contentSets(lobby), ...pluginCount(lobby) } } : {}),
    sockets: network.connectionCount, sessions: registry.size, ...lobby.stats(),
  };
  if (trusted && Object.keys(trusted).length) report.plugins = trusted;
  if (withTraffic && traffic) report.traffic = traffic.snapshot();
  // content-hashed asset URLs (assetIndex.js / assetViews.js): off, building, or ready with how many files and URLs
  if (withTraffic) report.assetHashes = assetIndex ? { ...assetIndex.stats(), views: views ? views.stats() : null } : null;
  return report;
}

/** Does the query ask for the traffic counters (`traffic`, `traffic=1`, `traffic=true`)? */
const wantsTraffic = (query) => /(?:^|&)traffic(?:=(?:1|true|yes))?(?:&|$)/i.test(query || '');

/**
 * The request listener for `http.createServer`.
 * @param {{ serveStatic: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
 *             rawPath: string, query: string) => Promise<void>,
 *           health: Parameters<typeof healthReport>[0], log: object, trustProxy?: 'auto' | boolean,
 *           csp?: string | null,
 *           studio?: { handles: (rawPath: string) => boolean, handle: (req: any, res: any, rawPath: string, query: string) => Promise<void> } | null }} deps
 *   trustProxy: whose forwarding headers name the client (net.js clientAddress; the server's TRUST_PROXY); studio: the
 *   plugin studio (server/studio/index.js), or none
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestHandler({ serveStatic, health, log, trustProxy = 'auto', studio = null, csp = null, trustedRuntime = null, updater = null }) {
  async function handleRequest(req, res) {
    const url = req.url || '/';
    if (url.length > MAX_URL_LENGTH) { sendError(req, res, 414, '请求地址过长 · URI too long'); return; }
    const parts = splitUrl(url);
    if (!parts) { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    if (trustedRuntime && parts.rawPath.startsWith('/x/') && await trustedRuntime.route(req,res,parts.rawPath)) return;
    if (studio && studio.handles(parts.rawPath)) { await studio.handle(req, res, parts.rawPath, parts.query); return; }
    const reapPath = isReapPath(parts.rawPath);          // [ROOMS-API] POST /api/rooms/reap
    const notifyPath = parts.rawPath === '/api/notify';  // [NOTICE] POST /api/notify
    const postPath = reapPath || notifyPath;
    if (req.method !== 'GET' && req.method !== 'HEAD' && !(postPath && req.method === 'POST')) {
      res.setHeader('Allow', postPath ? 'GET, HEAD, POST' : 'GET, HEAD');
      sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
      return;
    }
    if (parts.rawPath === '/healthz') {
      const withTraffic = wantsTraffic(parts.query) && isLocalIp(clientAddress(req, trustProxy).ip);
      sendJson(req, res, 200, healthReport(health, withTraffic));
      return;
    }
    // [UPDATE] 在线更新（设置 → 游戏更新）：只有本机回环能检查/应用；非本机一律 404（不暴露存在性）
    if (parts.rawPath === '/api/update/status' || parts.rawPath === '/api/update/check' || parts.rawPath === '/api/update/apply') {
      if (!isLoopback(clientAddress(req, trustProxy).ip)) { sendError(req, res, 404, '未找到 · Not found'); return; }
      const isApply = parts.rawPath === '/api/update/apply';
      if (isApply ? req.method !== 'POST' : (req.method !== 'GET' && req.method !== 'HEAD')) {
        sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
        return;
      }
      if (!updater) { sendJson(req, res, 200, { ok: false, error: 'unavailable' }); return; }
      if (!isApply) {
        const cur = updater.current();
        if (parts.rawPath === '/api/update/status') { sendJson(req, res, 200, { ok: true, allowed: true, current: cur }); return; }
        try {
          const latest = await updater.check(true);
          sendJson(req, res, 200, { ok: true, allowed: true, current: cur, latest });
        } catch (e) {
          sendJson(req, res, 200, { ok: false, allowed: true, current: cur, error: 'github', detail: String(e && e.message ? e.message : e) });
        }
        return;
      }
      try {
        const raw = (await readBody(req, 4096)).toString('utf8');
        const body = raw ? JSON.parse(raw) : {};
        const out = await updater.apply(String(body.kind || ''));
        sendJson(req, res, 200, { ok: true, ...out });
      } catch (e) {
        sendJson(req, res, 200, { ok: false, error: 'update', detail: String(e && e.message ? e.message : e) });
      }
      return;
    }
    // [ROOMS-API] 运维查询接口（本机 QQ 机器人）：GET /api/rooms 快照 · POST /api/rooms/reap 收房。
    // 仅回环；非回环 peer 或带任何转发头 → 404（和未知道路一样，不暴露存在性）。放在静态处理之前。
    if (parts.rawPath === '/api/rooms' || reapPath) {
      if (!roomsApiAllowed(req)) { sendError(req, res, 404, '未找到 · Not found'); return; }
      // ▸ the reaper is a write path: a stray GET must never sweep the lobby (the reference answered GET like a POST).
      // The guard sits after the loopback refusal, so a forwarded request still sees the ordinary 404.
      if (reapPath && req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
        return;
      }
      if (!reapPath) { sendJson(req, res, 200, roomsPayload(health.lobby)); return; }
      let payload = {};
      try {
        const text = await readBody(req, REAP_BODY_MAX);
        if (text.trim()) payload = JSON.parse(text);
      } catch (e) {
        if (e && e.code === 'E_TOO_LARGE') sendJson(req, res, 413, { ok: false, error: 'body-too-large' });
        else sendJson(req, res, 400, { ok: false, error: 'bad-body' });
        return;
      }
      sendJson(req, res, 200, reapRooms(health.lobby, payload, log));
      return;
    }
    // [NOTICE] 服务器通知（仅回环）：text 清洗后作为 `m.notice` 广播给所有在线连接（大厅 / 房间 / 对局中）。
    if (notifyPath) {
      if (!roomsApiAllowed(req) || !health.network || typeof health.network.broadcastNotice !== 'function') {
        sendError(req, res, 404, '未找到 · Not found');
        return;
      }
      let payload = {};
      try {
        const text = await readBody(req, NOTIFY_BODY_MAX);
        if (text.trim()) payload = JSON.parse(text);
      } catch (e) {
        if (e && e.code === 'E_TOO_LARGE') sendJson(req, res, 413, { ok: false, error: 'body-too-large' });
        else sendJson(req, res, 400, { ok: false, error: 'bad-body' });
        return;
      }
      // ▸ JSON.parse may hand back null / a primitive: read `text` defensively (a bare `payload.text` would throw).
      const text = String(payload && typeof payload === 'object' ? payload.text ?? '' : '').trim();
      if (!text) { sendJson(req, res, 400, { ok: false, error: 'empty' }); return; }
      const sent = health.network.broadcastNotice(text);
      sendJson(req, res, 200, { ok: true, sent });
      return;
    }
    await serveStatic(req, res, parts.rawPath, parts.query);
  }

  return (req, res) => {
    setSecurityHeaders(res);
    if (csp) res.setHeader('Content-Security-Policy', csp);
    if (health.traffic) health.traffic.meter(res, splitUrl(req.url || '/')?.rawPath || '/');
    handleRequest(req, res).catch((e) => {
      log.error('[http] request failed', e);
      sendError(req, res, 500, '服务器内部错误 · Internal error');
    });
  };
}
