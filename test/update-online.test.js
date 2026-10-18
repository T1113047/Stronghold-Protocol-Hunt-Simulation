// [UPDATE] server/updateOnline.js — GitHub Release 检查 / 下载 / 精准更新 / 同版本精简包校验。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createUpdater, compareVersions } from "../server/updateOnline.js";
import { zipFiles } from "../server/plugins/zip.js";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const man = (files) => JSON.stringify({ format: 1, app: "0.3.1", files: Object.fromEntries(Object.entries(files).map(([r, d]) => [r, { size: Buffer.byteLength(d), sha256: sha(Buffer.from(d)) }])) });
const zip = (root, files) => zipFiles(Object.entries(files).map(([name, data]) => ({ name: `${root}/${name}`, data: Buffer.from(data) })));

const RELEASE = {
  tag_name: "v0.1.0", name: "V0.1.0", body: "notes", published_at: "2026-10-18T00:00:00Z",
  assets: [
    { name: "Hunt-Simulation-v0.1.0-lite.zip", size: 0, browser_download_url: "https://example.test/lite.zip" },
    { name: "Hunt-Simulation-v0.1.0-update.zip", size: 0, browser_download_url: "https://example.test/update.zip" },
  ],
};
const stub = ({ lite, update = null, release = RELEASE }) => async (url) => {
  if (String(url).includes("api.github.com")) return { ok: true, json: async () => release };
  const buf = String(url).endsWith("update.zip") ? update : lite;
  return { ok: true, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(buf)); c.close(); } }) };
};
const appDir = (pkgVersion = "0.0.1", extra = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "up-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "hunt-simulation", version: pkgVersion }));
  for (const [rel, data] of Object.entries(extra)) {
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

test("check maps the release and its assets", async () => {
  const up = createUpdater({ appDir: os.tmpdir(), fetchImpl: stub({ lite: Buffer.alloc(0) }) });
  const r = await up.check(true);
  assert.equal(r.version, "0.1.0");
  assert.equal(r.assets.lite.name, "Hunt-Simulation-v0.1.0-lite.zip");
  assert.equal(r.assets.update.name, "Hunt-Simulation-v0.1.0-update.zip");
});

test("lite: cross-version, precise, keeps user plugins, deletes only old managed files", async () => {
  const files = { "package.json": JSON.stringify({ name: "hunt-simulation", version: "0.1.0" }), "index.js": "console.log(2)" };
  files["MANIFEST.json"] = man({ "index.js": files["index.js"] });
  const dir = appDir("0.0.1", { "old.js": "old", "plugins/mine.txt": "keep" });
  fs.writeFileSync(path.join(dir, "MANIFEST.json"), man({ "old.js": "old" }));
  const up = createUpdater({ appDir: dir, fetchImpl: stub({ lite: zip("Hunt-Simulation", files) }) });
  const out = await up.apply("lite");
  assert.equal(out.version, "0.1.0");
  assert.equal(fs.readFileSync(path.join(dir, "index.js"), "utf8"), "console.log(2)");
  assert.equal(fs.existsSync(path.join(dir, "old.js")), false);
  assert.equal(fs.readFileSync(path.join(dir, "plugins/mine.txt"), "utf8"), "keep");
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, "MANIFEST.json"), "utf8")).files["index.js"]);
});

test("update: pulls the same version lite, repairs a missing managed file, refuses other bases", async () => {
  const complete = {
    "package.json": JSON.stringify({ name: "hunt-simulation", version: "0.1.0" }),
    "a.js": "new a",
    "b.js": "same b",
  };
  const liteFiles = { ...complete, "MANIFEST.json": man({ "a.js": complete["a.js"], "b.js": complete["b.js"] }) };
  const updFiles = {
    "package.json": complete["package.json"],
    "a.js": complete["a.js"],
    "MANIFEST.json": liteFiles["MANIFEST.json"],
    "UPDATE.json": JSON.stringify({ format: 1, app: "0.3.1", from: ["0.0.1"], count: 3, bytes: 10, files: {}, removed: [] }),
  };
  const dir = appDir("0.0.1", { "a.js": "old a" });
  fs.writeFileSync(path.join(dir, "MANIFEST.json"), man({ "a.js": "old a", "b.js": "same b" }));
  // b.js 丢了：更新包不含它，必须由同版本精简包修复
  const up = createUpdater({ appDir: dir, fetchImpl: stub({ lite: zip("Hunt-Simulation", liteFiles), update: zip("Hunt-Simulation", updFiles) }) });
  const out = await up.apply("update");
  assert.equal(out.version, "0.1.0");
  assert.equal(out.repaired, 1, "b.js repaired from the lite package");
  assert.equal(fs.readFileSync(path.join(dir, "b.js"), "utf8"), "same b");

  const bad = appDir("0.0.0", { "a.js": "old a" });
  const up2 = createUpdater({ appDir: bad, fetchImpl: stub({ lite: zip("Hunt-Simulation", liteFiles), update: zip("Hunt-Simulation", updFiles) }) });
  await assert.rejects(() => up2.apply("update"), /不允许跨版本/);
});

test("update refuses a package that disagrees with the lite of the same version", async () => {
  const liteFiles = {
    "package.json": JSON.stringify({ name: "hunt-simulation", version: "0.1.0" }),
    "a.js": "lite a",
    "MANIFEST.json": man({ "a.js": "lite a" }),
  };
  const updFiles = {
    "package.json": liteFiles["package.json"],
    "a.js": "different a",
    "MANIFEST.json": liteFiles["MANIFEST.json"],
    "UPDATE.json": JSON.stringify({ format: 1, app: "0.3.1", from: ["0.0.1"], files: {}, removed: [] }),
  };
  const dir = appDir("0.0.1", { "a.js": "old a" });
  const up = createUpdater({ appDir: dir, fetchImpl: stub({ lite: zip("Hunt-Simulation", liteFiles), update: zip("Hunt-Simulation", updFiles) }) });
  await assert.rejects(() => up.apply("update"), /不一致/);
});

test("an official or foreign package is refused", async () => {
  const files = {
    "package.json": JSON.stringify({ name: "stronghold-protocol-alliance", version: "0.3.1" }),
    "MANIFEST.json": man({}),
  };
  const up = createUpdater({ appDir: appDir(), fetchImpl: stub({ lite: zip("Stronghold-Protocol", files) }) });
  await assert.rejects(() => up.apply("lite"), /not a Hunt Simulation package/);
});
