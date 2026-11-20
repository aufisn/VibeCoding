#!/usr/bin/env node
// FridgeChef local server. It serves the web page from public/ and is the
// only place the API key is used: the browser talks to this server, and this
// server talks to Anthropic (or OpenRouter). The key never reaches the browser.
//
//   npm start            (or: node server.mjs)
//   → http://127.0.0.1:8790
//
// Security:
// - listens on 127.0.0.1 only, so other computers on the network can't use it
// - refuses requests whose Host header isn't this machine (blocks DNS rebinding,
//   where a web page tricks the browser into calling a local server)
// - refuses cross-site POSTs (Origin must be this server)
// - strict Content-Security-Policy: the page may only load its own files
// - static files only from public/, no path traversal, no directory listings

import { createServer as createHttpServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, maskKey } from "./server/config.mjs";
import { createOpenRouterClient } from "./server/openrouter.mjs";
import { createClaudeClient } from "./server/claude.mjs";
import { handleRequest } from "./server/fridgechef.mjs";

/** The models in use for each step, for the active provider. */
export function activeModels(config) {
  return config.AI_PROVIDER === "anthropic"
    ? { vision: config.ANTHROPIC_MODEL, text: config.ANTHROPIC_MODEL }
    : { vision: config.OPENROUTER_VISION_MODEL, text: config.OPENROUTER_TEXT_MODEL };
}

/** The active provider's API key (server side only). */
export const activeKey = (config) => (config.AI_PROVIDER === "anthropic" ? config.ANTHROPIC_API_KEY : config.OPENROUTER_API_KEY);

export const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
export const MAX_BODY_BYTES = 8 * 1024 * 1024; // room for a phone photo as base64

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/** Host headers this server answers to. */
export function allowedHosts(port) {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

function send(res, status, body, type = "application/json; charset=utf-8", extra = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type, "Cache-Control": "no-store", ...extra });
  res.end(data);
}

/** Read a JSON request body, refusing anything over `limit` bytes. */
export async function readJson(req, limit = MAX_BODY_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request is too large."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request isn't valid JSON."), { status: 400 });
  }
}

/**
 * The request handler. `routes` maps "METHOD /path" to async (req, res, ctx)
 * handlers, so later features (ingredient analysis, recipes) plug in here.
 */
export function createApp({ config, client, publicDir = PUBLIC_DIR, routes = {}, port = () => config.PORT }) {
  // Worked out on the first request, from the port actually in use (PORT can
  // be 0 = any free port, known only once the server listens).
  let hosts;
  let origins;
  const refresh = () => {
    hosts = allowedHosts(port());
    origins = new Set([...hosts].map((h) => `http://${h}`));
  };
  const allRoutes = {
    "GET /api/status": async (_req, res) =>
      send(res, 200, {
        ready: Boolean(client),
        provider: config.AI_PROVIDER,
        models: activeModels(config),
        analyze: typeof client?.identifyIngredients === "function",
      }),
    // Step 1, a photo → ingredients; step 3, ingredients + options → two recipes (Claude only).
    "POST /api/recognize": (req, res) => answer(req, res, "recognize"),
    "POST /api/recipes": (req, res) => answer(req, res, "recipes"),
    ...routes,
  };

  async function answer(req, res, type) {
    if (typeof client?.identifyIngredients !== "function") return send(res, 501, { error: "FridgeChef needs Claude: add ANTHROPIC_API_KEY to .env." });
    const body = await readJson(req);
    try {
      return send(res, 200, await handleRequest(client, { ...body, type }));
    } catch (err) {
      // ClaudeError and the input checks carry plain messages without the key.
      const status = err.status >= 400 && err.status < 600 ? err.status : 502;
      return send(res, status, { error: err.name === "ClaudeError" || err.status ? err.message : "Claude couldn't answer." });
    }
  }

  return async function handle(req, res) {
    try {
      if (!hosts) refresh();
      if (!hosts.has(req.headers.host ?? "")) return send(res, 421, { error: "Unknown host." });
      const url = new URL(req.url, `http://${req.headers.host}`);
      const route = allRoutes[`${req.method} ${url.pathname}`];

      if (route) {
        if (req.method !== "GET" && req.method !== "HEAD" && !origins.has(req.headers.origin ?? "")) {
          return send(res, 403, { error: "Cross-site requests aren't allowed." });
        }
        return await route(req, res, { config, client, url, send, readJson });
      }
      if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "Not found." });
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed." }, undefined, { Allow: "GET, HEAD" });

      // Static files from public/ only.
      let path;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        return send(res, 400, "Bad request", "text/plain; charset=utf-8");
      }
      if (path.endsWith("/")) path += "index.html";
      const file = normalize(join(publicDir, path));
      if (!file.startsWith(publicDir.endsWith(sep) ? publicDir : publicDir + sep) || path.includes("\0")) {
        return send(res, 404, "Not found", "text/plain; charset=utf-8");
      }
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) return send(res, 404, "Not found", "text/plain; charset=utf-8");
      const body = await readFile(file);
      res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status === 500) console.error("Server error:", err.message);
      if (!res.headersSent) send(res, status, { error: status === 500 ? "Something went wrong on the server." : err.message });
    }
  };
}

export function startServer({ config, client, routes, log = console.log } = {}) {
  const server = createHttpServer();
  server.on("request", createApp({ config, client, routes, port: () => server.address().port }));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(config.PORT), config.HOST, () => {
      log(`FridgeChef is running at http://${config.HOST === "::1" ? "[::1]" : config.HOST}:${server.address().port}`);
      log(`${config.AI_PROVIDER === "anthropic" ? "Anthropic" : "OpenRouter"} key ${maskKey(activeKey(config))} loaded (stays on this server). Press Ctrl+C to stop.`);
      resolve(server);
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { config, problems, warnings } = loadConfig();
  for (const w of warnings) console.warn(`⚠ ${w}`);
  if (problems.length) {
    for (const p of problems) console.error(`✖ ${p}`);
    console.error("\nFix .env, then run: npm run check");
    process.exit(1);
  }
  const client =
    config.AI_PROVIDER === "anthropic"
      ? createClaudeClient({ apiKey: config.ANTHROPIC_API_KEY, model: config.ANTHROPIC_MODEL, workspaceId: config.ANTHROPIC_WORKSPACE_ID })
      : createOpenRouterClient({ apiKey: config.OPENROUTER_API_KEY, appUrl: `http://${config.HOST}:${config.PORT}` });
  await startServer({ config, client }).catch((err) => {
    console.error(err.code === "EADDRINUSE" ? `✖ Port ${config.PORT} is in use. Set another PORT in .env.` : `✖ ${err.message}`);
    process.exit(1);
  });
}
