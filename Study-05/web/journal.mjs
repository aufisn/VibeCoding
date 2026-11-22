// The Empathy Diary journal: encrypted monthly files in the user's secret Gist.
// One module for the browser (GitHub mode), the local server and the GitHub job.
//
// ---------------------------------------------------------------------------
// FUNCTION LIST (for the frontend)
// ---------------------------------------------------------------------------
//   const journal = createJournal({ gist, passphrase, sleep?, random?, now?, maxFileBytes?, attempts? })
//     gist        a client from createGistClient() in mailbox.mjs
//     passphrase  the user's passphrase (never stored here)
//
//   await journal.listMonths()          -> [{ month: "2026-11", files: ["journal-2026-11.enc"] }]   newest first, names only, nothing decrypted
//   await journal.readLatest(n = 2)     -> { entries, months, allMonths, problems }   only the newest n months are decrypted
//   await journal.readMonth("2026-11")  -> same shape, that month only
//   await journal.readAll()             -> same shape, every month (slow with many months: use for export only)
//        entries   newest first; each is an Entry (below) plus `hidden: boolean`
//        months    [{ month, files, entries }]  the months that were loaded (readable entries per month)
//        allMonths [{ month, files }]  every month in the Gist, newest first (so the page can offer "load older")
//        problems  [{ file, kind: "damaged" | "version" | "passphrase" | "list", message }]
//                  A bad file never hides the other months and is never overwritten.
//                  "version" = saved by a newer version of the app (not damaged).
//        Throws JournalError("passphrase") when EVERY journal file that was read fails to decrypt.
//   await journal.append(entry)         -> { saved: true, entryId, duplicate: boolean }   reads/writes only the entry's month
//   await journal.hide(id, { month? })  -> { changed: boolean }   finds the entry newest months first (month = optional hint)
//   await journal.unhide(id, { month? })-> { changed: boolean }
//   await journal.deleteAll("DELETE MY JOURNAL") -> { deleted: <number of files> }  (any other phrase: JournalError "confirm")
//   await journal.importLegacy(entries) -> { added, skipped, invalid, addedIds, skippedIds, invalidIds, duplicateIds, invalidIndexes }
//        The id lists hold the ORIGINAL ids as sent (no "legacy-" prefix). Nothing usable is ever dropped silently.
//   await journal.exportMarkdown({ includeHidden: false }) -> string
//   await journal.exportText({ includeHidden: false })     -> string
//   There is no function that deletes a single entry (the user's decision).
//
//   Entry = {
//     id,            // stable, 6-64 chars [A-Za-z0-9_.-]
//     createdAt,     // ISO string, UTC (it decides the month file)
//     mode,          // "github" | "local"
//     text,          // what the user wrote
//     interpretation: { primary_emotion, emotions: [{id, intensity}], mood_score, summary, empathy, comfort, gentle_step, concern, language },
//     quote,         // null or { text, author, source, url (https only), translation, language }
//     quote_status,  // string or null
//     usage,         // null or { input_tokens, output_tokens, cost_usd, ... }
//   }
//
//   Pure helpers (also exported): validateEntry, validateQuote, validateMonthData, monthOf, fileName,
//   parseFileName, legacyToEntry, entryFromResult, renderMarkdown, renderText, newEntryId, DELETE_PHRASE.
//
//   Errors are JournalError with `.code` ("passphrase", "damaged", "gist", "conflict", "invalid",
//   "notfound", "confirm") and a plain `.message` that never contains a token or the passphrase.
//
// STORAGE RULES
//   * File names: journal-YYYY-MM.enc; when a month passes ~800 KB, journal-YYYY-MM-2.enc, -3, ...
//     GitHub's Gist API returns at most 1 MB of a file's content and marks bigger files `truncated`
//     (then raw_url has the whole file, up to 10 MB); the file list itself stops at 300 files.
//     800 KB keeps every file well inside the 1 MB inline limit. mailbox.mjs follows raw_url anyway.
//   * Each file is an fc-crypto.mjs envelope of { v: 1, entries: [...], hidden: ["<id>", ...] }.
//   * Gists have no conditional write, so every change is: read, merge by id, write, read back,
//     and if the change is missing (another writer overwrote it) wait 0.5-2 s and start again,
//     up to 4 times. Before writing, the Gist's version is checked again to catch a writer
//     that got in between.
//   * A file that can't be read is never overwritten. Entries a newer app version wrote are kept
//     as they are when a file is rewritten.

import { decryptJson, encryptJson } from "./fc-crypto.mjs";
import { newRequestId } from "./mailbox.mjs";

export const DELETE_PHRASE = "DELETE MY JOURNAL";
export const FILE_SOFT_LIMIT = 800_000;
export const MAX_ATTEMPTS = 4;
export const MAX_IMPORT = 500;
const FILE_RE = /^journal-(\d{4})-(0[1-9]|1[0-2])(?:-([2-9]|[1-9]\d))?\.enc$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{5,63}$/;
const CONCERNS = ["none", "possible", "urgent"];
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export const newEntryId = newRequestId;

const STATUS = { passphrase: 422, damaged: 422, version: 422, gist: 502, conflict: 503, invalid: 400, notfound: 404, confirm: 400, not_configured: 503 };

export class JournalError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "JournalError";
    this.code = code;
    this.status = STATUS[code] ?? 500;
    Object.assign(this, extra);
  }
}

/* ---------- File names ---------- */

/** "YYYY-MM" (UTC) of an ISO date string. */
export const monthOf = (createdAt) => new Date(createdAt).toISOString().slice(0, 7);
export const isMonth = (m) => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
export const fileName = (month, part = 1) => (part <= 1 ? `journal-${month}.enc` : `journal-${month}-${part}.enc`);

/** { month, part } for a journal file name, else null. */
export function parseFileName(name) {
  const m = FILE_RE.exec(name);
  return m ? { month: `${m[1]}-${m[2]}`, part: m[3] ? Number(m[3]) : 1 } : null;
}

/* ---------- Validation (everything read from the Gist or a request is checked) ---------- */

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** A quote object, or null if it isn't one of the allowed shape. https-only URL, capped lengths. */
export function validateQuote(raw) {
  if (!isObject(raw)) return null;
  const text = str(raw.text, 600);
  const author = str(raw.author, 200);
  if (!text || !author) return null;
  let url = "";
  try {
    const u = new URL(str(raw.url, 500));
    if (u.protocol !== "https:" || u.username || u.password) return null;
    url = u.href;
  } catch {
    return null;
  }
  const lang = str(raw.language, 20);
  return {
    text,
    author,
    source: str(raw.source, 300),
    url,
    translation: str(raw.translation, 800) || null,
    language: LANG_RE.test(lang) ? lang : null,
  };
}

function validateInterpretation(raw) {
  if (!isObject(raw)) return null;
  const primary = str(raw.primary_emotion, 40);
  if (!primary) return null;
  const emotions = [];
  for (const e of Array.isArray(raw.emotions) ? raw.emotions : []) {
    const id = isObject(e) ? str(e.id, 40) : "";
    const n = isObject(e) ? Math.round(Number(e.intensity)) : NaN;
    if (id && Number.isFinite(n) && emotions.length < 5) emotions.push({ id, intensity: Math.min(5, Math.max(1, n)) });
  }
  const mood = Math.round(Number(raw.mood_score));
  const lang = str(raw.language, 20);
  return {
    primary_emotion: primary,
    emotions,
    mood_score: Number.isFinite(mood) ? Math.min(10, Math.max(1, mood)) : 5,
    summary: str(raw.summary, 400),
    empathy: str(raw.empathy, 1600),
    comfort: str(raw.comfort, 800),
    gentle_step: str(raw.gentle_step, 600),
    concern: CONCERNS.includes(raw.concern) ? raw.concern : "none",
    language: LANG_RE.test(lang) ? lang : "en",
  };
}

function validateUsage(raw) {
  if (!isObject(raw)) return null;
  const out = {};
  for (const [k, v] of Object.entries(raw).slice(0, 12)) {
    if (/^[a-z_]{1,30}$/.test(k) && typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9) out[k] = v;
  }
  return out;
}

/** A clean Entry, or null when `raw` isn't a usable entry. Unknown fields are dropped. */
export function validateEntry(raw) {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
  if (typeof raw.createdAt !== "string" || raw.createdAt.length > 40) return null;
  const t = Date.parse(raw.createdAt);
  if (!Number.isFinite(t) || t < Date.UTC(2000, 0, 1) || t > Date.UTC(2999, 11, 31)) return null;
  if (raw.mode !== "github" && raw.mode !== "local") return null;
  if (typeof raw.text !== "string") return null;
  const text = raw.text.trim();
  if (!text || text.length > 2000) return null;
  const interpretation = validateInterpretation(raw.interpretation);
  if (!interpretation) return null;
  return {
    id: raw.id,
    createdAt: new Date(t).toISOString(),
    mode: raw.mode,
    text,
    interpretation,
    quote: validateQuote(raw.quote),
    quote_status: str(raw.quote_status, 60) || null,
    usage: validateUsage(raw.usage),
    ...(raw.importedAt === true ? { importedAt: true } : {}),
  };
}

/**
 * A decrypted month file → { raw: [...every entry as stored], entries: [valid entries], hidden: [ids] }.
 * Returns { error: "version" | "damaged" } when the file can't be used at all.
 */
export function validateMonthData(data) {
  if (!isObject(data) || !Array.isArray(data.entries)) return { error: "damaged" };
  if (data.v !== 1) return { error: typeof data.v === "number" && data.v > 1 ? "version" : "damaged" };
  const seen = new Set();
  const entries = [];
  for (const raw of data.entries) {
    const e = validateEntry(raw);
    if (e && !seen.has(e.id)) {
      seen.add(e.id);
      entries.push(e);
    }
  }
  const hidden = [...new Set((Array.isArray(data.hidden) ? data.hidden : []).filter((h) => typeof h === "string" && ID_RE.test(h)))];
  return { raw: data.entries.filter((r) => r !== null && typeof r === "object"), entries, hidden };
}

// Same ids as diary-core.js (that file is CommonJS and can't be imported here; keep the two in sync).
const EMOTION_IDS = ["joy", "gratitude", "calm", "pride", "hope", "love", "sadness", "anxiety", "anger", "frustration", "tiredness", "loneliness", "overwhelm", "confusion", "mixed"];
const emotionId = (v) => (typeof v === "string" && EMOTION_IDS.includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : "mixed");

/** The id of an old entry as the page sent it (a string or a number), or null when there is none. */
export function legacyId(raw) {
  if (!isObject(raw)) return null;
  if (typeof raw.id === "string" && raw.id.trim()) return raw.id;
  if (typeof raw.id === "number" && Number.isFinite(raw.id)) return raw.id;
  return null;
}

const shortHash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").slice(0, 6);
};

/** The stable journal id for an old entry id: "legacy-<id>", with a short hash when characters had to be replaced or cut. */
export function legacyEntryId(original) {
  const src = String(original).trim();
  const clean = src.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 40);
  return `legacy-${clean}${clean === src ? "" : `-${shortHash(src)}`}`;
}

function lenientInterpretation(raw) {
  const src = isObject(raw) ? raw : {};
  const emotions = [];
  for (const e of Array.isArray(src.emotions) ? src.emotions : []) {
    if (!isObject(e) || emotions.length >= 5) continue;
    const n = Math.round(Number(e.intensity));
    emotions.push({ id: emotionId(e.id), intensity: Number.isFinite(n) ? n : 3 });
  }
  const first = typeof src.primary_emotion === "string" && src.primary_emotion.trim() ? src.primary_emotion : emotions[0]?.id;
  return { ...src, primary_emotion: emotionId(first), emotions };
}

/** A timestamp (ms number, seconds number, or date string) → ms, or NaN. */
function legacyTime(v) {
  const t = typeof v === "number" ? (v < 1e11 ? v * 1000 : v) : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) && t >= Date.UTC(2000, 0, 1) && t <= Date.UTC(2999, 11, 31) ? t : NaN;
}

/**
 * Old browser-history entry { id, ts, text, result } (or a new-style entry) → Entry, or null when truly unusable
 * (no id or no text). As lenient as is safe: an unknown emotion becomes "mixed", `ts` may be ms, seconds or an ISO
 * string, and a missing or nonsense time uses `importTime` (ms) with `importedAt: true`. Stable id.
 */
export function legacyToEntry(raw, defaultMode = "local", importTime = Date.now()) {
  const original = legacyId(raw);
  if (original === null) return null;
  const newStyle = isObject(raw.interpretation);
  const id = newStyle && typeof raw.id === "string" && ID_RE.test(raw.id) ? raw.id : legacyEntryId(original);
  let t = legacyTime(raw.createdAt ?? raw.ts);
  const importedAt = Number.isNaN(t);
  if (importedAt) t = importTime;
  let interpretation;
  let quote;
  let quoteStatus;
  let usage;
  if (newStyle) {
    ({ quote, quote_status: quoteStatus, usage } = raw);
    interpretation = raw.interpretation;
  } else {
    ({ usage, quote, quote_status: quoteStatus, ...interpretation } = isObject(raw.result) ? raw.result : {});
  }
  return validateEntry({
    id,
    createdAt: new Date(t).toISOString(),
    mode: raw.mode === "github" || raw.mode === "local" ? raw.mode : defaultMode,
    text: typeof raw.text === "string" ? raw.text.slice(0, 2000) : raw.text,
    interpretation: lenientInterpretation(interpretation),
    quote,
    quote_status: quoteStatus,
    usage,
    ...(importedAt ? { importedAt: true } : {}),
  });
}

/** The journal entry for a finished reflection. Stores whatever the result holds (quote, quote_status, usage). */
export function entryFromResult({ id, text, result, createdAt, mode }) {
  const { quote = null, quote_status = null, usage = null, ...interpretation } = result;
  return { id, createdAt, mode, text, interpretation, quote, quote_status, usage };
}

/* ---------- Export ---------- */

const when = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const byTime = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1);
/** A URL safe inside Markdown: wrapped in <...>, with ( ) [ ] < > and whitespace percent-encoded. */
const mdUrl = (u) => `<${String(u).replace(/[()[\]<>\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)}>`;
const quoted = (s) => String(s).split(/\r?\n/).map((l) => `> ${l}`).join("\n");

/** Markdown for `entries` (oldest first). Hidden ones only when includeHidden. Pure. */
export function renderMarkdown(entries, { includeHidden = false, exportedAt = new Date() } = {}) {
  const list = entries.filter((e) => includeHidden || !e.hidden).sort(byTime);
  const out = ["# My Empathy Diary journal", "", `Exported ${exportedAt.toISOString().slice(0, 10)} - ${list.length} ${list.length === 1 ? "entry" : "entries"}`, "", "Times are UTC. Entries are listed oldest first.", ""];
  let month = "";
  for (const e of list) {
    if (e.createdAt.slice(0, 7) !== month) {
      month = e.createdAt.slice(0, 7);
      out.push(`## ${month}`, "");
    }
    const i = e.interpretation;
    out.push(`### ${when(e.createdAt)}${e.hidden ? " (hidden)" : ""}`, "", quoted(e.text), "");
    out.push(`- Feeling: ${i.primary_emotion}${i.emotions.length ? ` (${i.emotions.map((x) => `${x.id} ${x.intensity}/5`).join(", ")})` : ""}, mood ${i.mood_score}/10`);
    if (i.summary) out.push(`- Summary: ${i.summary}`);
    out.push("", i.empathy);
    if (i.comfort) out.push("", i.comfort);
    if (i.gentle_step) out.push("", `Gentle step: ${i.gentle_step}`);
    if (e.quote) {
      out.push("", quoted(e.quote.text), `> - ${e.quote.author}${e.quote.source ? `, ${e.quote.source}` : ""}: ${mdUrl(e.quote.url)}`);
      if (e.quote.translation) out.push(">", `> Translation (by Claude, not the author's words): ${e.quote.translation}`);
    }
    out.push("");
  }
  return out.join("\n");
}

/** Plain text for `entries` (oldest first). Pure. */
export function renderText(entries, { includeHidden = false, exportedAt = new Date() } = {}) {
  const list = entries.filter((e) => includeHidden || !e.hidden).sort(byTime);
  const out = [`My Empathy Diary journal`, `Exported ${exportedAt.toISOString().slice(0, 10)} - ${list.length} ${list.length === 1 ? "entry" : "entries"}`, "Times are UTC. Entries are listed oldest first.", ""];
  for (const e of list) {
    const i = e.interpretation;
    out.push(`${when(e.createdAt)}${e.hidden ? " (hidden)" : ""}`, e.text, `Feeling: ${i.primary_emotion}, mood ${i.mood_score}/10`, i.empathy);
    if (i.comfort) out.push(i.comfort);
    if (i.gentle_step) out.push(`Gentle step: ${i.gentle_step}`);
    if (e.quote) out.push(`Quote: "${e.quote.text}" - ${e.quote.author}${e.quote.source ? `, ${e.quote.source}` : ""} (${e.quote.url})`);
    out.push("", "----", "");
  }
  return out.join("\n");
}

/* ---------- The journal ---------- */

const PASSPHRASE_MSG = "That passphrase can't open your journal. Check Settings.";
const damagedMsg = (file) => `This month could not be read (${file}). It was left as it is.`;
const versionMsg = "This month was saved by a newer version of the app; update the page to open it.";
const problemMsg = (kind, file) => (kind === "passphrase" ? PASSPHRASE_MSG : kind === "version" ? versionMsg : damagedMsg(file));
const LIST_MSG = "The Gist has too many files to list (GitHub shows at most 300), so some journal months may be missing.";
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const estimate = (list) => Math.ceil((JSON.stringify(list).length * 4) / 3) + 400; // base64 of the JSON, plus the envelope
const newestFirst = (a, b) => (a.month < b.month ? 1 : -1);

/** Gist errors become JournalErrors (plain message, no token). */
async function io(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof JournalError) throw err;
    if (err?.name === "GitHubError") throw new JournalError("gist", `Could not reach your journal (${err.message})`, { gistStatus: err.status });
    throw new JournalError("gist", "Could not reach your journal (the Gist could not be read or written).", { gistStatus: 0 });
  }
}

/** The month an entry id was made in, guessed from its time-based id, or null. */
function monthGuess(id) {
  const m = /^([0-9a-z]{6,12})-[0-9a-f]{8}$/.exec(id);
  const t = m ? parseInt(m[1], 36) : NaN;
  return Number.isFinite(t) && t > Date.UTC(2000, 0, 1) && t < Date.UTC(2999, 11, 31) ? new Date(t).toISOString().slice(0, 7) : null;
}

export function createJournal({ gist, passphrase, sleep = defaultSleep, random = Math.random, now = () => Date.now(), maxFileBytes = FILE_SOFT_LIMIT, attempts = MAX_ATTEMPTS } = {}) {
  if (!gist) throw new Error("A Gist client is required.");
  if (typeof passphrase !== "string" || !passphrase) throw new JournalError("passphrase", "The passphrase is missing. Add it in Settings.");

  /**
   * A state: the Gist's file names grouped by month (cheap, nothing decrypted) and the months
   * decrypted so far (`parts`). Months are decrypted only when asked for (loadMonths).
   */
  async function openState() {
    const files = await io(() => gist.files());
    const byMonth = new Map();
    for (const name of Object.keys(files).sort()) {
      const id = parseFileName(name);
      if (id) byMonth.set(id.month, [...(byMonth.get(id.month) ?? []), name]);
    }
    const problems = gist.listTruncated ? [{ file: "", kind: "list", message: LIST_MSG }] : [];
    return { files, byMonth, parts: new Map(), problems, loaded: new Set() };
  }

  const monthList = (state) => [...state.byMonth.keys()].sort().reverse();
  const allMonthsOf = (state) => monthList(state).map((month) => ({ month, files: state.byMonth.get(month) }));

  async function readPart(state, name) {
    const id = parseFileName(name);
    const text = await io(() => gist.text(state.files[name]));
    const part = { name, ...id, size: text.length, status: "ok", raw: [], entries: [], hidden: [] };
    let data;
    try {
      data = await decryptJson(text, passphrase);
    } catch (err) {
      part.status = /Couldn't decrypt/.test(err?.message ?? "") ? "passphrase" : "damaged";
    }
    if (part.status === "ok") {
      const v = validateMonthData(data);
      if (v.error) part.status = v.error;
      else Object.assign(part, v);
    }
    return part;
  }

  /** Reads and decrypts the files of these months (those not loaded yet). */
  async function loadMonths(state, months) {
    const names = [];
    for (const m of months) {
      if (state.loaded.has(m) || !state.byMonth.has(m)) continue;
      state.loaded.add(m);
      names.push(...state.byMonth.get(m));
    }
    const parts = await Promise.all(names.map((n) => readPart(state, n)));
    for (const part of parts) {
      state.parts.set(part.name, part);
      if (part.status !== "ok") state.problems.push({ file: part.name, kind: part.status, message: problemMsg(part.status, part.name) });
    }
    const all = [...state.parts.values()];
    if (all.length && all.every((p) => p.status === "passphrase")) throw new JournalError("passphrase", PASSPHRASE_MSG);
  }

  /**
   * Before writing into a month that has no file yet, make sure the passphrase is the right one
   * (decrypt the newest existing month: a wrong passphrase throws and nothing is written).
   */
  async function checkKey(state) {
    if (!state.parts.size && state.byMonth.size) await loadMonths(state, monthList(state).slice(0, 1));
  }

  /** The views of what is loaded: entries (deduped, with `hidden`), loaded months, every month, problems. */
  function view(state) {
    const hidden = new Set();
    for (const p of state.parts.values()) for (const h of p.hidden) hidden.add(h);
    const seen = new Set();
    const entries = [];
    const months = new Map();
    for (const p of [...state.parts.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (p.status !== "ok") continue;
      const m = months.get(p.month) ?? { month: p.month, files: [], entries: 0 };
      m.files.push(p.name);
      months.set(p.month, m);
      for (const e of p.entries) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        m.entries++;
        entries.push({ ...e, hidden: hidden.has(e.id) });
      }
    }
    entries.sort((a, b) => -byTime(a, b));
    return { entries, months: [...months.values()].sort(newestFirst), allMonths: allMonthsOf(state), problems: [...state.problems].sort((a, b) => (a.file < b.file ? -1 : 1)) };
  }

  /** The loaded file of `month` that holds an entry id, or undefined. */
  const holderIn = (state, id, month) => [...state.parts.values()].find((p) => p.month === month && p.status === "ok" && p.entries.some((e) => e.id === id));

  /** Finds which month holds an id, loading as few months as possible: the hinted/guessed month first, then newest first. */
  async function locate(state, id, hint) {
    const first = isMonth(hint) && state.byMonth.has(hint) ? hint : monthGuess(id);
    const order = [first, ...monthList(state)].filter((m, i, a) => m && a.indexOf(m) === i);
    for (const month of order) {
      await loadMonths(state, [month]);
      const p = holderIn(state, id, month);
      if (p) return p;
    }
    return null;
  }

  /**
   * One change: read, plan, write, read back, retry. `plan(state)` loads what it needs and returns
   * { changes: { file: dataObject | null }, months: [months it touches] } or null when there is nothing to do;
   * `verify(after, plan)` says whether the change is really in the Gist (only `months` are re-read).
   */
  async function mutate(plan, verify) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const v0 = await io(() => gist.version?.()).catch(() => null);
        const state = await openState();
        const p = await plan(state);
        if (!p || !Object.keys(p.changes).length) return { changed: false, state };
        const payload = {};
        for (const [name, data] of Object.entries(p.changes)) payload[name] = data === null ? null : await encryptJson(data, passphrase);
        const v1 = await io(() => gist.version?.()).catch(() => null);
        if (v0 && v1 && v0 !== v1) {
          // Someone else wrote since we read: start over with the new state (no write now).
          lastError = new JournalError("conflict", "Your journal changed while saving, and it could not be saved after several tries. Try again.");
        } else {
          await io(() => gist.write(payload));
          const after = await openState();
          await loadMonths(after, p.months);
          if (verify(after, p)) return { changed: true, state: after, plan: p };
          lastError = new JournalError("conflict", "Another device wrote to your journal at the same moment, and the entry could not be saved after several tries. Try saving again.");
        }
      } catch (err) {
        if (!(err instanceof JournalError) || err.code !== "gist" || (err.gistStatus > 0 && err.gistStatus < 500)) throw err;
        lastError = err; // network trouble or a GitHub 5xx: worth another try
      }
      if (attempt < attempts) await sleep(500 + Math.floor(random() * 1500));
    }
    throw lastError ?? new JournalError("conflict", "The journal could not be saved.");
  }

  /** Puts new entries into the right month files (rolling over to -2, -3 ... past the size limit). The months must be loaded. */
  function place(state, newEntries) {
    if (state.problems.some((p) => p.kind === "list")) throw new JournalError("gist", "Your Gist has too many files for GitHub to list, so the journal can't be saved safely. Delete old files from the Gist and try again.", { gistStatus: 422 });
    const changes = {};
    const byMonth = new Map();
    for (const e of newEntries) byMonth.set(monthOf(e.createdAt), [...(byMonth.get(monthOf(e.createdAt)) ?? []), e]);
    for (const [month, list] of byMonth) {
      const existing = [...state.parts.values()].filter((p) => p.month === month).sort((a, b) => a.part - b.part);
      const last = existing.at(-1);
      const bad = existing.find((p) => p.status !== "ok");
      if (bad) throw new JournalError(bad.status === "version" ? "version" : bad.status === "passphrase" ? "passphrase" : "damaged", problemMsg(bad.status, bad.name), { file: bad.name });
      let number = last?.part ?? 1;
      let current = last ? { raw: [...last.raw], hidden: [...last.hidden] } : { raw: [], hidden: [] };
      for (const e of list) {
        if (current.raw.length && estimate([...current.raw, e]) > maxFileBytes) {
          changes[fileName(month, number)] = { v: 1, entries: current.raw, hidden: current.hidden };
          number++;
          current = { raw: [], hidden: [] };
        }
        current.raw.push(e);
      }
      changes[fileName(month, number)] = { v: 1, entries: current.raw, hidden: current.hidden };
    }
    return changes;
  }

  const hasIds = (state, ids) => {
    const present = new Set();
    for (const p of state.parts.values()) if (p.status === "ok") for (const e of p.entries) present.add(e.id);
    return ids.every((id) => present.has(id));
  };

  async function setHidden(id, hide, hint) {
    if (typeof id !== "string" || !ID_RE.test(id)) throw new JournalError("invalid", "That entry ID isn't valid.");
    const r = await mutate(
      async (state) => {
        const p = await locate(state, id, hint);
        if (!p) throw new JournalError("notfound", "That entry isn't in your journal.");
        const inMonth = [...state.parts.values()].filter((q) => q.status === "ok" && q.month === p.month);
        const changes = {};
        if (hide) {
          if (inMonth.some((q) => q.hidden.includes(id))) return null;
          changes[p.name] = { v: 1, entries: p.raw, hidden: [...p.hidden, id] };
        } else {
          for (const q of inMonth) if (q.hidden.includes(id)) changes[q.name] = { v: 1, entries: q.raw, hidden: q.hidden.filter((h) => h !== id) };
        }
        return Object.keys(changes).length ? { changes, months: [p.month] } : null;
      },
      (after, p) => [...after.parts.values()].some((q) => q.hidden.includes(id)) === hide,
    );
    return { changed: r.changed };
  }

  const uniq = (list) => [...new Set(list)];

  return {
    /** Month names and their files, newest first. Nothing is decrypted. */
    async listMonths() {
      return allMonthsOf(await openState());
    },

    /** Everything, decrypted. Slow with many months: for export only. */
    async readAll() {
      const state = await openState();
      await loadMonths(state, monthList(state));
      return view(state);
    },

    /** The newest `n` months. */
    async readLatest(n = 2) {
      const count = Number.isInteger(n) && n > 0 ? n : 2;
      const state = await openState();
      await loadMonths(state, monthList(state).slice(0, count));
      return view(state);
    },

    async readMonth(month) {
      if (!isMonth(month)) throw new JournalError("invalid", "The month should look like 2026-11.");
      const state = await openState();
      await loadMonths(state, [month]);
      return view(state);
    },

    async append(entry) {
      const e = validateEntry(entry);
      if (!e) throw new JournalError("invalid", "This entry can't be saved: it is missing something or has an unexpected shape.");
      const month = monthOf(e.createdAt);
      const r = await mutate(
        async (state) => {
          await loadMonths(state, [month]);
          if (hasIds(state, [e.id])) return null; // already there: a retry never duplicates
          await checkKey(state);
          return { changes: place(state, [e]), months: [month] };
        },
        (after) => hasIds(after, [e.id]),
      );
      return { saved: true, entryId: e.id, duplicate: !r.changed };
    },

    hide: (id, { month } = {}) => setHidden(id, true, month),
    unhide: (id, { month } = {}) => setHidden(id, false, month),

    async deleteAll(confirmPhrase) {
      if (confirmPhrase !== DELETE_PHRASE) throw new JournalError("confirm", `To delete your whole journal, type exactly: ${DELETE_PHRASE}`);
      const names = Object.keys(await io(() => gist.files())).filter((n) => parseFileName(n));
      if (!names.length) return { deleted: 0 };
      await io(() => gist.write(Object.fromEntries(names.map((n) => [n, null]))));
      const left = Object.keys(await io(() => gist.files())).filter((n) => parseFileName(n));
      if (left.length) throw new JournalError("gist", "Some journal files could not be removed. Try again.");
      return { deleted: names.length };
    },

    /**
     * Moves old entries in. Never loses data: every input entry ends up in exactly one of
     * addedIds, skippedIds (already there, or a repeat within the batch) or invalid (no usable id or no text).
     * The id lists hold the ORIGINAL ids as sent. invalidIndexes are positions in the sent list.
     */
    async importLegacy(entries) {
      if (!Array.isArray(entries)) throw new JournalError("invalid", "Send a list of entries to import.");
      if (entries.length > MAX_IMPORT) throw new JournalError("invalid", `Import at most ${MAX_IMPORT} entries at a time.`);
      const importTime = now();
      const converted = new Map(); // entry id -> { entry, original }
      const invalidIds = [];
      const invalidIndexes = [];
      const duplicateIds = [];
      let invalid = 0;
      let skipped = 0;
      entries.forEach((raw, index) => {
        const e = legacyToEntry(raw, "local", importTime);
        if (!e) {
          invalid++;
          invalidIndexes.push(index);
          const original = legacyId(raw);
          if (original !== null) invalidIds.push(original);
        } else if (converted.has(e.id)) {
          skipped++;
          duplicateIds.push(legacyId(raw) ?? e.id);
        } else converted.set(e.id, { entry: e, original: legacyId(raw) ?? e.id });
      });
      const addedIds = [];
      const skippedIds = [];
      if (converted.size) {
        const list = [...converted.values()];
        const r = await mutate(
          async (state) => {
            await loadMonths(state, monthList(state));
            const fresh = list.filter(({ entry }) => !hasIds(state, [entry.id]));
            if (!fresh.length) return null;
            const ids = fresh.map(({ entry }) => entry.id);
            return { changes: place(state, fresh.map(({ entry }) => entry)), ids, months: uniq(fresh.map(({ entry }) => monthOf(entry.createdAt))) };
          },
          (after, p) => hasIds(after, p.ids),
        );
        const addedSet = new Set(r.changed ? r.plan.ids : []);
        for (const { entry, original } of list) (addedSet.has(entry.id) ? addedIds : skippedIds).push(original);
        skipped += skippedIds.length;
      }
      return { added: addedIds.length, skipped, invalid, addedIds: uniq(addedIds), skippedIds: uniq([...skippedIds, ...duplicateIds]), invalidIds: uniq(invalidIds), duplicateIds: uniq(duplicateIds), invalidIndexes };
    },

    async exportMarkdown({ includeHidden = false } = {}) {
      return renderMarkdown((await this.readAll()).entries, { includeHidden, exportedAt: new Date(now()) });
    },

    async exportText({ includeHidden = false } = {}) {
      return renderText((await this.readAll()).entries, { includeHidden, exportedAt: new Date(now()) });
    },
  };
}
