import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createServer } from "../server.mjs";

const good = { primary_emotion: "calm", emotions: [{ id: "calm", intensity: 3 }], mood_score: 7, summary: "Calm", empathy: "Nice.", comfort: "Rest.", gentle_step: "", concern: "none", language: "en" };
let calls = [];
let mode = "ok";
const claude = {
  async reflect(body) {
    calls.push(body);
    if (mode === "fail") throw Object.assign(new Error("Claude is overloaded right now. Please try again shortly."), { status: 502 });
    return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(good) }], usage: { input_tokens: 500, output_tokens: 100 } };
  },
};

let server, base, clock = 1000;
before(async () => {
  server = createServer({ claude, now: () => clock, baseDir: "/nonexistent-dir" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (body, headers = {}) => fetch(base + "/api/reflect", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("status never exposes a key", async () => {
  const r = await fetch(base + "/api/status");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, mode: "server", model: "claude-sonnet-5-5", keyLoaded: true, journalConfigured: false, journalMissing: [] });
});
test("GET / without index.html, and /diary-core.js", async () => {
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /not built yet/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  const csp = r.headers.get("content-security-policy");
  assert.ok(csp);
  assert.doesNotMatch(csp, /anthropic\.com/, "the page never talks to Anthropic");
  const j = await fetch(base + "/diary-core.js");
  assert.match(j.headers.get("content-type"), /javascript/);
  assert.match(await j.text(), /DiaryCore/);
});
test("reflect ok", async () => {
  const r = await post({ text: "A quiet walk after work" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.primary_emotion, "calm");
  assert.equal(j.usage.input_tokens, 500);
  assert.equal(calls.at(-1).model, "claude-sonnet-5-5");
});
test("bad JSON, non-object, wrong content type, empty, too long", async () => {
  assert.equal((await post("{nope")).status, 400);
  assert.equal((await post("[1]")).status, 400);
  assert.equal((await post({ text: 5 })).status, 400);
  assert.equal((await post({ text: "   " })).status, 400);
  const long = await post({ text: "a".repeat(301) });
  assert.equal(long.status, 400);
  assert.match((await long.json()).error, /300/);
  const ct = await fetch(base + "/api/reflect", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
  assert.equal(ct.status, 415);
});
test("body over 4 KB is rejected", async () => {
  const r = await post({ text: "a", pad: "x".repeat(5000) }).catch(() => null);
  if (r) assert.equal(r.status, 413);
});
test("wrong method and unknown route", async () => {
  assert.equal((await fetch(base + "/api/reflect")).status, 405);
  assert.equal((await fetch(base + "/api/status", { method: "POST" })).status, 405);
  assert.equal((await fetch(base + "/nope")).status, 404);
  assert.equal((await fetch(base + "/.env")).status, 404);
  assert.equal((await fetch(base + "/server.mjs")).status, 404);
});
test("CORS: allowed vs disallowed, preflight", async () => {
  const port = new URL(base).port;
  for (const origin of [`http://127.0.0.1:${port}`, `http://localhost:${port}`]) {
    const r = await fetch(base + "/api/status", { headers: { origin } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), origin);
  }
  const bad = await fetch(base + "/api/status", { headers: { origin: "https://evil.example" } });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
  const pre = await fetch(base + "/api/reflect", { method: "OPTIONS", headers: { origin: base, "access-control-request-method": "POST" } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-headers"), /content-type/);
  const preBad = await fetch(base + "/api/reflect", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
  assert.equal(preBad.status, 403);
});
test("Claude failure becomes a plain error", async () => {
  mode = "fail";
  const r = await post({ text: "Long day at work" });
  mode = "ok";
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /overloaded/);
});
test("rate limit: 20 per 10 minutes, then resets", async () => {
  clock += 11 * 60 * 1000;
  let last;
  for (let i = 0; i < 20; i++) { last = await post({ text: "Another day" }); assert.equal(last.status, 200, `call ${i}`); }
  const blocked = await post({ text: "Another day" });
  assert.equal(blocked.status, 429);
  clock += 11 * 60 * 1000;
  assert.equal((await post({ text: "Another day" })).status, 200);
});
test("no key: reflect gives 503, status says keyLoaded false", async () => {
  const s = createServer({ claude: null });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${s.address().port}`;
  assert.equal((await (await fetch(b + "/api/status")).json()).keyLoaded, false);
  const r = await fetch(b + "/api/reflect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello day" }) });
  assert.equal(r.status, 503);
  s.close();
});

test("origin null and old allowlist entries get 403 on reflect", async () => {
  for (const origin of ["null", "https://aufisn.github.io"]) {
    const r = await post({ text: "A quiet day" }, { origin });
    assert.equal(r.status, 403, origin);
  }
  assert.equal((await post({ text: "A quiet day" })).status, 200); // no Origin (curl) still works
});
test("wrong Host header is rejected (DNS rebinding)", async () => {
  const { port } = server.address();
  const raw = (host) => new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => s.write(`GET /api/status HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
    let d = ""; s.on("data", (c) => (d += c)); s.on("end", () => resolve(d.split(" ")[1]));
  });
  assert.equal(await raw("evil.example:8791"), "421");
  assert.equal(await raw("127.0.0.1"), "421");
  assert.equal(await raw(`localhost:${port}`), "200");
});
test("HEAD / and /diary-core.js: 200, headers, no body", async () => {
  for (const p of ["/", "/diary-core.js"]) {
    const r = await fetch(base + p, { method: "HEAD" });
    assert.equal(r.status, 200);
    assert.ok(r.headers.get("content-type"));
    assert.equal(await r.text(), "");
  }
});
test("favicon is 204", async () => {
  assert.equal((await fetch(base + "/favicon.ico")).status, 204);
});
test("emoji-only entry works; digits-only is rejected", async () => {
  assert.equal((await post({ text: "😊" })).status, 200);
  const r = await post({ text: "1234 !!!" });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /words or an emoji/);
});
test("server-mode Claude errors name the server's .env", async () => {
  const { createClaude } = await import("../server.mjs");
  const c = createClaude({ apiKey: "sk-ant-fake" });
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(c.reflect({ model: "m", max_tokens: 1, messages: [] }), (e) => e.status === 401 && /ANTHROPIC_API_KEY in Study-05\/\.env/.test(e.message));
  } finally { globalThis.fetch = orig; }
});
