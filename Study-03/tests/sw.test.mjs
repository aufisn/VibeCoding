// Checks that sw.js precaches every file the page needs: everything
// index.html references, every module reachable from js/app.js, and the
// manifest's icons. Also checks that every precached file exists.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";

const root = new URL("../", import.meta.url);
const read = (rel) => readFile(new URL(rel, root), "utf8");

async function precacheList() {
  const sw = await read("sw.js");
  const block = sw.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  assert.ok(block, "sw.js defines PRECACHE_URLS");
  const constants = Object.fromEntries([...sw.matchAll(/const (\w+) = "([^"]+)";/g)].map((m) => [m[1], m[2]]));
  return block[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith('"') ? item.slice(1, -1) : constants[item]));
}

/** Local files referenced by src/href attributes in index.html. */
async function htmlRefs() {
  const html = await read("index.html");
  return [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((ref) => !/^(?:[a-z]+:|\/\/|#)/i.test(ref));
}

/** Every module reachable from `entry` through static imports. */
async function moduleGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await read(file);
    for (const m of source.matchAll(/\bimport\s[^"']*?["'](\.{1,2}\/[^"']+)["']/g)) {
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
    }
  }
  return [...seen];
}

test("sw.js has a versioned cache name", async () => {
  assert.match(await read("sw.js"), /const CACHE_VERSION = "v\d+";/);
});

test("the precache list includes every file index.html references", async () => {
  const list = new Set(await precacheList());
  for (const ref of await htmlRefs()) assert.ok(list.has(ref), `${ref} is referenced by index.html but not precached`);
});

test("the precache list includes every JS module and the manifest icons", async () => {
  const list = new Set(await precacheList());
  for (const file of await moduleGraph("js/app.js")) assert.ok(list.has(file), `${file} is imported but not precached`);
  const manifest = JSON.parse(await read("manifest.webmanifest"));
  for (const iconEntry of manifest.icons) assert.ok(list.has(iconEntry.src), `${iconEntry.src} not precached`);
  assert.ok(list.has("./") && list.has("index.html"), "the page itself");
  assert.ok(list.has("data/questions.json"), "the questions, for a first offline load");
});

test("every precached file exists", async () => {
  for (const file of await precacheList()) {
    if (file === "./") continue;
    await assert.doesNotReject(access(new URL(file, root)), `${file} is precached but missing`);
  }
});

test("manifest has the required fields", async () => {
  const m = JSON.parse(await read("manifest.webmanifest"));
  assert.equal(m.start_url, ".");
  assert.equal(m.display, "standalone");
  for (const key of ["name", "short_name", "theme_color", "background_color"]) assert.ok(m[key], key);
  assert.deepEqual(m.icons.map((i) => i.sizes).sort(), ["192x192", "512x512"]);
});
