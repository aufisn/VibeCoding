// The journal for the local server: the Gist connection from .env and the /api/journal routes.
// The journal itself is web/journal.mjs (the same code the page and the GitHub job use).
// Nothing here logs diary text, the Gist token or the passphrase.

import { createGistClient } from "./web/mailbox.mjs";
import { createJournal, entryFromResult, isMonth, JournalError, newEntryId } from "./web/journal.mjs";

export const MAX_JOURNAL_BODY = 4096; // hide, unhide, delete-all
export const MAX_RETRY_BODY = 16 * 1024; // one entry with its quote
export const MAX_IMPORT_BODY = 1024 * 1024; // up to 500 old entries (about 2 KB each)
export const JOURNAL_RATE_MAX = 60;
export const DIARY_HEADER = "x-diary"; // every /api/journal request must carry "X-Diary: 1" (a cross-site page can't add it without a preflight)
export const LATEST_DEFAULT = 2;
export const LATEST_MAX = 120;

const ENV_NAMES = ["FC_GIST_ID", "FC_GIST_TOKEN", "FC_PASSPHRASE"];
const list = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** The one "not connected" sentence, built from the names that are really missing (or the problem found). Never holds a value. */
export function notConfiguredMessage(missing = [], problem = "") {
  const head = "Your Journal isn't connected on this computer:";
  if (missing.length) return `${head} add ${list(missing)} to Study-05/.env, then restart the server.`;
  if (problem) return `${head} ${problem.replace(/[.\s]*$/, "")}. Fix it in Study-05/.env, then restart the server.`;
  return `${head} add ${list(ENV_NAMES)} to Study-05/.env, then restart the server.`;
}

/**
 * The journal from the environment (FC_GIST_ID, FC_GIST_TOKEN, FC_PASSPHRASE).
 * @returns {{ journal: object | null, problem: string, missing: string[] }}  problem is a plain phrase naming settings, never values
 */
export function journalFromEnv(env, { fetch = globalThis.fetch } = {}) {
  const id = String(env.FC_GIST_ID ?? "").trim();
  const token = String(env.FC_GIST_TOKEN ?? "").trim();
  const passphrase = String(env.FC_PASSPHRASE ?? "");
  const missing = [["FC_GIST_ID", id], ["FC_GIST_TOKEN", token], ["FC_PASSPHRASE", passphrase]].filter(([, v]) => !v).map(([n]) => n);
  if (missing.length) return { journal: null, problem: `missing ${missing.join(", ")}`, missing };
  if (passphrase.length < 12) return { journal: null, problem: "FC_PASSPHRASE should be at least 12 characters", missing: [] };
  try {
    return { journal: createJournal({ gist: createGistClient({ token, gistId: id, fetch }), passphrase }), problem: "", missing: [] };
  } catch (err) {
    return { journal: null, problem: String(err?.message ?? "The journal settings are not valid.").replace(token, "***").replace(/[.\s]*$/, ""), missing: [] };
  }
}

/**
 * Local mode has no Settings screen: the journal's wrong-passphrase and GitHub-refused errors
 * are re-worded to name the .env entry to fix. Other errors pass through unchanged.
 */
export function localizeError(err) {
  if (!(err instanceof JournalError)) return err;
  let message = null;
  if (err.code === "passphrase") message = "FC_PASSPHRASE in Study-05/.env can't open your journal (it must match the passphrase used on your phone). Fix it and restart the server.";
  else if (err.code === "gist" && (err.gistStatus === 401 || err.gistStatus === 403)) message = "FC_GIST_TOKEN in Study-05/.env was refused by GitHub (it is wrong or expired, it lacks the gist permission, or GitHub's hourly limit was reached). Fix it and restart the server.";
  else if (err.code === "gist" && err.gistStatus === 404) message = "GitHub couldn't find your journal Gist: check FC_GIST_ID in Study-05/.env, and that FC_GIST_TOKEN can see it. Then restart the server.";
  return message ? Object.assign(new JournalError(err.code, message), { gistStatus: err.gistStatus }) : err;
}

/**
 * Saves a finished reflection after the reply. Never throws: the reply must always go out.
 * @returns {{ saved: boolean, entryId: string, entry: object, saveError?: string }}
 */
export async function saveReflection(journal, { text, result, now, notConfigured = notConfiguredMessage() }) {
  const entry = entryFromResult({ id: newEntryId(now), text, result, createdAt: new Date(now).toISOString(), mode: "local" });
  if (!journal) return { saved: false, entryId: entry.id, saveError: notConfigured, entry };
  try {
    await journal.append(entry);
    return { saved: true, entryId: entry.id, entry }; // the entry comes back either way
  } catch (err) {
    return { saved: false, entryId: entry.id, saveError: err instanceof JournalError ? localizeError(err).message : "The journal could not be saved.", entry };
  }
}

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

/** Parses a JSON object body (size already capped by readBody). */
async function readJsonObject(req, readBody, max) {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw fail(415, "Send JSON (content-type: application/json).");
  let data;
  try { data = JSON.parse(await readBody(req, max)); } catch (err) { if (err?.status) throw err; data = null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw fail(400, "The request was not valid JSON.");
  return data;
}

const ROUTES = new Set(["/api/journal", "/api/journal/months", "/api/journal/hide", "/api/journal/unhide", "/api/journal/retry", "/api/journal/import", "/api/journal/delete-all", "/api/journal/export"]);
export const isJournalRoute = (route) => ROUTES.has(route);

/** How many months a `latest` query value means (default 2), or "all". */
function parseLatest(v) {
  if (v === null) return LATEST_DEFAULT;
  if (v === "all") return "all";
  if (!/^\d{1,3}$/.test(v) || Number(v) < 1 || Number(v) > LATEST_MAX) throw fail(400, `latest should be a number from 1 to ${LATEST_MAX}, or "all".`, "invalid");
  return Number(v);
}

/**
 * Handles one /api/journal... request. Host and Origin were already checked by the caller.
 * ctx: { req, res, route, url, journal, cors, sendJson, readBody, limited, now, notConfigured }
 * Every request must send "X-Diary: 1": it is checked (403) BEFORE the rate limiter, so a page on another
 * site (which can send a plain GET without it) can't use up the limit. With curl: -H "X-Diary: 1".
 */
export async function handleJournalRoute({ req, res, route, url, journal, cors, sendJson, readBody, limited, now = Date.now, notConfigured = notConfiguredMessage() }) {
  if (req.headers[DIARY_HEADER] !== "1") return sendJson(res, 403, { error: 'Journal requests must send the header "X-Diary: 1". The diary page does this itself.', code: "forbidden" }, cors);
  const get = route === "/api/journal" || route === "/api/journal/months" || route === "/api/journal/export";
  if (req.method !== (get ? "GET" : "POST")) return sendJson(res, 405, { error: get ? "Use GET." : "Use POST." }, { ...cors, allow: `${get ? "GET" : "POST"}, OPTIONS` });
  if (limited()) return sendJson(res, 429, { error: "That is a lot of journal requests in a short time. Please wait a few minutes and try again." }, { ...cors, "retry-after": "600" });

  // Check the request itself before saying anything about the setup.
  let body;
  if (!get) {
    const max = route === "/api/journal/import" ? MAX_IMPORT_BODY : route === "/api/journal/retry" ? MAX_RETRY_BODY : MAX_JOURNAL_BODY;
    body = await readJsonObject(req, readBody, max);
  }
  if (!journal) return sendJson(res, 503, { error: notConfigured, code: "not_configured" }, cors);

  try {
    return await run();
  } catch (err) {
    throw localizeError(err);
  }

  async function run() {
    if (route === "/api/journal") {
      const month = url.searchParams.get("month");
      if (month !== null && !isMonth(month)) throw fail(400, "The month should look like 2026-11.", "invalid");
      const latest = parseLatest(url.searchParams.get("latest"));
      const data = month ? await journal.readMonth(month) : latest === "all" ? await journal.readAll() : await journal.readLatest(latest);
      return sendJson(res, 200, { configured: true, ...data }, cors);
    }
    if (route === "/api/journal/months") return sendJson(res, 200, { months: await journal.listMonths() }, cors);

    if (route === "/api/journal/export") {
      const format = url.searchParams.get("format") ?? "md";
      const hidden = url.searchParams.get("hidden") ?? "0";
      if (format !== "md" && format !== "txt") throw fail(400, 'The format should be "md" or "txt".', "invalid");
      if (hidden !== "0" && hidden !== "1") throw fail(400, "hidden should be 0 or 1.", "invalid");
      const opts = { includeHidden: hidden === "1" };
      const text = format === "md" ? await journal.exportMarkdown(opts) : await journal.exportText(opts);
      const name = `empathy-journal-${new Date(now()).toISOString().slice(0, 10)}.${format}`;
      const buf = Buffer.from(text, "utf8");
      res.writeHead(200, { "content-type": `${format === "md" ? "text/markdown" : "text/plain"}; charset=utf-8`, "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-length": buf.length, ...cors });
      return res.end(buf);
    }

    if (route === "/api/journal/hide" || route === "/api/journal/unhide") {
      if (typeof body.id !== "string") throw fail(400, "Send the entry's id.", "invalid");
      const hint = { month: typeof body.month === "string" ? body.month : undefined }; // optional: the month it was loaded from
      const r = route.endsWith("/unhide") ? await journal.unhide(body.id, hint) : await journal.hide(body.id, hint);
      return sendJson(res, 200, { ok: true, ...r }, cors);
    }
    if (route === "/api/journal/retry") {
      const r = await journal.append(body.entry);
      return sendJson(res, 200, { saved: true, entryId: r.entryId, duplicate: r.duplicate }, cors);
    }
    if (route === "/api/journal/import") {
      return sendJson(res, 200, { ok: true, ...(await journal.importLegacy(body.entries)) }, cors);
    }
    // /api/journal/delete-all
    const r = await journal.deleteAll(body.confirm ?? body.phrase);
    return sendJson(res, 200, { ok: true, ...r }, cors);
  }
}
