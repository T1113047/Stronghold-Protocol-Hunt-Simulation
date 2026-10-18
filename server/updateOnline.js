// server/updateOnline.js — 在线更新：从本仓库的 GitHub Release 拉最新**精简包**，与**当前版本精简包**做差分，只写变化的文件。
//
// 口径（维护者 2026-10-18）：
//   * 不再使用 -update.zip；一次更新只下载两个 -lite.zip：目标版本 + 当前版本；
//   * 用两份 MANIFEST.json 的 sha256 计算增/改/删：**只覆盖真正变化的文件**，未变化的本地文件（包括本地补丁）保持原样；
//   * 每个写入的文件都要对得上目标 MANIFEST 的 sha256；
//   * 找不到当前版本的精简包时，退回用安装目录里的 MANIFEST.json 作为旧基线（仍能精确差分，但无法逐字节核对旧包）；
//   * plugins/、.account/、accounts/、public/assets、public/fonts、data/local-*、.cache/、.studio-key 永不触碰；
//   * 覆盖前把旧文件备份到 .update-backup/<时间戳>/。
//
// 路由由 http/routes.js 暴露（严格回环）：
//   GET  /api/update/status → { ok, allowed, current }
//   GET  /api/update/check  → { ok, allowed, current, latest }
//   POST /api/update/apply  → { ok, version, written, removed, localMods, restart }

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
const MAX_BYTES = 260 * 1024 * 1024;
const CACHE_MS = 60_000;

/** 永不覆盖/删除：用户插件、账号数据、下载素材、缓存、工作台钥匙。 */
const KEEP = ['plugins/', '.account/', 'accounts/', 'public/assets/', 'public/fonts/', 'node_modules/', '.cache/', '.update-backup/', '.git/', 'test/', 'logs/'];
const KEEP_FILE = new Set(['plugins/.studio-key', '.update-applied.json', 'UPDATE.json']);
function isKept(rel) {
  if (KEEP_FILE.has(rel)) return true;
  if (KEEP.some((p) => rel === p || rel.startsWith(p))) return true;
  if (rel === 'data/assets.json' || rel === 'data/local-assets.json' || rel === 'data/local-fx.json') return true;
  if (rel.startsWith('data/local/')) return true;
  return false;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const semver = (v) => String(v || '').replace(/^[vV]/, '').split(/[.+-]/).slice(0, 3).map((n) => Number(n) || 0);
export function compareVersions(a, b) {
  const x = semver(a), y = semver(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

function safeName(name) {
  if (typeof name !== 'string' || !name || name.length > 400) return null;
  if (name.includes('\\') || name.includes('\0')) return null;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null;
  const parts = name.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  return name;
}

/** The release's lite asset (name → kind by suffix). */
function liteAsset(release) {
  for (const a of release?.assets || []) {
    if (/^Hunt-Simulation-v[0-9][^/]*-lite\.zip$/i.test(a.name || '')) return { name: a.name, size: a.size, url: a.browser_download_url };
  }
  return null;
}

function readManifest(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8')); } catch { return null; }
}

/** Read a lite zip: one root folder, safe names, package.json + MANIFEST.json parsed. */
function readLite(buf) {
  let entries;
  try { entries = unzipFiles(buf); } catch (e) { throw new Error('bad zip: ' + e.message); }
  const files = new Map();
  let root = null;
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    const name = safeName(e.name);
    if (!name) throw new Error('unsafe entry ' + JSON.stringify(e.name));
    const slash = name.indexOf('/');
    if (slash < 0) throw new Error(name + ' is outside the release folder');
    const r = name.slice(0, slash);
    if (r !== 'Hunt-Simulation' && r !== 'Stronghold-Protocol') throw new Error(name + ' is outside the release folder');
    if (root && r !== root) throw new Error('one release folder expected');
    root = r;
    files.set(name.slice(slash + 1), e.data);
  }
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
  return { pkg, manifest, files };
}

export function createUpdater({ appDir, log, currentVersion = APP_VERSION, forkVersion = FORK_VERSION, apiUrl = process.env.SP_UPDATE_API || DEFAULT_API, fetchImpl = globalThis.fetch } = {}) {
  let cache = null;
  let running = false;
  const headers = { 'user-agent': 'hunt-simulation-updater', accept: 'application/vnd.github+json' };
  const listUrl = () => apiUrl.replace(/\/releases\/latest\/?$/, '/releases?per_page=30');

  const current = () => ({ app: currentVersion, fork: forkVersion });

  async function getJson(url) {
    if (!fetchImpl) throw new Error('fetch unavailable');
    const res = await fetchImpl(url, { headers });
    if (!res.ok) throw new Error('GitHub ' + res.status);
    return res.json();
  }

  function view(r) {
    const tag = String(r.tag_name || '');
    return {
      tag, version: tag.replace(/^[vV]/, ''), name: r.name || tag,
      notes: String(r.body || '').slice(0, 4000), published: r.published_at || null,
      lite: liteAsset(r),
    };
  }

  async function check(force = false) {
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
    const value = view(await getJson(apiUrl));
    cache = { at: Date.now(), value };
    return value;
  }

  /** The release of the running version (its lite is the old baseline for a precise diff). */
  async function currentRelease() {
    try {
      const list = await getJson(listUrl());
      const want = 'v' + String(forkVersion).replace(/^[vV]/, '');
      const hit = (Array.isArray(list) ? list : []).find((r) => String(r.tag_name || '') === want);
      return hit ? view(hit) : null;
    } catch { return null; }
  }

  async function download(asset, dir) {
    const res = await fetchImpl(asset.url, { headers, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error('download ' + res.status);
    const file = path.join(dir, asset.name.replace(/[^A-Za-z0-9._-]/g, '_'));
    let bytes = 0;
    const body = Readable.fromWeb(res.body);
    body.on('data', (c) => { bytes += c.length; if (bytes > MAX_BYTES) body.destroy(new Error('archive too large')); });
    await pipeline(body, fs.createWriteStream(file));
    if (asset.size && bytes !== asset.size) throw new Error('download incomplete (' + bytes + '/' + asset.size + ')');
    return file;
  }

  function backup(rel, stamp) {
    const src = path.join(appDir, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return;
    const dst = path.join(appDir, '.update-backup', stamp, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }

  /**
   * Precise update from two lite packages: write only files whose sha256 changed, delete what the old manifest lists
   * and the new one does not, leave every unchanged local file alone.
   */
  function applyLite(targetBuf, oldBuf = null) {
    const target = readLite(targetBuf);
    const version = String(target.pkg.version || '');
    if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error('package.json names no version');
    const oldManifest = oldBuf ? readLite(oldBuf).manifest : readManifest(appDir);
    if (!oldManifest || !oldManifest.files) throw new Error('缺少当前版本的清单，无法精确更新');
    const oldFiles = oldManifest.files;
    const newFiles = target.manifest.files;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const localMods = [];
    const changed = [];
    const added = [];
    let removed = 0;
    // 1) sanity: every file we may write is in the target zip and matches its sha256
    for (const [rel, meta] of Object.entries(newFiles)) {
      if (isKept(rel)) continue;
      const data = target.files.get(rel);
      if (!data) throw new Error('精简包缺少受管文件 ' + rel);
      if (meta.sha256 && sha256(data) !== meta.sha256) throw new Error('校验失败：' + rel);
    }
    // 2) write only changed files (back up local modifications of those files)
    for (const [rel, meta] of Object.entries(newFiles)) {
      if (isKept(rel)) continue;
      const data = target.files.get(rel);
      const before = oldFiles[rel];
      if (before && before.sha256 === meta.sha256) continue; // unchanged: leave the local file alone (patches survive)
      const p = path.join(appDir, rel);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const cur = fs.readFileSync(p);
        if (before && before.sha256 && sha256(cur) !== before.sha256) localMods.push(rel);
        backup(rel, stamp);
      }
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, data);
      if (before) changed.push(rel); else added.push(rel);
    }
    // 3) delete files the old manifest listed and the new one does not
    for (const rel of Object.keys(oldFiles)) {
      if (newFiles[rel] || isKept(rel)) continue;
      const p = path.join(appDir, rel);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) { backup(rel, stamp); fs.unlinkSync(p); removed++; }
    }
    // 4) the new manifest is the baseline of the next update
    fs.writeFileSync(path.join(appDir, 'MANIFEST.json'), JSON.stringify(target.manifest));
    // 5) an optional local patch (this server's account extension) runs before the restart
    let patch = null;
    const cmd = process.env.SP_UPDATE_PATCH_CMD;
    if (cmd) {
      try { execFileSync('/bin/sh', ['-c', cmd], { stdio: 'inherit' }); patch = 'ok'; }
      catch (e) { throw new Error('更新已写入，但本地补丁回灌失败：' + (e && e.message ? e.message : e)); }
    }
    log?.info?.('[update] ' + version + ': ' + changed.length + ' changed, ' + added.length + ' added, ' + removed + ' removed' +
      (localMods.length ? ', ' + localMods.length + ' local modifications backed up' : ''));
    return {
      version, changed: changed.length, added: added.length, removed, localMods,
      patch, backup: stamp, oldBaseline: oldBuf ? 'release' : 'manifest',
      restart: autoRestart(),
    };
  }

  function autoRestart() {
    return (process.env.SP_UPDATE_RESTART === '1' || process.env.INVOCATION_ID) ? 'auto' : 'manual';
  }

  async function apply() {
    if (running) throw new Error('another update is running');
    running = true;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hunt-update-'));
    try {
      const latest = await check(true);
      if (!latest.lite) throw new Error('release ' + latest.tag + ' 没有精简包');
      if (latest.lite.size > MAX_BYTES) throw new Error('archive too large');
      const targetFile = await download(latest.lite, dir);
      // the running version's lite is the old baseline; without it we still diff by the install's MANIFEST
      let oldBuf = null;
      try {
        const cur = await currentRelease();
        if (cur && cur.lite && cur.lite.size <= MAX_BYTES) oldBuf = fs.readFileSync(await download(cur.lite, dir));
      } catch { /* fall back to the local manifest */ }
      const out = applyLite(fs.readFileSync(targetFile), oldBuf);
      if (out.restart === 'auto') setTimeout(() => process.exit(0), 400);
      return out;
    } finally {
      running = false;
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
    }
  }

  return { current, check, apply };
}
