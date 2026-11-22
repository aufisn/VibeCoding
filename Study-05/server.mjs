// Empathy diary server: serves the page and talks to Claude with the official SDK.
// Listens on 127.0.0.1 only. The key is read from .env and never logged or sent to the browser.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createClaude } from "./claude.mjs";
import { handleJournalRoute, isJournalRoute, journalFromEnv, JOURNAL_RATE_MAX, notConfiguredMessage, saveReflection } from "./server-journal.mjs";

const require = createRequire(import.meta.url);
const Core = require("./diary-core.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HOST = "127.0.0.1";
export const PORT = 8791;
const MAX_BODY = 4096;
const RATE_MAX = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;

export { createClaude };

function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:8791; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error("That request was too large."), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * @param {{ claude: { reflect(body: object): Promise<object> } | null, journal?: object | null, now?: () => number, baseDir?: string }} opts
 *   journal: web/journal.mjs's createJournal() result, or null when the journal isn't configured
 *   journalMissing / journalProblem: from journalFromEnv, used to word the "not connected" message
 */
export function createServer({ claude, journal = null, journalMissing = [], journalProblem = "", now = Date.now, baseDir = HERE } = {}) {
  const notConfigured = notConfiguredMessage(journalMissing, journalProblem);
  let hits = [];
  let journalHits = [];

  function journalLimited() {
    const t = now();
    journalHits = journalHits.filter((h) => t - h < RATE_WINDOW_MS);
    if (journalHits.length >= JOURNAL_RATE_MAX) return true;
    journalHits.push(t);
    return false;
  }

  function rateLimited() {
    const t = now();
    hits = hits.filter((h) => t - h < RATE_WINDOW_MS);
    if (hits.length >= RATE_MAX) return true;
    hits.push(t);
    return false;
  }

  return http.createServer(async (req, res) => {
    // Same-origin only: Host and Origin must be this server's own address (blocks DNS rebinding and other sites).
    const localPort = req.socket.localPort;
    const hosts = [`127.0.0.1:${localPort}`, `localhost:${localPort}`];
    if (!hosts.includes(String(req.headers.host ?? "").toLowerCase())) return sendJson(res, 421, { error: "Unexpected Host header. Open the diary at http://127.0.0.1:8791/." });
    const origin = req.headers.origin;
    const cors = {};
    if (origin !== undefined) {
      if (!hosts.some((h) => origin === `http://${h}`)) return sendJson(res, 403, { error: "This site is not allowed to use the diary server." });
      Object.assign(cors, { "access-control-allow-origin": origin, vary: "Origin" });
    }
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const route = url.pathname;

      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...cors, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, x-diary", "access-control-max-age": "600" });
        return res.end();
      }

      if (route === "/favicon.ico") {
        res.writeHead(204, { "cache-control": "max-age=86400" });
        return res.end();
      }

      const head = req.method === "HEAD";
      if (route === "/" || route === "/index.html") {
        if (req.method !== "GET" && !head) return sendJson(res, 405, { error: "Use GET." }, { ...cors, allow: "GET, HEAD" });
        const file = path.join(baseDir, "index.html");
        res.writeHead(200, HTML_HEADERS);
        if (head) return res.end();
        if (!fs.existsSync(file)) return res.end("<!doctype html><meta charset=utf-8><title>Empathy diary</title><p>index.html is not built yet.</p>");
        return res.end(fs.readFileSync(file));
      }

      if (route === "/diary-core.js") {
        if (req.method !== "GET" && !head) return sendJson(res, 405, { error: "Use GET." }, { ...cors, allow: "GET, HEAD" });
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-cache", ...cors });
        return res.end(head ? undefined : fs.readFileSync(path.join(HERE, "diary-core.js")));
      }

      if (route === "/api/status") {
        if (req.method !== "GET") return sendJson(res, 405, { error: "Use GET." }, { ...cors, allow: "GET" });
        return sendJson(res, 200, { ok: true, mode: "server", model: Core.MODEL, keyLoaded: Boolean(claude), journalConfigured: Boolean(journal), journalMissing: journal ? [] : journalMissing }, cors);
      }

      if (route === "/api/reflect") {
        if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST." }, { ...cors, allow: "POST, OPTIONS" });
        if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return sendJson(res, 415, { error: "Send JSON (content-type: application/json)." }, cors);
        const raw = await readBody(req);
        let data;
        try { data = JSON.parse(raw); } catch { data = null; }
        if (!data || typeof data !== "object" || Array.isArray(data)) return sendJson(res, 400, { error: "The request was not valid JSON." }, cors);
        const text = Core.checkEntry(data.text);
        if (!claude) return sendJson(res, 503, { error: "The server has no API key. Add ANTHROPIC_API_KEY to .env and restart." }, cors);
        if (rateLimited()) return sendJson(res, 429, { error: "That is a lot of entries in a short time. Please wait a few minutes and try again." }, { ...cors, "retry-after": "600" });
        const message = await claude.reflect(Core.buildRequestBody(text));
        const result = Core.parseResult(message);
        // The reply always goes out; the journal save only adds saved / entryId (and saveError + entry when it failed).
        return sendJson(res, 200, { ...result, ...(await saveReflection(journal, { text, result, now: now(), notConfigured })) }, cors);
      }

      if (isJournalRoute(route)) {
        return await handleJournalRoute({ req, res, route, url, journal, cors, sendJson, readBody, limited: journalLimited, now, notConfigured });
      }

      return sendJson(res, 404, { error: "Not found." }, cors);
    } catch (err) {
      const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
      const message = err?.status ? String(err.message) : "Something went wrong on the server.";
      const code = err?.status && typeof err.code === "string" ? { code: err.code } : {};
      if (!res.headersSent) sendJson(res, status, { error: message, ...code }, cors);
      else res.end();
    }
  });
}

function loadEnv() {
  try { process.loadEnvFile(path.join(HERE, ".env")); } catch { /* no .env: keys may come from the environment */ }
  return { apiKey: process.env.ANTHROPIC_API_KEY?.trim() || "", workspaceId: process.env.ANTHROPIC_WORKSPACE_ID?.trim() || "" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { apiKey, workspaceId } = loadEnv();
  const claude = apiKey ? createClaude({ apiKey, workspaceId }) : null;
  const { journal, problem: journalProblem, missing: journalMissing } = journalFromEnv(process.env);
  const server = createServer({ claude, journal, journalMissing, journalProblem });
  server.on("error", (err) => {
    console.error(err?.code === "EADDRINUSE" ? `Port ${PORT} is busy: is the diary server already running?` : `The server could not start (${err?.code ?? "unknown error"}).`);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(`Empathy diary: http://${HOST}:${PORT}`);
    console.log(`Model: ${Core.MODEL}`);
    console.log(`API key found: ${apiKey ? "yes" : "no"}`);
    console.log(`Workspace ID found: ${workspaceId ? "yes" : "no"}`);
    console.log(`Journal: ${journal ? "connected" : `not configured: ${journalProblem}`}`);
    if (!apiKey) console.log("Add ANTHROPIC_API_KEY to .env (see .env.example) and restart.");
  });
}
