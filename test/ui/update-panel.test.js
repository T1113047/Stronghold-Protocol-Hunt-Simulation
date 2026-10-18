// [UPDATE] 设置 → 游戏更新的客户端接线：只在本机可见、两种包、接口路径与文案齐全。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const PACKS = ['en', 'ja', 'ko', 'zh-TW'].map((l) => JSON.parse(read(`public/i18n/${l}.json`)));

test('the settings modal mounts the update section; the panel talks to the two local endpoints', () => {
  const settings = read('public/js/ui/settings.js');
  assert.match(settings, /UpdateSection/, 'settings imports and renders it');
  const panel = read('public/js/ui/updatePanel.js');
  assert.match(panel, /\/api\/update\/status/);
  assert.match(panel, /\/api\/update\/check/);
  assert.match(panel, /\/api\/update\/apply/);
  assert.match(panel, /data-testid="game-update"/);
  assert.match(panel, /JSON\.stringify\(\{ kind \}\)/);
  assert.match(panel, /apply\('update'\)/);
  assert.match(panel, /apply\('lite'\)/);
  // 非本机（status 404）时不渲染
  assert.match(panel, /if \(!current\) return null/);
});

test('the update texts exist in every pack', () => {
  for (const k of [
    '游戏更新', '检查更新', '重新检查',
    '已是最新版本 {version}', '发现新版本 {version}',
    '下载并更新（更新包）', '下载并更新（精简包）',
    '正在下载并应用…',
    '更新完成：{version}，正在重启…', '更新完成：{version}，请手动重启服务器',
    '更新失败：{reason}',
    '只从本仓库的 GitHub Release 拉取；更新包只能覆盖它声明的旧版本，精简包可跨版本。更新会重启服务器并结束当前对局。',
  ]) for (const pack of PACKS) assert.equal(typeof pack[k], 'string', k);
});

test('the server exposes the update routes for the loopback client only', () => {
  const routes = read('server/http/routes.js');
  assert.match(routes, /\/api\/update\/status/);
  assert.match(routes, /\/api\/update\/check/);
  assert.match(routes, /\/api\/update\/apply/);
  assert.match(routes, /isLocalIp\(clientAddress\(req, trustProxy\)\.ip\)/, 'loopback gate');
  const upd = read('server/updateOnline.js');
  assert.match(upd, /not a Hunt Simulation package/);
  assert.match(upd, /不允许跨版本/);
  assert.match(upd, /同版本精简包|缺少同版本精简包/);
  assert.match(upd, /plugins\//, 'user plugins are kept');
});
