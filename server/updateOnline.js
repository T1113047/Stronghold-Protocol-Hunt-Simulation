// server/updateOnline.js — 在线更新：从本仓库的 GitHub Release 拉最新包并应用（设置 → 游戏更新）。
//
// 只支持两种资产：
//   Hunt-Simulation-v<ver>-update.zip  只含相对旧包的差异（UPDATE.json.from 必须包含当前版本 → 不允许跨版本）
//   Hunt-Simulation-v<ver>-lite.zip    精简包（含全部代码/数据，不含素材）→ 允许跨版本
// 完整包与素材包不在更新器范围内。
//
// 安全边界：
//   * 路由只对本机回环开放（见 http/routes.js；公网/局域网一律 404）；
//   * 只接受 Hunt-Simulation 命名 + package.json.name = hunt-simulation + MANIFEST.json 校验；
//   * zip 逐项校验路径（拒绝 .. / 绝对路径 / 反斜杠），大小上限 220MB；
//   * 永不删除/覆盖 plugins/、.account/、accounts/、public/assets、public/fonts、data/local-*、.cache/、.studio-key；
//   * 覆盖前把旧文件备份到 .update-backup/<时间戳>/，失败可人工回滚。
//
// 协议（由 http/routes.js 暴露）：
//   GET  /api/update/status   → { ok, allowed, current, latest }
//   GET  /api/update/check    → 同上，但会真的请求 GitHub（60 秒缓存）
//   POST /api/update/apply    { kind: 'lite'|'update' } → { ok, version, restart }

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { APP_VERSION, FORK_VERSION } from '../shared/constants.js';
import { unzipFiles } from './plugins/zip.js';

const DEFAULT_API = 'https://api.github.com/repos/T1113047/Stronghold-Protocol-Hunt-Simulation/releases/latest';
const MAX_BYTES = 220 * 1024 * 1024;
const CACHE_MS = 60_000;
const ASSET_KINDS = ['lite', 'update'];

/** Never touched by an update: user plugins, account data, downloaded art, caches, the studio key. */
const KEEP = [
  'plugins/', '.account/', 'accounts/', 'public/assets/', 'public/fonts/', 'node_modules/',
  '.cache/', '.update-backup/', '.git/', 'test/', 'logs/',
];
const KEEP_FILE = new Set(['plugins/.studio-key', '.update-applied.json', 'UPDATE.json']);

function isKept(rel) {
  if (KEEP_FILE.has(rel)) return true;
  if (KEEP.some((p) => rel === p || rel.startsWith(p))) return true;
  if (rel === 'data/assets.json' || rel === 'data/local-assets.json' || rel === 'data/local-fx.json') return true;
  if (rel.startsWith('data/local/')) return true;
  return false;
}

/** A safe entry name from a release zip (no absolute path, no .., no backslash, no NUL). */
function safeName(name) {
  if (typeof name !== 'string' || !name || name.length > 400) return null;
  if (name.includes('\\') || name.includes('\0')) return null;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null;
  const parts = name.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  return name;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Does `buf` match MANIFEST.files[rel] (size + sha256)? */
function manifestMatches(manifest, rel, buf) {
  const m = manifest && manifest.files && manifest.files[rel];
  if (!m) return true; // not a managed file
  if (Number.isFinite(m.size) && m.size !== buf.length) return false;
  return !m.sha256 || m.sha256 === sha256(buf);
}

const semver = (v) => String(v || '').replace(/^[vV]/, '').split(/[.+-]/).slice(0, 3).map((n) => Number(n) || 0);
export function compareVersions(a, b) {
  const x = semver(a), y = semver(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Which release asset is which kind (by the release's asset names). */
function assetMap(release) {
  const out = {};
  for (const a of release?.assets || []) {
    const m = /^Hunt-Simulation-v[0-9][^/]*-?(lite|update)\.zip$/i.exec(a.name || '');
    if (m && ASSET_KINDS.includes(m[1].toLowerCase())) out[m[1].toLowerCase()] = { name: a.name, size: a.size, url: a.browser_download_url };
  }
  return out;
}

export function createUpdater({ appDir, log, currentVersion = APP_VERSION, forkVersion = FORK_VERSION, apiUrl = process.env.SP_UPDATE_API || DEFAULT_API, fetchImpl = globalThis.fetch } = {}) {
  let cache = null;
  let running = false;

  async function fetchLatest() {
    if (!fetchImpl) throw new Error('fetch unavailable');
    const res = await fetchImpl(apiUrl, { headers: { 'user-agent': 'hunt-simulation-updater', accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return res.json();
  }

  function releaseView(r) {
    const tag = String(r.tag_name || '');
    const version = tag.replace(/^[vV]/, '');
    return {
      tag, version,
      name: r.name || tag,
      notes: String(r.body || '').slice(0, 4000),
      published: r.published_at || null,
      assets: assetMap(r),
    };
  }

  async function check(force = false) {
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
    const raw = await fetchLatest();
    const value = releaseView(raw);
    cache = { at: Date.now(), value };
    return value;
  }

  function current() {
    return { app: currentVersion, fork: forkVersion };
  }

  /** Download one asset into a temp file (streamed, with a hard cap). */
  async function download(asset, dir) {
    const res = await fetchImpl(asset.url, { headers: { 'user-agent': 'hunt-simulation-updater' }, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
    const file = path.join(dir, asset.name.replace(/[^A-Za-z0-9._-]/g, '_'));
    let bytes = 0;
    const body = Readable.fromWeb(res.body);
    body.on('data', (c) => { bytes += c.length; if (bytes > MAX_BYTES) body.destroy(new Error('archive too large')); });
    await pipeline(body, fs.createWriteStream(file));
    if (asset.size && bytes !== asset.size) throw new Error(`download incomplete (${bytes}/${asset.size})`);
    return file;
  }

  /** Read the release zip: root folder stripped, safe names only, MANIFEST/UPDATE/package.json parsed. */
  function readPackage(buf, kind) {
    let entries;
    try { entries = unzipFiles(buf); } catch (e) { throw new Error(`bad zip: ${e.message}`); }
    const roots = new Set();
    const files = new Map();
    for (const e of entries) {
      const name = safeName(e.name.replace(/\/$/, ''));
      if (!name) throw new Error(`unsafe entry ${JSON.stringify(e.name)}`);
      if (e.name.endsWith('/')) continue;
      const slash = name.indexOf('/');
      if (slash < 0) throw new Error(`${name} is outside the release folder`);
      const root = name.slice(0, slash);
      if (root !== 'Hunt-Simulation' && root !== 'Stronghold-Protocol') throw new Error(`${name} is outside the release folder`);
      roots.add(root);
      files.set(name.slice(slash + 1), e.data);
    }
    if (roots.size !== 1) throw new Error('one release folder expected');
    const pkgBuf = files.get('package.json');
    if (!pkgBuf) throw new Error('no package.json');
    let pkg;
    try { pkg = JSON.parse(pkgBuf.toString('utf8')); } catch { throw new Error('bad package.json'); }
    if (pkg.name !== 'hunt-simulation') throw new Error('not a Hunt Simulation package');
    const manBuf = files.get('MANIFEST.json');
    if (!manBuf) throw new Error('no MANIFEST.json');
    let manifest;
    try { manifest = JSON.parse(manBuf.toString('utf8')); } catch { throw new Error('bad MANIFEST.json'); }
    if (!manifest || typeof manifest.files !== 'object') throw new Error('bad MANIFEST.json');
    let update = null;
    if (kind === 'update') {
      const upBuf = files.get('UPDATE.json');
      if (!upBuf) throw new Error('no UPDATE.json (not an update package)');
      try { update = JSON.parse(upBuf.toString('utf8')); } catch { throw new Error('bad UPDATE.json'); }
      if (!Array.isArray(update.from) || !update.from.length) throw new Error('UPDATE.json names no from versions');
    }
    return { pkg, manifest, update, files };
  }

  function backup(rel, stamp) {
    const src = path.join(appDir, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return;
    const dst = path.join(appDir, '.update-backup', stamp, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }

  /** Apply a downloaded release. Returns the new version and how the server restarts. */
  /**
   * Apply a downloaded release. Precise update:
   *  * only the files the package ships are written (an update writes UPDATE.json's file list);
   *  * for an update, the SAME version's lite zip is read too: every update file must be byte-identical to the lite's,
   *    and the lite's MANIFEST is the authoritative complete file list (repair + deletion);
   *  * every managed file is checked against its sha256; a locally modified file is backed up and reported;
   *  * plugins/, account data, downloaded art and caches are never touched.
   * @param {Buffer} buf the package
   * @param {'lite'|'update'} kind
   * @param {Buffer|null} liteBuf the same release's lite zip (required for an update)
   */
  function applyPackage(buf, kind, liteBuf = null) {
    const upd = readPackage(buf, kind);
    const target = kind === 'update' ? (liteBuf ? readPackage(liteBuf, 'lite') : null) : upd;
    if (!target) throw new Error('缺少同版本精简包，无法校验更新');
    const writeSet = kind === 'update' ? upd.files : target.files;
    // 1) the update must agree with the lite package of the same version, byte for byte
    if (kind === 'update') {
      for (const [rel, data] of upd.files) {
        if (rel === 'MANIFEST.json' || rel === 'UPDATE.json') continue;
        const ref = target.files.get(rel);
        if (!ref) throw new Error('精简包缺少 ' + rel + '，更新包与版本不一致');
        if (!ref.equals(data)) throw new Error('更新包与精简包不一致：' + rel);
      }
    }
    const version = String(target.pkg.version || '');
    if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error('package.json names no version');
    // 2) an update only applies to the versions it declares (no cross-version updates)
    if (kind === 'update') {
      const cur = currentPackage();
      if (!cur || !upd.update.from.includes(cur.version)) {
        throw new Error('更新包不允许跨版本：它只覆盖 ' + upd.update.from.join(' / ') + '，当前仓库版本是 ' + (cur ? cur.version : '?'));
      }
    }
    // 3) every shipped file must match its manifest hash before anything is written
    for (const [rel, data] of writeSet) {
      if (rel === 'MANIFEST.json' || rel === 'UPDATE.json') continue;
      if (!manifestMatches(target.manifest, rel, data)) throw new Error('校验失败：' + rel);
    }
    const old = readManifest(appDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const localMods = [];
    let written = 0;
    let repaired = 0;
    let removed = 0;
    // 4) write exactly what the package ships (backing up local modifications first)
    for (const [rel, data] of writeSet) {
      if (rel === 'MANIFEST.json' || rel === 'UPDATE.json' || isKept(rel)) continue;
      const p = path.join(appDir, rel);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const cur = fs.readFileSync(p);
        if (!cur.equals(data)) backup(rel, stamp);
        const m = old && old.files && old.files[rel];
        if (m && m.sha256 && m.sha256 !== sha256(cur)) localMods.push(rel);
      }
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, data);
      written++;
    }
    // 5) the lite manifest is the complete target set: repair a missing or wrong managed file from it
    for (const rel of Object.keys(target.manifest.files || {})) {
      if (isKept(rel)) continue;
      const want = target.files.get(rel);
      if (!want) throw new Error('精简包缺少受管文件 ' + rel);
      const p = path.join(appDir, rel);
      let cur = null;
      try { cur = fs.readFileSync(p); } catch { cur = null; }
      if (cur && manifestMatches(target.manifest, rel, cur)) continue;
      backup(rel, stamp);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, want);
      repaired++;
    }
    // 6) delete what the old manifest listed and the new one does not (never user data)
    if (old && old.files) {
      for (const rel of Object.keys(old.files)) {
        if (target.manifest.files[rel] || isKept(rel)) continue;
        const p = path.join(appDir, rel);
        if (fs.existsSync(p) && fs.statSync(p).isFile()) { backup(rel, stamp); fs.unlinkSync(p); removed++; }
      }
    }
    // 7) the target manifest (so the next update/check compares correctly)
    fs.writeFileSync(path.join(appDir, 'MANIFEST.json'), JSON.stringify(target.manifest));
    try { fs.unlinkSync(path.join(appDir, 'UPDATE.json')); } catch { /* none */ }
    // 8) an optional local patch (e.g. this server's account extension) is re-applied before the restart
    let patch = null;
    const cmd = process.env.SP_UPDATE_PATCH_CMD;
    if (cmd) {
      try {
        execFileSync('/bin/sh', ['-c', cmd], { stdio: 'inherit' });
        patch = 'ok';
      } catch (e) {
        patch = 'failed';
        throw new Error('更新已写入，但本地补丁回灌失败：' + (e && e.message ? e.message : e));
      }
    }
    log?.info?.('[update] ' + kind + ' applied: ' + version + ' (' + written + ' written, ' + repaired + ' repaired, ' + removed + ' removed, backup ' + stamp + ')');
    return { version, written, repaired, removed, localMods, patch, backup: stamp, restart: autoRestart() };
  }

  function currentPackage() {
    try { return JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')); } catch { return null; }
  }

  function readManifest(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8')); } catch { return null; }
  }

  function autoRestart() {
    // systemd sets INVOCATION_ID; SP_UPDATE_RESTART=1 forces it
    return (process.env.SP_UPDATE_RESTART === '1' || process.env.INVOCATION_ID) ? 'auto' : 'manual';
  }

  async function apply(kind) {
    if (!ASSET_KINDS.includes(kind)) throw new Error('unknown package kind');
    if (running) throw new Error('another update is running');
    running = true;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hunt-update-'));
    try {
      const rel = await check();
      const asset = rel.assets && rel.assets[kind];
      if (!asset) throw new Error('release ' + rel.tag + ' has no -' + kind + '.zip asset');
      if (asset.size > MAX_BYTES) throw new Error('archive too large');
      const file = await download(asset, dir);
      // an update always pulls the same version's lite package: it verifies and repairs the install
      let liteBuf = null;
      if (kind === 'update') {
        const liteAsset = rel.assets && rel.assets.lite;
        if (!liteAsset) throw new Error('该 release 没有同版本精简包，无法校验更新');
        if (liteAsset.size > MAX_BYTES) throw new Error('lite archive too large');
        const liteFile = await download(liteAsset, dir);
        liteBuf = fs.readFileSync(liteFile);
      }
      const out = applyPackage(fs.readFileSync(file), kind, liteBuf);
      if (out.restart === 'auto') setTimeout(() => process.exit(0), 400);
      return out;
    } finally {
      running = false;
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
    }
  }

  return { current, check, apply, releaseView };
}
