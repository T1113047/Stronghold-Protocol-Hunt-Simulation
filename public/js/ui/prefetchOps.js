// [PREFETCH] 干员素材预取 — warm an operator's assets (avatar image + battle Spine) the moment it shows up in the match
// state, so the first combat frame does not fetch them (the Spine parse happens during prep, not at battle start).
// Driven off the app store (own private state + the field), de-duped, bounded (MAX_SEEN), and never throws.
//
// The object ids are resolved like render/app.js pieceInfo: data.lookup('tokens'|'chess') → assets.spine / assets.avatar,
// else charId, else the id. Installed by ui/fieldHost.js at boot.

// assets.js is imported on the first prefetch (not at the top): a page that never needs it keeps it out of the static
// import graph (test/ui/plugins-client.test.js: a vanilla page loads no asset store at start).
let A = null;
const loadAssets = () => (A ||= import('../assets.js'));
import { data } from '../data.js';
import { store } from '../store.js';

/** How many ids are remembered (skipped if seen again): a match never warms more operators than this. */
const MAX_SEEN = 80;
const seen = new Set();

/** Remember `id`; false when it was already warmed. Oldest out when over MAX_SEEN (insertion order). */
function remember(id) {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value);
  return true;
}

/** Collect the piece ids of the own private state + the field (board / bench / hand, scouted and 2V2 confront boards). */
function collectIds(root) {
  const out = new Set();
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 5) return;
    if (Array.isArray(o)) { for (const v of o) walk(v, d + 1); return; }
    if (typeof o.id === 'string' && typeof o.kind === 'string') out.add(o.id);
    for (const k in o) { const v = o[k]; if (v && typeof v === 'object') walk(v, d + 1); }
  };
  walk(root, 0);
  return out;
}

/** Warm one piece id: preload its avatar image and parse (then release) its battle Spine, both best-effort. */
async function warmId(m, local, id) {
  const { assets, spineEntry, avatarUrl } = await loadAssets();
  const rec = data.lookup('tokens', id) || data.lookup('chess', id);
  if (!rec) return;
  const spineId = (rec.assets && rec.assets.spine) || rec.charId || id;
  const avatarId = (rec.assets && rec.assets.avatar) || rec.charId || id;
  const imgs = [];
  if (avatarId) { const u = avatarUrl(m, avatarId); if (u) imgs.push(u); }
  if (imgs.length) assets.preload(imgs).catch(() => {});
  if (spineId) {
    const entry = spineEntry(m, spineId, local ? { local } : undefined);
    // acquire then release: the skeleton goes to the LRU's idle set (kept while a scene is on screen), ready for the view
    if (entry) assets.spine.acquire(entry).then(() => assets.spine.release(entry)).catch(() => {});
  }
}

let installed = false;

/**
 * Install the prefetch on the app store (idempotent). Re-runs when the match or the room slice changes, so a piece that
 * appears mid-match (a shop offer bought into the hand, a scout) is warmed then too.
 * @param {{ store?: { get: () => any, subscribe: (fn: Function) => Function } }} [opts] default: the app store
 */
export function installOpPrefetch({ store: appStore = store } = {}) {
  if (installed) return;
  installed = true;
  const run = () => {
    try {
      const m = data.get('assets');
      if (!m) return;
      const local = data.get('local');
      const s = appStore.get();
      const ids = collectIds([s.match && s.match.private, s.match && s.match.field]);
      for (const id of ids) if (remember(id)) warmId(m, local, id).catch(() => {});
    } catch { /* best effort: never throws */ }
  };
  appStore.subscribe((s, prev) => { if (s.match !== prev.match || s.room !== prev.room) run(); });
  run();
}
