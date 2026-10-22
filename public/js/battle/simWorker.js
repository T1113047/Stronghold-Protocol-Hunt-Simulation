// A module Worker with its own response CSP. No fetch: checked content bytes/data arrive from the page.
// `?base=` is the sim modules' URL (simHost.js WorkerSimHost `base`): the versioned mirror /v<hash>/sim/ where the
// server has one, so the browser may keep those ~300 modules instead of revalidating each of them ([TEMP-HTTP2], docs/DEPLOY.md).
import { createSimWorker } from './simWorkerRuntime.js';
import { loadBrowserSim } from './simLoader.js';

const base = new URL(import.meta.url).searchParams.get('base');
const dispatch = createSimWorker(base ? { loadSim: (content) => loadBrowserSim({ ...content, base }) } : {});
// Serialize asynchronous boot/start/control calls; a second command never observes half-installed content.
let queue = Promise.resolve();
globalThis.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try { globalThis.postMessage({ id: data.id, value: await dispatch(data.method, data.args) }); }
    catch (e) { globalThis.postMessage({ id: data.id, error: { code: e.code || 'PLUGIN_WORKER_FAILED', message: String(e.message || e).slice(0, 300) } }); }
  });
};
