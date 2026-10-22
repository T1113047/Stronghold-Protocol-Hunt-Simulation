// C4 simulation hosts (DESIGN §32.11). The clock belongs to runner.js. Only the vanilla host has a Battle on the page.
//
// [TEMP-HTTP2] Temporary patch (see docs/DEPLOY.md「/sim/ 预热与版本化缓存」and 本地改动.md §22): a Worker cold-loads
// ~300 engine modules, one request each, which does not fit a slow link's first b.start. Until the game is served from a
// domain with TLS + HTTP/2 (the real fix: all modules over one multiplexed connection), runner.js warms a host before
// the battle (warmSim), reuses it between rounds (release), and imports the engine from a versioned mirror of the served
// tree (/v<hash>/{sim,shared}/) the browser may keep; the load budget is 45 s. Remove all of it once the entry is HTTP/2.
import { loadBrowserSim, checkOperatorTraitRuntime } from './simLoader.js';
import { unitStatsEntry } from '../../../shared/protocol.js';

/** [ASSUMED] 2 s per RPC, including construction and forceEnd (both can execute plugin hooks). */
export const WORKER_TIMEOUT_MS = 2000;
/**
 * [ASSUMED] Trusted engine/module/data cold load can take longer; plugin code runs in a separate 2 s install RPC.
 * A fresh Worker has no module map: it imports every module of server/sim one by one (one request each, ~300 of them),
 * so this budget covers a whole module graph over the link — at ~350 ms per request over the browser's 6 connections
 * per origin that is ~17 s already. runner.js therefore warms a host before the battle starts (warmSim) and keeps it
 * between rounds (release); this budget only bounds the fallback when neither could happen.
 *
 * [TEMP-HTTP2] 15 s → 45 s for as long as the entry is plain HTTP/1.1 (6 connections, one RTT per request). Back to a
 * small budget — the upstream shape, `[ASSUMED]` — once the domain + HTTP/2 migration lands.
 */
export const WORKER_LOAD_TIMEOUT_MS = 45000;
const failure = (code, message) => Object.assign(new Error(message), { code });

export class InPageSimHost {
  constructor({ loadSim = loadBrowserSim } = {}) { this.loadSim = loadSim; this.remote = false; this.battle = null; }
  async load(cs = null, content = null) {
    this.sim = await this.loadSim(content ? { ...content, cs } : undefined);
    return this;
  }
  start(spec, opts = {}) {
    this.spec = spec;
    this.battle = this.sim.spec.createBattleFromSpec(spec, this.sim.ds, opts);
    this.meter = this.sim.spec.attachLpMeter(this.battle);
    return this;
  }
  step(n, { slice = 0 } = {}) {
    const b = this.battle;
    const slices = [];
    let ticks = 0;
    for (; ticks < n && !b.finished; ticks++) {
      b.step();
      if (slice && (ticks + 1) % slice === 0 && ticks + 1 < n) {
        const ev = b.drainEvents() || [];
        if (ev.length) slices.push({ gt: Number(b.time) || 0, ev });
      }
    }
    // Lazy reads keep the vanilla runner's snapshot/event timing unchanged.
    return { get snap() { return b.snapshot(); }, get ev() { return b.drainEvents() || []; }, state: b, ticks, slices };
  }
  progress() { return this.sim.spec.battleProgress(this.battle); }
  uniteLeft() { return this.sim.spec.uniteLeft(this.battle); }
  compactResult(options) {
    const s = this.sim.spec;
    const r = s.compactResult(this.battle.result());
    return typeof s.fitResult === 'function' ? s.fitResult(r, options) : r;
  }
  unitStats(id) {
    const u = this.battle?.unitById?.(id);
    return u ? unitStatsEntry(u, u._s || null) : null;
  }
  ownerOps(pid) {
    return (this.battle?.allyUnits || []).filter(u => u?.kind === 'op' && u.ownerId === pid && typeof u.defId === 'string').map(u => ({
      kind: 'op', ownerId: pid, defId: u.defId,
      ...(u.items?.length ? { items: [...u.items] } : {}),
      ...(u.def?.standInFor ? { standInFor: u.def.standInFor } : {}),
      ...(u.def?.diyFor && u.def.loadout?.diy ? { diy: { ...u.def.loadout.diy } } : {}),
    }));
  }
  syncPool(hp, acked) { this.battle?.sharedBoss?.sync?.(hp, acked); }
  forceEnd(reason) { this.battle?.forceEnd(reason); }
  stop() { this.battle = null; }
}

/** Wire state only: no engine import or engine object, including in the dev introspection hooks. */
export class WorkerSimHost {
  constructor({ base = null,
    workerFactory = () => new Worker(new URL(base ? `./simWorker.js?base=${encodeURIComponent(base)}` : './simWorker.js', import.meta.url), { type: 'module' }),
    timeoutMs = WORKER_TIMEOUT_MS, loadTimeoutMs = WORKER_LOAD_TIMEOUT_MS, onFailure = () => {}, contentFor = null } = {}) {
    this.contentFor = contentFor;
    this.remote = true;
    this.timeoutMs = timeoutMs;
    this.loadTimeoutMs = loadTimeoutMs;
    this.onFailure = onFailure;
    this.worker = workerFactory();
    this.pending = new Map();
    this.seq = 0;
    this.stopped = false;
    this.events = [];
    this.statsCache = new Map();
    this.statsPending = new Set();
    /** the content set installed in the worker (one per worker, simWorkerRuntime.js) @type {string|null} */
    this.cs = null;
    this.loaded = false;
    /** the in-flight load() (a prewarm and the first b.start of that content set await the same one) @type {Promise<any>|null} */
    this.loading = null;
    /** lease bookkeeping of the runner's warm pool ([TEMP-HTTP2]): `pooled` = this runner made it for reuse, `busy` =
     *  one battle holds it; `gen` counts releases so a late detail-stats answer of a dropped battle is discarded */
    this.pooled = false;
    this.busy = false;
    this.gen = 0;
    this.battle = {
      snapshot: () => this.packet?.snap,
      drainEvents: () => this.events.splice(0),
      fieldMeta: () => this.packet?.meta || { units: [] },
      getPlayer: pid => this.packet?.players?.[pid],
    };
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data?.id);
      if (!p) return;
      this.pending.delete(data.id);
      clearTimeout(p.timer);
      if (data.error) { const err = failure(data.error.code || 'PLUGIN_WORKER_FAILED', data.error.message); p.reject(err); this.fail(err); }
      else p.resolve(data.value);
    };
    this.worker.onerror = () => this.fail(failure('PLUGIN_WORKER_FAILED', 'simulation worker failed'));
    this.worker.onmessageerror = () => this.fail(failure('PLUGIN_WORKER_FAILED', 'simulation worker message failed'));
  }
  rpc(method, args = [], timeoutMs = this.timeoutMs) {
    if (this.stopped) return Promise.reject(failure('PLUGIN_WORKER_STOPPED', 'simulation worker stopped'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(failure('PLUGIN_WORKER_TIMEOUT', `simulation worker ${method} exceeded ${timeoutMs} ms`)), timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ id, method, args }); } catch (err) { this.fail(err); }
    });
  }
  fail(err) { if (this.stopped) return; this.stop(err); this.onFailure(err); }
  /**
   * Install `cs`'s checked content in the worker (the worker imports the engine modules itself, simLoader.js). A host
   * that already holds that content set — or is loading it right now, the runner's `warmSim` — returns as it is: a
   * worker takes one content set (simWorkerRuntime.js), so a second one is refused instead of breaking the first.
   */
  async load(cs, content = null) {
    if (this.stopped) throw failure('PLUGIN_WORKER_STOPPED', 'simulation worker stopped');
    // a worker takes one content set (simWorkerRuntime.js): the runner pools one host per content set, so this is only
    // ever a caller that mixed them up — refuse instead of letting the worker break the set it is already holding
    if (this.cs !== cs && this.loading) throw failure('PLUGIN_WORKER_FAILED', 'simulation worker already loads another content set');
    if (this.cs !== cs && this.loaded) throw failure('PLUGIN_WORKER_FAILED', 'simulation worker already holds another content set');
    if (this.cs === cs && this.loading) return this.loading;
    if (this.cs === cs && this.loaded) return this;
    this.cs = cs;
    const run = (async () => {
      const set = content || (await this.contentFor?.(cs));
      if (!set || set.cs !== cs || !set.data) throw failure('PLUGIN_WORKER_FAILED', 'no checked content set');
      const traitRuntimeVerified = await checkOperatorTraitRuntime(set.data);
      const ready = await this.rpc('load', [{ ...set, cs, traitRuntimeVerified }], this.loadTimeoutMs);
      if (ready.install) await this.rpc('install');
      this.loaded = true;
      return this;
    })();
    this.loading = run;
    try { return await run; } finally { if (this.loading === run) this.loading = null; }
  }
  /**
   * [TEMP-HTTP2] Drop the battle but keep the worker: its module map (one request per module of server/sim) and its
   * loaded content stay, so the next round's b.start of the same content set starts at once (runner.js releaseHost).
   */
  release() {
    this.gen++;
    this.packet = null;
    this.meter = null;
    this.spec = null;
    this.events.length = 0;
    this.statsCache.clear();
    this.statsPending.clear();
  }
  accept(packet) {
    this.packet = packet;
    this.events.push(...packet.ev);
    Object.assign(this.battle, packet.state);
    this.meter = packet.meter;
    return packet;
  }
  async start(spec) { this.spec = spec; this.accept(await this.rpc('start', [spec])); return this; }
  async step(n, opts) { return this.accept(await this.rpc('step', [n, opts])); }
  progress() { return this.packet.progress; }
  uniteLeft() { return this.packet.left; }
  compactResult() { return this.packet.result; }
  unitStats(id) {
    if (!this.stopped && !this.statsPending.has(id)) {
      const gen = this.gen;
      this.statsPending.add(id);
      // a value that arrives after release() belongs to the battle this host no longer holds: drop it
      this.rpc('unitStats', [id]).then(v => { if (gen === this.gen) this.statsCache.set(id, v); }, () => {})
        .finally(() => { if (gen === this.gen) this.statsPending.delete(id); });
    }
    return this.statsCache.get(id) || null;
  }
  ownerOps(pid) { return this.packet?.ops?.[pid] || []; }
  syncPool(hp, acked) { return this.rpc('syncPool', [hp, acked]).catch(() => {}); }
  async forceEnd(reason) { this.accept(await this.rpc('forceEnd', [reason])); }
  stop(err = failure('PLUGIN_WORKER_STOPPED', 'simulation worker stopped')) {
    if (this.stopped) return;
    this.stopped = true;
    this.worker.terminate();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }
}
