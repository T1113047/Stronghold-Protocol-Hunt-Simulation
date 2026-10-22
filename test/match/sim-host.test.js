import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { InPageSimHost, WorkerSimHost } from '../../public/js/battle/simHost.js';
import { loadBrowserSim } from '../../public/js/battle/simLoader.js';
import { forkSandbox } from '../../server/match/host/childHost.js';
import { createBattleRunner } from '../../public/js/battle/runner.js';
import { createStore, initialState } from '../../public/js/store.js';
import { validateC2S } from '../../shared/protocol.js';
import { fixtureSet, fixtureSpec, scriptSet as makeScriptSet, operatorScript } from '../helpers/simHostFixture.js';

export function nodePort(child = false) {
  const worker = child ? forkSandbox(fileURLToPath(new URL('../helpers/simChildNode.mjs', import.meta.url)))
    : new Worker(new URL('../helpers/simWorkerNode.mjs', import.meta.url));
  const port = { postMessage: m => child ? worker.send(m) : worker.postMessage(m), terminate: () => child ? worker.kill('SIGKILL') : worker.terminate() };
  worker.on('message', data => port.onmessage?.({ data })); worker.on('error', e => port.onerror?.(e));
  if (child) worker.stderr.on('data', d => process.stderr.write(d));
  return port;
}
const remote = options => new WorkerSimHost({ workerFactory: () => nodePort(), ...options });
const local = () => new InPageSimHost({ loadSim: content => loadBrowserSim({ ...content, base: new URL('../../server/sim/', import.meta.url).href }) });

test('cold load has its own budget; install keeps the short watchdog; stop settles pending calls', async () => {
  const commands = [];
  let port, terminated = 0;
  const host = new WorkerSimHost({ timeoutMs: 30, loadTimeoutMs: 300, workerFactory: () => (port = {
    terminate: () => terminated++, postMessage: m => {
      commands.push(m.method);
      if (m.method === 'load') setTimeout(() => port.onmessage({ data: { id: m.id, value: { install: true } } }), 80);
    },
  }) });
  const start = performance.now();
  await assert.rejects(host.load('a', { cs: 'a', data: {} }), e => e.code === 'PLUGIN_WORKER_TIMEOUT');
  assert.deepEqual(commands, ['load', 'install']); assert.equal(terminated, 1);
  assert.ok(performance.now() - start >= 100);
  const another = new WorkerSimHost({ workerFactory: () => ({ terminate() {}, postMessage() {} }) });
  const waiting = assert.rejects(another.rpc('step', [8]), e => e.code === 'PLUGIN_WORKER_STOPPED');
  another.stop(); await waiting; assert.equal(another.pending.size, 0);
});

test('runner on a real Worker reports its simulated cs and cached detail stats; pause and clear preserve ownership', async t => {
  const set = fixtureSet(), spec = { ...fixtureSpec(), cs: set.cs }, sent = [];
  let now = 1000;
  const runner = createBattleRunner({ net: { on: () => () => {}, send: (kind, fields) => {
    assert.equal(validateC2S({ t: kind, ...fields }), null); sent.push({ kind, ...fields });
  }, request: (kind, fields) => { assert.equal(validateC2S({ t: kind, rid: 1, ...fields }), null); sent.push({ kind, ...fields }); return Promise.resolve(); } },
  store: createStore(initialState), contentFor: async () => set, simContent: () => set, vanillaCs: () => 'b'.repeat(64),
  createHost: (_, onFailure) => remote({ onFailure }), raf: () => 1, caf: () => {}, setInterval: () => 1, clearInterval: () => {}, now: () => now, doc: null });
  t.after(() => runner.dispose());
  await runner.onStart({ battleId: 'probe', fieldId: 'n:p1', authoritative: true, spec });
  const e = runner._entries.get('probe'); assert.equal(e.host.remote, true); assert.equal(e.battle.step, undefined);
  runner.setPaused(true); now += 2000; runner._frame(); assert.equal(e.battle.tickCount, 0); runner.setPaused(false);
  for (let i = 0; i < 20 && !e.done; i++) {
    now += 1000; runner._frame();
    while (e.stepping) await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(e.done, true);
  const results = sent.filter(m => m.kind === 'b.result'); assert.equal(results.length, 1); assert.equal(results[0].cs, set.cs);
  assert.ok(sent.some(m => m.kind === 'b.progress'));
  const id = runner.unitIdOf(1, 'p1'); assert.ok(id != null); assert.equal(runner.unitStats(id), null);
  while (e.host.statsPending.size) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(runner.unitStats(id).id, id);
  runner.clear(); assert.equal(e.host.stopped, true); assert.equal(runner.state(), null);
});

// [TEMP-HTTP2] A Worker cold-loads ~300 engine modules (one request each) and runner.js keeps one per content set, so a
// host has to take exactly one content set and to survive `release()` (docs/DEPLOY.md「/sim/ 预热与版本化缓存」).
test('one content set per Worker: a concurrent load awaits the first, a second set is refused, release() keeps the worker', async () => {
  const commands = [];
  let port;
  const host = new WorkerSimHost({ workerFactory: () => (port = {
    terminate() {},
    postMessage: (m) => {
      commands.push(m.method);
      if (m.method === 'load') setTimeout(() => port.onmessage({ data: { id: m.id, value: { install: false } } }), 20);
    },
  }) });
  const set = { cs: 'a'.repeat(64), data: {} };
  // the prewarm's load and the first b.start's load are the same one
  const [first, second] = await Promise.all([host.load(set.cs, set), host.load(set.cs, set)]);
  assert.equal(first, host); assert.equal(second, host);
  assert.deepEqual(commands, ['load']);
  assert.equal(host.loaded, true);
  assert.equal(await host.load(set.cs, set), host, 'a re-load of the same set is the host itself');
  assert.deepEqual(commands, ['load']);
  await assert.rejects(host.load('b'.repeat(64), { cs: 'b'.repeat(64), data: {} }),
    (e) => e.code === 'PLUGIN_WORKER_FAILED', 'a worker takes one content set');
  assert.deepEqual(commands, ['load']);
  // loaded data stays, the battle does not: the next round starts on the same worker
  host.packet = { snap: 1 }; host.meter = { lp: 1 }; host.spec = { battleId: 'x' };
  host.release();
  assert.equal(host.stopped, false);
  assert.equal(host.loaded, true);
  assert.equal(host.packet, null);
  assert.equal(host.meter, null);
  assert.equal(host.spec, null);
  host.stop();
});

test('release() on a real Worker: the next battle of the same content set runs without another load', async t => {
  const set = fixtureSet(), spec = fixtureSpec();
  const loads = [];
  const child = nodePort();
  const post = child.postMessage;
  child.postMessage = (m) => { if (m.method === 'load') loads.push(m.args[0].cs); return post(m); };
  const host = new WorkerSimHost({ workerFactory: () => child });
  t.after(() => host.stop());
  await host.load(set.cs, set);
  await host.start(spec);
  await host.step(4);
  assert.equal(loads.length, 1);
  assert.ok(host.packet.ticks === 4);
  host.release();
  assert.equal(host.stopped, false);
  assert.equal(host.loaded, true);
  await host.start(spec);
  await host.step(2);
  assert.equal(loads.length, 1, 'the worker kept its module map and its content set');
  assert.equal(host.packet.ticks, 2);
});

test('runner (TEMP-HTTP2): one warm Worker for a room content set, reused by the next round instead of terminated', async t => {
  const set = fixtureSet(), spec = { ...fixtureSpec(), cs: set.cs };
  const ports = [], loads = [];
  const realWorker = globalThis.Worker;
  globalThis.Worker = function warmWorker() {                 // stands in for `new Worker(simWorker.js)`
    const port = nodePort();
    const post = port.postMessage;
    port.postMessage = (m) => { if (m.method === 'load') loads.push(m.args[0].cs); return post(m); };
    ports.push(port);
    return port;
  };
  t.after(() => { if (realWorker === undefined) delete globalThis.Worker; else globalThis.Worker = realWorker; });
  let now = 1000;
  const store = createStore(initialState);
  const other = { ...set, cs: 'c'.repeat(64) };
  const sets = new Map([[set.cs, set], [other.cs, other]]);
  const runner = createBattleRunner({ net: { on: () => () => {}, request: () => Promise.resolve() },
    store, contentFor: async (cs) => sets.get(cs) ?? null, simContent: () => set, vanillaCs: () => 'b'.repeat(64),
    raf: () => 1, caf: () => {}, setInterval: () => 1, clearInterval: () => {}, now: () => now, doc: null });
  t.after(() => runner.dispose());
  // the room holds a content set and the match reaches a phase that plays: the prewarm pays for the module imports
  store.patch('room', { content: { vanilla: false, cs: set.cs } });
  store.patch('match', { public: { phase: 'PREP', round: 1 } });
  await runner.onStart({ battleId: 'r1', fieldId: 'n:p1', authoritative: true, spec });
  assert.equal(ports.length, 1, 'the prewarm made the only Worker');
  assert.deepEqual(loads, [set.cs], 'the b.start found the content set already loading/loaded');
  const host = runner._entries.get('r1').host;
  assert.equal(host.remote, true);
  // the round ends: the Worker stays (its module map is worth ~300 requests), only the battle goes
  runner.clear();
  assert.equal(host.stopped, false);
  assert.equal(host.packet, null);
  // next round: the same host, no load and no second Worker
  await runner.onStart({ battleId: 'r2', fieldId: 'n:p1', authoritative: true, spec });
  assert.equal(runner._entries.get('r2').host, host);
  assert.equal(ports.length, 1);
  assert.equal(loads.length, 1);
  // another content set drops the old idle worker and warms its own
  runner.clear();
  store.patch('room', { content: { vanilla: false, cs: other.cs } });
  store.patch('match', { public: { phase: 'RESULT', round: 1 } });   // a phase change re-reads the room's set
  store.patch('match', { public: { phase: 'PREP', round: 2 } });
  assert.equal(host.stopped, true, 'the idle worker of the old content set is gone');
  await runner.onStart({ battleId: 'r3', fieldId: 'n:p1', authoritative: true, spec: { ...spec, cs: other.cs } });
  assert.equal(ports.length, 2);
  assert.deepEqual(loads, [set.cs, other.cs]);
});

test('data set: Worker and in-page snapshots/events/results match every batch; bounds, stats, owners', async t => {  const a = local(), b = remote(); t.after(() => b.stop());
  const set = fixtureSet(), spec = fixtureSpec();
  await a.load(set.cs, set); await b.load(set.cs, set); a.start(spec); await b.start(spec);
  assert.equal(await b.rpc('bounds'), 120, 'Worker installed the official snapshot, not plugin data');
  assert.deepEqual(b.battle.snapshot(), a.battle.snapshot()); a.battle.drainEvents(); b.battle.drainEvents();
  while (!a.battle.finished) {
    const x = a.step(8, { slice: 3 }), y = await b.step(8, { slice: 3 });
    assert.deepEqual(y.snap, x.snap); assert.deepEqual(y.ev, x.ev); assert.deepEqual(y.slices, x.slices);
  }
  assert.deepEqual(b.compactResult(), a.compactResult({}));
  assert.equal(b.compactResult().errors, 0);
  assert.ok(b.compactResult().total > 0, 'fixture fields real scheduled enemies');
  assert.deepEqual(b.ownerOps('p1'), a.ownerOps('p1'));
  const id = a.battle.allyUnits[0].id;
  assert.deepEqual(await b.rpc('unitStats', [id]), a.unitStats(id));
  assert.equal(typeof globalThis.lockdown, 'undefined', 'data/vanilla never install SES in the main realm');
});

test('script operator: permission child and Worker have byte-identical ev/results', async t => {
  const a = new WorkerSimHost({ workerFactory: () => nodePort(true) }), b = remote(), native = remote();
  t.after(() => { a.stop(); b.stop(); native.stop(); });
  const set = makeScriptSet(operatorScript), spec = fixtureSpec();
  const nativeSet = makeScriptSet(operatorScript,'trusted');
  await native.load(nativeSet.cs,nativeSet);await native.start(spec);
  await a.load(set.cs, set); await b.load(set.cs, set); await a.start(spec); await b.start(spec);
  await a.step(1); await b.step(1);await native.step(1);
  const stats = await b.rpc('unitStats', [b.battle.allyUnits[0].id]);
  assert.ok(stats, 'script operator is in the battle');
  const vanilla = local(); await vanilla.load(set.cs, { ...set, scripts: [] }); vanilla.start(spec); vanilla.step(1);
  assert.notDeepEqual(stats, vanilla.unitStats(vanilla.battle.allyUnits[0].id), 'the sandbox kit really changes the operator');
  vanilla.stop();
  while (!a.battle.finished) {
    const x = await a.step(8), y = await b.step(8), z = await native.step(8);
    assert.equal(JSON.stringify(y.ev), JSON.stringify(x.ev)); assert.equal(JSON.stringify(y.snap), JSON.stringify(x.snap));
    assert.equal(JSON.stringify(z.ev),JSON.stringify(x.ev));assert.equal(JSON.stringify(z.snap),JSON.stringify(x.snap));
  }
  assert.equal(JSON.stringify(b.compactResult()), JSON.stringify(a.compactResult()));
  assert.equal(JSON.stringify(native.compactResult()),JSON.stringify(a.compactResult()));
});

test('runner: true infinite script and slow data step terminate, stop reports and request server takeover', { timeout: 15000 }, async t => {
  for (const scripts of [true, false]) {
    const set = { ...fixtureSet(), ...(scripts ? makeScriptSet('export default function(){while(true){}}') : { data: { ...fixtureSet().data, __slow: true } }) };
    const sent = [], toasts = [];
    const runner = createBattleRunner({ net: { on: () => () => {}, request: (kind, fields) => {
      assert.equal(validateC2S({ t: kind, rid: 1, ...fields }), null); sent.push({ kind, ...fields }); return Promise.resolve();
    } }, store: createStore(initialState), contentFor: async () => set, simContent: () => set, vanillaCs: () => 'b'.repeat(64),
    createHost: (_, onFailure) => remote({ onFailure }), raf: () => 1, caf: () => {}, setInterval: () => 1, clearInterval: () => {},
    toast: text => toasts.push(text), now: () => Date.now(), doc: null });
    t.after(() => runner.dispose());
    let alive = 0; const pulse = setInterval(() => alive++, 30);
    const start = Date.now();
    await runner.onStart({ battleId: 'hang', fieldId: 'n:p1', authoritative: true, spec: { ...fixtureSpec(), cs: set.cs }, elapsed: scripts ? 0 : 3 });
    clearInterval(pulse);
    assert.ok(alive > 25, 'parent remains responsive'); assert.ok(Date.now() - start >= 1900);
    assert.equal(toasts.length, 1); assert.equal(sent.length, 1); assert.equal(sent[0].cs, undefined);
    assert.equal(runner.state(), null);
  }
});

test('Worker overhead budget (8-tick batches, 240 ticks)', async t => {
  const set = fixtureSet(), spec = fixtureSpec();
  const a = local(), b = remote(); t.after(() => b.stop());
  await a.load(set.cs, set); await b.load(set.cs, set); a.start(spec); await b.start(spec);
  const t0 = performance.now();
  for (let n = 0; n < 30; n++) { const p = a.step(8); p.snap; p.ev; }
  const localMs = performance.now() - t0, t1 = performance.now();
  for (let n = 0; n < 30; n++) await b.step(8);
  const remoteMs = performance.now() - t1;
  t.diagnostic(JSON.stringify({ ticks: 240, localMs, workerMs: remoteMs, overheadMsPerTick: (remoteMs - localMs) / 240 }));
  assert.ok(remoteMs < 2000, '240 ticks fit inside a batch watchdog budget on this fixture');
});
