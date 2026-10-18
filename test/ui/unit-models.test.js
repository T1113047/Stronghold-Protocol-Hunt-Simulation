// [UNITMODELS] + [PREFETCH] — the 角色模型 forced mode (render/app/view.js unitSetting), its settings defaults
// (ui/gameLogic/settings.js) and the operator-asset prefetch (ui/prefetchOps.js, ported from the 盟约 server).
// Pure / unit: no DOM, no GPU, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, UNIT_FORCES, sanitizeSettings } from '../../public/js/ui/gameLogic.js';
import { unitSetting } from '../../public/js/render/app/view.js';
import { createStore } from '../../public/js/store.js';
import { data } from '../../public/js/data.js';
import { assets } from '../../public/js/assets.js';
import { installOpPrefetch } from '../../public/js/ui/prefetchOps.js';

test('[UNITMODELS] settings: 画面自动调节 on by default, 角色模型 sanitized', () => {
  assert.equal(DEFAULT_SETTINGS.pictureAuto, true, 'auto by default（跟随设备）');
  assert.equal(DEFAULT_SETTINGS.unitsForce, 'off', 'the forced default is the cheapest');
  assert.deepEqual(UNIT_FORCES, ['on', 'off']);
  assert.equal(sanitizeSettings(null).pictureAuto, true);
  assert.equal(sanitizeSettings({ bgm: 0.4 }).unitsForce, 'off', 'a profile saved before the setting existed');
  assert.equal(sanitizeSettings({ pictureAuto: false }).pictureAuto, false);
  assert.equal(sanitizeSettings({ unitsForce: 'on' }).unitsForce, 'on');
  for (const bad of ['yes', 'auto', 1, null, {}]) assert.equal(sanitizeSettings({ unitsForce: bad }).unitsForce, 'off', String(bad));
});

test('[UNITMODELS] unitSetting: auto by default, the player choice wins, a weak GPU defaults to off', () => {
  assert.equal(unitSetting(undefined), 'auto');
  assert.equal(unitSetting({}), 'auto');
  assert.equal(unitSetting({ pictureAuto: true }), 'auto');
  // 弱 GPU（同一个 gpuTier() 探针）：默认不加载模型，退回头像菱形
  assert.equal(unitSetting({ pictureAuto: true }, true), 'off');
  assert.equal(unitSetting({}, true), 'off');
  // 玩家显式选择优先（画面自动调节关闭 → 角色模型档）
  assert.equal(unitSetting({ pictureAuto: false, unitsForce: 'on' }, true), 'on');
  assert.equal(unitSetting({ pictureAuto: false, unitsForce: 'off' }, true), 'off');
  assert.equal(unitSetting({ pictureAuto: false }), 'off');
});

test('[PREFETCH] installOpPrefetch warms an avatar + the battle Spine, de-duped, never throws', async () => {
  const manifest = { chars: { char_002_amiya: { avatar: '/assets/avatars/char_002_amiya.png', spine: { front: { skel: '/assets/spine/amiya/Front.skel', atlas: '/assets/spine/amiya/Front.atlas', anims: {} } } } } };
  const rec = manifest.chars.char_002_amiya;
  const orig = { get: data.get, lookup: data.lookup, preload: assets.preload, spine: assets.spine };
  const preloaded = [], acquired = [], released = [];
  data.get = (n) => (n === 'assets' ? manifest : null);
  data.lookup = (n, id) => (n === 'chess' && id === 'char_002_amiya' ? rec : null);
  assets.preload = (urls) => { preloaded.push(...urls); return Promise.resolve({ ok: urls.length }); };
  assets.spine = {
    ...orig.spine,
    acquire: (entry) => { acquired.push(entry.skel); return Promise.resolve({}); },
    release: (entry) => { released.push(entry.skel); },
  };
  try {
    const store = createStore({ match: { private: null, field: null }, room: null });
    installOpPrefetch({ store });
    assert.deepEqual([preloaded.length, acquired.length], [0, 0], 'nothing before a piece shows up');
    store.set({ match: { private: { hand: [{ id: 'char_002_amiya', kind: 'chess' }] }, field: null } });
    // assets.js is imported lazily now: wait a macrotask, not just microtasks
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 4; i++) await Promise.resolve();
    assert.deepEqual(preloaded, ['/assets/avatars/char_002_amiya.png']);
    assert.deepEqual(acquired, ['/assets/spine/amiya/Front.skel']);
    assert.deepEqual(released, ['/assets/spine/amiya/Front.skel'], 'acquire is paired with a release (the LRU keeps it idle)');
    // a later state change with the same id is remembered: no second warm
    store.set({ match: { private: { hand: [{ id: 'char_002_amiya', kind: 'chess' }, { id: 'char_002_amiya', kind: 'chess' }] }, field: null } });
    assert.deepEqual([preloaded.length, acquired.length], [1, 1]);
    // a missing manifest (or junk state) never throws
    data.get = () => null;
    store.set({ room: { code: 'ABCD' } });
  } finally {
    data.get = orig.get; data.lookup = orig.lookup; assets.preload = orig.preload; assets.spine = orig.spine;
  }
});
