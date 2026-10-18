// Release metadata of this fork 《卫戍协议：狩猎模拟》: its own version ('0.0.1') in package.json / package-lock.json
// beside the upstream release it is built on (shared/constants.js APP_VERSION, kept at 0.3.1) — the build label
// (FORK_VERSION / FORK_LABEL) and the name the README, the title screen and the boot banner show — the
// GPL-3.0-or-later licence (LICENSE, package.json, lockfile) and the notice files the README and the release bundle
// point at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION, PROTOCOL_VERSION, DEV_BUILD, FORK_VERSION, FORK_LABEL } from '../shared/constants.js';
import { isDevVersion } from '../tools/package.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));

// This fork's own release metadata: the version it ships under, the upstream release it is built on, and the
// repository it lives in (package.json / package-lock.json / shared/constants.js / README.md, one number everywhere).
const PKG_NAME = 'hunt-simulation';
const FORK_REPO = 'https://github.com/T1113047/Stronghold-Protocol-Hunt-Simulation';

test('one release version: this fork\'s 0.0.1 everywhere, the upstream 0.3.1 beside it', () => {
  // the upstream baseline stays a release x.y.z, or x.y.z-dev on the public dev branch (the owner's decision of 2026-10-06)
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+(-dev)?$/);
  assert.equal(DEV_BUILD, APP_VERSION.endsWith('-dev'));
  // the version a player or a host reads is THIS fork's (shared/constants.js FORK_VERSION), not the upstream release
  assert.equal(FORK_VERSION, 'V0.0.2');
  assert.ok(FORK_LABEL.includes(FORK_VERSION) && FORK_LABEL.includes(APP_VERSION), 'the fork label pairs its own number with the upstream release');
  assert.equal(pkg.version, '0.0.2');
  assert.equal(lock.version, '0.0.2');
  assert.equal(lock.packages[''].version, '0.0.2');
  assert.equal(pkg.upstream, APP_VERSION, 'package.json names the upstream release it is built on');
  assert.equal(PROTOCOL_VERSION, 1, 'the wire protocol number is separate from the release version');
  assert.equal(pkg.private, true, 'never published to npm');
});

test('CHANGELOG.md opens with this fork\'s entry, keeps the upstream releases below it, and the README links it', () => {
  const log = read('CHANGELOG.md');
  // the fork's own entry first: FORK_VERSION beside the upstream release it is built on; the upstream releases stay below
  const top = log.split('\n')[0];
  assert.match(top, /^## V0\.0\.2/, `the fork's entry opens the file: ${top}`);
  assert.match(top, /0\.3\.1/, 'it names the upstream release it is built on');
  const first = log.match(/^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})/m);
  assert.ok(first, 'a "## x.y.z — date" heading');
  if (DEV_BUILD) {
    // a dev build has no entry of its own yet: the newest one is the last release, older than the version in development
    const num = (v) => v.split(/[.-]/).slice(0, 3).map(Number);
    const [a, b] = [num(first[1]), num(APP_VERSION)];
    assert.ok(a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2]))), `the newest entry ${first[1]} precedes ${APP_VERSION}`);
  } else assert.equal(first[1], APP_VERSION, 'the newest upstream entry is the release the fork is built on');
  assert.match(log, /^## 0\.1\.0 — 2026-10-02/m, 'the first public release stays listed');
  const readme = read('README.md');
  assert.match(readme, /\[CHANGELOG\.md\]\(CHANGELOG\.md\)/);
  // shields.io escapes a '-' inside a badge field as '--'
  assert.match(readme, new RegExp(`badge/version-${APP_VERSION.replace(/-/g, '--').replace(/\./g, '\\.')}-`), 'the README badge');
});

test('the release version is what players see', () => {
  assert.match(read('public/js/screens/title.js'), /v\$\{APP_VERSION\}/, 'title screen footer');
  assert.ok(!/PROTOCOL v1/.test(read('public/js/screens/title.js')), 'no protocol number posing as a version');
  // the server's entry is server/index.js; the banner and /healthz live in server/http/ (boot.js, routes.js)
  const boot = read('server/http/boot.js');
  assert.match(boot, /\$\{FORK_NAME\} · Hunt Simulation \$\{VERSION_LABEL\}/, 'the fork\'s own banner line');
  // the upstream release this fork is built on keeps its line, credited as the baseline (server/http/boot.js)
  assert.match(boot, /Stronghold Protocol: Alliance v\$\{APP_VERSION\}/, 'upstream baseline in the boot banner');
  assert.match(boot, /卫戍协议：盟约 · Stronghold Protocol: Alliance v/, 'upstream baseline in the boot banner');
  assert.match(read('server/http/routes.js'), /app: APP_VERSION/, '/healthz');
});

test('this fork names itself: README title and badges, package name, repository metadata', () => {
  // 卫戍协议：狩猎模拟 · Stronghold Protocol: Hunt Simulation, built on 卫戍协议：盟约 · Stronghold Protocol: Alliance
  // (the upstream mode's official English name, GitHub issue #38); the fork's number sits beside the upstream badge.
  const readme = read('README.md');
  assert.equal(readme.split('\n')[0], '# 卫戍协议：狩猎模拟 · Stronghold Protocol: Hunt Simulation', 'README title');
  assert.match(readme, /Stronghold Protocol: Hunt Simulation/, 'the README names this fork');
  assert.match(readme, /sganggs\/Stronghold-Protocol/, 'the upstream project stays credited');
  // the README carries both badges: the upstream release this fork is built on, and the fork's own number
  // (shields.io shows the full-width parentheses of a badge label verbatim)
  assert.match(readme, /badge\/version-0\.3\.1-/, 'the upstream release badge stays on the README');
  assert.match(readme, /badge\/fork-V0\.0\.2（0\.3\.1）-/, 'the fork\'s own badge');
  assert.equal(pkg.name, PKG_NAME);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.equal(pkg.repository.url, `git+${FORK_REPO}.git`);
  assert.equal(pkg.bugs.url, `${FORK_REPO}/issues`);
  assert.equal(pkg.homepage, `${FORK_REPO}#readme`);
  for (const f of ['README.md', 'server/index.js', 'server/http/boot.js', 'package.json', 'package-lock.json', 'NOTICE.md', 'public/index.html', 'docs/DEPLOY.md']) {
    assert.ok(!/covenant/i.test(read(f)), `${f}: no "Covenant" title left`);
  }
});

test('GPL-3.0-or-later: LICENSE, package metadata and notices', () => {
  const license = read('LICENSE');
  assert.match(license.slice(0, 200), /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
  assert.match(license, /END OF TERMS AND CONDITIONS/);
  assert.equal(pkg.license, 'GPL-3.0-or-later');
  assert.equal(lock.packages[''].license, 'GPL-3.0-or-later');
  assert.match(pkg.repository.url, /github\.com\/T1113047\/Stronghold-Protocol-Hunt-Simulation/, 'the fork keeps its own repository URL');
  for (const f of ['NOTICE.md', 'THIRD-PARTY-NOTICES.md', 'tools/local-extract/LICENSE-Ark-Unpacker.txt']) {
    assert.ok(existsSync(join(ROOT, f)), f);
  }
  const notice = read('NOTICE.md');
  assert.match(notice, /GPL-3\.0-or-later/);
  assert.match(notice, /非商业/);
  assert.match(notice, /section 7/, 'the Spine Runtimes linking permission');
  const aklz4 = read('tools/local-extract/aklz4.py');
  assert.match(aklz4, /SPDX-License-Identifier: BSD-3-Clause/);
  assert.match(aklz4, /Copyright \(c\) 2022, Harry Huang/);
});

test('a development build says so everywhere a player or a host looks, and never packages as a release', () => {
  if (!DEV_BUILD) return;
  const readme = read('README.md');
  assert.match(readme.split('\n').slice(0, 8).join('\n'), /开发版（dev 分支）：不稳定，请勿用于公开服务器/, 'the README warns right under the title');
  assert.match(read('public/js/screens/title.js'), /DEV_BUILD \? html`<span class="title-dev"/, 'the title screen footer carries the dev tag');
  assert.match(read('server/http/boot.js'), /if \(DEV_BUILD\) console\.log\(/, 'the boot banner warns the host');
  assert.ok(isDevVersion(APP_VERSION) && !isDevVersion('0.1.4'), 'tools/package.mjs treats the version as a development one');
  assert.match(read('tools/package.mjs'), /isDevVersion\(p\.version\) && !o\.allowDev/, 'packaging a dev version needs --allow-dev');
});
