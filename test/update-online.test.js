// [UPDATE] server/updateOnline.js — 两个精简包做差分：只写变化的文件，未变化的本地文件保持原样。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createUpdater, compareVersions } from "../server/updateOnline.js";
import { zipFiles } from "../server/plugins/zip.js";

const API = "https://api.github.com/repos/x/y/releases/latest";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const man = (files) => JSON.stringify({ format: 1, app: "0.3.1", files: Object.fromEntries(Object.entries(files).map(([r, d]) => [r, { size: Buffer.byteLength(d), sha256: sha(Buffer.from(d)) }])) });
const zip = (files) => zipFiles(Object.entries(files).map(([name, data]) => ({ name: `Hunt-Simulation/${name}`, data: Buffer.from(data) })));
const body = (buf) => ({ ok: true, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(buf)); c.close(); } }) });

const release = (tag, url) => ({
  tag_name: tag, name: tag, body: "notes", published_at: "2026-10-18T00:00:00Z",
  assets: [{ name: `Hunt-Simulation-${tag}-lite.zip`, size: 0, browser_download_url: url }],
});

function stub({ target, old = null, list = true, latest = release("v0.1.0", "https://example.test/target.zip") }) {
  return async (url) => {
    const u = String(url);
    if (u === API) return { ok: true, json: async () => latest };
    if (u.includes("/releases?per_page=")) {
      if (!list) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => [latest, old || release("v0.0.1", "https://example.test/old.zip")] };
    }
    if (u.endsWith("target.zip")) return body(target);
    if (u.endsWith("old.zip")) return body(old || target);
    return { ok: false, status: 404, body: null };
  };
}

const appDir = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "up-"));
  for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), data);
  }
  return dir;
};

test("compareVersions", () => {
  assert.ok(compareVersions("0.1.0", "0.0.9") > 0);
  assert.equal(compareVersions("v0.1.0", "0.1.0"), 0);
  assert.ok(compareVersions("0.0.10", "0.0.9") > 0);
});

test("check maps the latest release and its lite asset", async () => {
  const up = createUpdater({ appDir: os.tmpdir(), apiUrl: API, fetchImpl: stub({ target: Buffer.alloc(0) }) });
  const r = await up.check(true);
  assert.equal(r.version, "0.1.0");
  assert.equal(r.lite.name, "Hunt-Simulation-v0.1.0-lite.zip");
});

test("precise diff: changed written, unchanged local edit preserved, removed deleted, added created", async () => {
  const oldFiles = { "package.json": JSON.stringify({ name: "hunt-simulation", version: "0.0.1" }), "a.js": "old a", "b.js": "same b", "c.js": "gone" };
  oldFiles["MANIFEST.json"] = man({ "a.js": oldFiles["a.js"], "b.js": oldFiles["b.js"], "c.js": oldFiles["c.js"] });
  const newFiles = { "package.json": JSON.stringify({ name: "hunt-simulation", version: "0.1.0" }), "a.js": "new a", "b.js": "same b", "d.js": "new d" };
  newFiles["MANIFEST.json"] = man({ "a.js": newFiles["a.js"], "b.js": newFiles["b.js"], "d.js": newFiles["d.js"] });
  const dir = appDir({ "package.json": oldFiles["package.json"], "a.js": "old a", "b.js": "same b", "c.js": "gone", "MANIFEST.json": oldFiles["MANIFEST.json"], "plugins/mine.txt": "keep" });
  // 本地改过 b.js（两个版本都没变它）→ 必须保留
  fs.writeFileSync(path.join(dir, "b.js"), "same b + local");
  const up = createUpdater({ appDir: dir, apiUrl: API, forkVersion: "V0.0.1", fetchImpl: stub({ target: zip(newFiles), old: zip(oldFiles) }) });
  const out = await up.apply();
  assert.equal(out.version, "0.1.0");
  assert.equal(out.changed, 1, "a.js");
  assert.equal(out.added, 1, "d.js");
  assert.equal(out.removed, 1, "c.js");
  assert.equal(fs.readFileSync(path.join(dir, "a.js"), "utf8"), "new a");
  assert.equal(fs.readFileSync(path.join(dir, "b.js"), "utf8"), "same b + local", "unchanged local edit survives");
  assert.equal(fs.existsSync(path.join(dir, "c.js")), false);
  assert.equal(fs.readFileSync(path.join(dir, "d.js"), "utf8"), "new d");
  assert.equal(fs.readFileSync(path.join(dir, "plugins/mine.txt"), "utf8"), "keep");
});

test("without the current release, the install's MANIFEST is the baseline", async () => {
  const newFiles = { "package.json": JSON.stringify({ name: "hunt-simulation", version: "0.1.0" }), "a.js": "new a", "b.js": "same b" };
  newFiles["MANIFEST.json"] = man({ "a.js": "new a", "b.js": "same b" });
  const dir = appDir({
    "package.json": JSON.stringify({ name: "hunt-simulation", version: "0.0.1" }),
    "a.js": "old a", "b.js": "same b",
    "MANIFEST.json": man({ "a.js": "old a", "b.js": "same b" }),
  });
  const up = createUpdater({ appDir: dir, apiUrl: API, forkVersion: "V0.0.1", fetchImpl: stub({ target: zip(newFiles), list: false }) });
  const out = await up.apply();
  assert.equal(out.oldBaseline, "manifest");
  assert.equal(out.changed, 1);
  assert.equal(out.added, 0);
  assert.equal(fs.readFileSync(path.join(dir, "a.js"), "utf8"), "new a");
});

test("a locally modified file that the update does change is backed up and reported", async () => {
  const oldFiles = { "a.js": "old a" };
  oldFiles["MANIFEST.json"] = man({ "a.js": "old a" });
  const newFiles = { "package.json": JSON.stringify({ name: "hunt-simulation", version: "0.1.0" }), "a.js": "new a" };
  newFiles["MANIFEST.json"] = man({ "a.js": "new a" });
  const dir = appDir({ "package.json": JSON.stringify({ name: "hunt-simulation", version: "0.0.1" }), "a.js": "patched a", "MANIFEST.json": oldFiles["MANIFEST.json"] });
  const up = createUpdater({ appDir: dir, apiUrl: API, forkVersion: "V0.0.1", fetchImpl: stub({ target: zip(newFiles), old: zip(oldFiles) }) });
  const out = await up.apply();
  assert.deepEqual(out.localMods, ["a.js"]);
  assert.equal(fs.readFileSync(path.join(dir, "a.js"), "utf8"), "new a");
  assert.ok(fs.existsSync(path.join(dir, ".update-backup", out.backup, "a.js")), "old bytes are backed up");
});

test("an official or foreign package is refused", async () => {
  const pkg = JSON.stringify({ name: "stronghold-protocol-alliance", version: "0.3.1" });
  const zipBuf = zipFiles([{ name: "Stronghold-Protocol/package.json", data: Buffer.from(pkg) }, { name: "Stronghold-Protocol/MANIFEST.json", data: Buffer.from(man({})) }]);
  const up = createUpdater({ appDir: appDir({ "package.json": JSON.stringify({ name: "hunt-simulation", version: "0.0.1" }) }), apiUrl: API, fetchImpl: stub({ target: zipBuf }) });
  await assert.rejects(() => up.apply(), /not a Hunt Simulation package/);
});
