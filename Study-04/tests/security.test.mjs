import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";

import { checkConfig, loadConfig, maskKey, parseEnv } from "../server/config.mjs";
import { createOpenRouterClient, describeError } from "../server/openrouter.mjs";
import { startServer } from "../server.mjs";

const FAKE_KEY = "sk-or-v1-TESTKEY0000000000000000000000000000000000000000000000000000abcd";

/* ---------- .env parsing and checks ---------- */

test("parseEnv reads NAME=value, quotes, comments and export", () => {
  const { values, problems } = parseEnv('﻿# comment\nA=1\nexport B="two words"\nC=\'x#y\'\nD=plain # note\n\nnot a line\n');
  assert.deepEqual(values, { A: "1", B: "two words", C: "x#y", D: "plain" });
  assert.deepEqual(problems, ["line 7 isn't NAME=value"]);
});

test("maskKey shows only the start and the last 4 characters", () => {
  assert.equal(maskKey(FAKE_KEY), "sk-or-…abcd");
  assert.equal(maskKey(""), "(not set)");
  assert.ok(!maskKey(FAKE_KEY).includes("TESTKEY"));
});

test("checkConfig catches a missing or malformed key and a public HOST", () => {
  const good = { AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: FAKE_KEY, OPENROUTER_VISION_MODEL: "a/b:free", OPENROUTER_TEXT_MODEL: "c/d", HOST: "127.0.0.1", PORT: "8790" };
  assert.deepEqual(checkConfig(good), []);
  assert.match(checkConfig({ ...good, OPENROUTER_API_KEY: "" }).join(), /missing/);
  assert.match(checkConfig({ ...good, OPENROUTER_API_KEY: "sk-or- spaced key" }).join(), /spaces/);
  assert.match(checkConfig({ ...good, OPENROUTER_API_KEY: "sk-proj-abcdefghijkl" }).join(), /should start with "sk-or-"/);
  assert.match(checkConfig({ ...good, HOST: "0.0.0.0" }).join(), /must not be reachable/);
  assert.match(checkConfig({ ...good, OPENROUTER_TEXT_MODEL: "nope" }).join(), /provider\/model/);
});

test("loadConfig hides the key from printing and JSON, and warns about loose permissions", () => {
  const { config, problems, warnings } = loadConfig({
    env: {},
    read: () => `OPENROUTER_API_KEY=${FAKE_KEY}\n`,
    stat: () => ({ mode: 0o100644 }),
  });
  assert.deepEqual(problems, []);
  assert.equal(config.OPENROUTER_API_KEY, FAKE_KEY, "the server can still use it");
  assert.ok(!JSON.stringify(config).includes(FAKE_KEY));
  assert.ok(!Object.keys(config).includes("OPENROUTER_API_KEY"));
  assert.match(warnings.join(), /chmod 600/);
  assert.ok(!warnings.join().includes(FAKE_KEY));
});

test("environment variables win over .env", () => {
  const { config } = loadConfig({ env: { OPENROUTER_API_KEY: FAKE_KEY, PORT: "9999" }, read: () => "PORT=1234\n", stat: () => ({ mode: 0o100600 }) });
  assert.equal(config.PORT, "9999");
});

/* ---------- OpenRouter client ---------- */

test("the key is sent only to openrouter.ai, in the Authorization header", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ message: { content: "ready" } }] }), { status: 200 });
  };
  const client = createOpenRouterClient({ apiKey: FAKE_KEY, fetch: fakeFetch });
  const reply = await client.chat({ model: "a/b", messages: [{ role: "user", content: "hi" }] });
  assert.equal(reply.text, "ready");
  assert.match(calls[0].url, /^https:\/\/openrouter\.ai\/api\/v1\//);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.ok(!calls[0].init.body.includes(FAKE_KEY), "not in the body");
});

test("errors are plain messages without the key", async () => {
  const client = createOpenRouterClient({
    apiKey: FAKE_KEY,
    fetch: async () => new Response(JSON.stringify({ error: { message: `Invalid key ${FAKE_KEY}` } }), { status: 401 }),
  });
  await assert.rejects(client.keyInfo(), (err) => {
    assert.match(err.message, /refused the API key/);
    assert.ok(!err.message.includes(FAKE_KEY));
    return true;
  });
  assert.match(describeError(429), /rate limit/);
  const shared = { error: { message: "Provider returned error", metadata: { limit_source: "upstream_provider_shared_pool", provider_name: "Google AI Studio" } } };
  assert.match(describeError(429, shared), /busy for everyone.*Google AI Studio.*not a problem with your key/);
});

/* ---------- The running server ---------- */

const config = Object.freeze(
  Object.defineProperty({ AI_PROVIDER: "openrouter", OPENROUTER_VISION_MODEL: "v/vision", OPENROUTER_TEXT_MODEL: "t/text", HOST: "127.0.0.1", PORT: "0" }, "OPENROUTER_API_KEY", { value: FAKE_KEY })
);
const client = createOpenRouterClient({ apiKey: FAKE_KEY, fetch: async () => new Response("{}") });
const server = await startServer({
  config,
  client,
  log: () => {},
  routes: { "POST /api/test": async (req, res, ctx) => ctx.send(res, 200, { ok: true, got: await ctx.readJson(req) }) },
});
const port = server.address().port;
after(() => server.close());

/** Raw HTTP request, so the Host and Origin headers can be set freely. */
function get(path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c)).on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("the server listens on 127.0.0.1 only", () => {
  assert.equal(server.address().address, "127.0.0.1");
});

test("no response ever contains the key", async () => {
  const paths = ["/", "/index.html", "/app.js", "/style.css", "/api/status", "/api/nope", "/../.env", "/%2e%2e/.env", "/.env", "/../server/config.mjs"];
  for (const p of paths) {
    const r = await get(p, {});
    assert.ok(!r.text.includes(FAKE_KEY), `leak at ${p}`);
    assert.ok(!r.text.includes("TESTKEY"), `partial leak at ${p}`);
  }
});

test("status works and tells the page only what it needs", async () => {
  const r = await get("/api/status", {});
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.text), { ready: true, provider: "openrouter", models: { vision: "v/vision", text: "t/text" }, analyze: false });
  assert.match(r.headers["content-security-policy"], /default-src 'self'/);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
});

test("recognize and recipes need Claude, and refuse cross-site posts", async () => {
  const origin = `http://127.0.0.1:${port}`;
  const body = JSON.stringify({ image: { base64: "AAAA", mediaType: "image/jpeg" } });
  for (const path of ["/api/recognize", "/api/recipes"]) {
    const r = await get(path, { method: "POST", headers: { origin, "content-type": "application/json" }, body });
    assert.equal(r.status, 501, path);
    assert.match(JSON.parse(r.text).error, /needs Claude/);
    const evil = await get(path, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body });
    assert.equal(evil.status, 403, path);
  }
});

test("files outside public/ can't be reached", async () => {
  for (const p of ["/../.env", "/%2e%2e/.env", "/%2e%2e%2fserver.mjs", "/.env", "/..%5c.env"]) {
    const r = await get(p, {});
    assert.equal(r.status, 404, p);
  }
});

test("requests with a foreign Host header are refused (DNS rebinding)", async () => {
  const r = await get("/api/status", { headers: { host: "evil.example:80" } });
  assert.equal(r.status, 421);
});

test("cross-site POSTs are refused; same-site POSTs work", async () => {
  const evil = await get("/api/test", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
  assert.equal(evil.status, 403);
  const none = await get("/api/test", { method: "POST", body: "{}" });
  assert.equal(none.status, 403, "no Origin header at all");
  const ok = await get("/api/test", { method: "POST", headers: { origin: `http://127.0.0.1:${port}` }, body: '{"a":1}' });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.text).got, { a: 1 });
});

test("oversized and invalid bodies are refused", async () => {
  const origin = `http://localhost:${port}`;
  const bad = await get("/api/test", { method: "POST", headers: { origin, host: `localhost:${port}` }, body: "not json" });
  assert.equal(bad.status, 400);
  const big = await get("/api/test", { method: "POST", headers: { origin, host: `localhost:${port}` }, body: "x".repeat(9 * 1024 * 1024) });
  assert.equal(big.status, 413);
});

/* ---------- The two Claude routes, with a fake Claude ---------- */

test("recognize and recipes answer through Claude, and Claude's errors keep their HTTP status", async () => {
  const { MAX_IMAGE_BASE64 } = await import("../server/fridgechef.mjs");
  const { ClaudeError } = await import("../server/claude.mjs");
  assert.equal(MAX_IMAGE_BASE64 * 0.75, 5 * 1024 * 1024 + 1, "the base64 limit is 5 MB of image (rounded up to a whole base64 group)");
  let failWith = null;
  const claude = {
    async identifyIngredients(image) {
      if (failWith) throw failWith;
      assert.deepEqual(image, { base64: "AAAA", mediaType: "image/jpeg" });
      return { ingredients: [{ name: "eggs", quantity: "4", confidence: "high", category: "dairy & eggs" }], notes: "", model: "claude-sonnet-5-5", cost: 0.006 };
    },
    async writeRecipes(list, options) {
      if (failWith) throw failWith;
      return { recipes: [{ title: `${list[0]} ${options.cuisine}` }], model: "claude-sonnet-5-5", cost: 0.004 };
    },
  };
  const claudeConfig = Object.freeze({ AI_PROVIDER: "anthropic", ANTHROPIC_MODEL: "claude-sonnet-5-5", HOST: "127.0.0.1", PORT: "0" });
  const s2 = await startServer({ config: claudeConfig, client: claude, log: () => {} });
  const p2 = s2.address().port;
  const post = (path, body) =>
    new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: p2, path, method: "POST", headers: { host: `127.0.0.1:${p2}`, origin: `http://127.0.0.1:${p2}`, "content-type": "application/json" } }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c)).on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
  try {
    const seen = await post("/api/recognize", { image: { base64: "AAAA", mediaType: "image/jpeg" } });
    assert.equal(seen.status, 200);
    assert.equal(seen.body.type, "recognize");
    assert.deepEqual(seen.body.ingredients.map((i) => i.name), ["eggs"]);
    const cooked = await post("/api/recipes", { ingredients: ["eggs"], options: { cuisine: "French" } });
    assert.equal(cooked.status, 200);
    assert.deepEqual(cooked.body.recipes, [{ title: "eggs French" }]);
    assert.equal((await post("/api/recipes", { ingredients: [] })).status, 400, "input checks give 400");
    assert.equal((await post("/api/recognize", { image: { base64: "A".repeat(MAX_IMAGE_BASE64 + 4), mediaType: "image/jpeg" } })).status, 413);

    failWith = new ClaudeError("Too many requests or spending limit reached. Wait a moment and try again.", 429);
    const limited = await post("/api/recognize", { image: { base64: "AAAA", mediaType: "image/jpeg" } });
    assert.deepEqual([limited.status, limited.body.error], [429, failWith.message]);
    failWith = new ClaudeError("Claude declined this request.", 200); // a 200 from Anthropic is still a failure here
    assert.equal((await post("/api/recipes", { ingredients: ["eggs"] })).status, 502);
    failWith = new ClaudeError("Couldn't reach Anthropic.", 0);
    assert.equal((await post("/api/recipes", { ingredients: ["eggs"] })).status, 502);
    failWith = new TypeError("secret internals sk-ant-xyz");
    const hidden = await post("/api/recipes", { ingredients: ["eggs"] });
    assert.deepEqual([hidden.status, hidden.body.error], [502, "Claude couldn't answer."], "unexpected errors don't leak their message");
  } finally {
    s2.close();
  }
});
