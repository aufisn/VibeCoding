// A fake GitHub Gist for tests (no network): GET with ETag and 304, a version list, PATCH,
// truncation of big files with a raw_url, and hooks to simulate other writers or failures.
import { createHash } from "node:crypto";

export const GIST_ID = "f".repeat(32);
export const GIST_TOKEN = "ghp_" + "a".repeat(36);

/**
 * @param {{ truncateAbove?: number, files?: object }} opts  files bigger than truncateAbove chars come back
 *   `truncated` with only the first part as content, and the rest at raw_url (like GitHub's 1 MB rule)
 */
export function createFakeGist({ truncateAbove = 1_000_000, files = {} } = {}) {
  const gist = {
    files, // name -> text
    calls: { get: 0, patch: 0, raw: 0, commits: 0 },
    patches: [], // names of the files each PATCH touched
    failPatch: 0, // status to answer PATCH with (0 = fine)
    failGet: 0,
    failWhen: null, // (changes) => status | 0, to fail only some PATCHes (e.g. the ones touching journal files)
    beforePatch: null, // async (changes) => void, runs before a PATCH is applied (another writer got in)
    afterPatch: null, // async (changes) => void, runs after a PATCH was applied (another writer overwrote it)
    listTruncated: false,
    onCommits: null, // (callNumber) => void|Promise, runs when the version is asked for (a writer slips in)
  };
  const version = () => createHash("sha1").update(JSON.stringify(Object.entries(gist.files).sort())).digest("hex").slice(0, 12);
  const reply = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

  gist.fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    if (url.startsWith("https://raw.example.test/")) {
      gist.calls.raw++;
      const name = decodeURIComponent(url.split("/").pop());
      return name in gist.files ? reply(200, gist.files[name]) : reply(404, "");
    }
    if (!url.startsWith(`https://api.github.com/gists/${GIST_ID}`)) return reply(404, {});
    if (init.headers?.Authorization !== `Bearer ${GIST_TOKEN}`) return reply(401, {});
    if (url.endsWith("/commits?per_page=1")) {
      gist.calls.commits++;
      if (gist.onCommits) await gist.onCommits(gist.calls.commits);
      return reply(200, [{ version: version() }]);
    }
    if (method === "PATCH") {
      gist.calls.patch++;
      const changes = JSON.parse(init.body).files;
      gist.patches.push(Object.keys(changes));
      if (gist.beforePatch) await gist.beforePatch(changes);
      const failing = gist.failPatch || gist.failWhen?.(changes) || 0;
      if (failing) return reply(failing, {});
      for (const [name, v] of Object.entries(changes)) {
        if (v === null) delete gist.files[name];
        else gist.files[name] = v.content;
      }
      if (gist.afterPatch) await gist.afterPatch(changes);
      return reply(200, {});
    }
    gist.calls.get++;
    if (gist.failGet) return reply(gist.failGet, {});
    const etag = `"${version()}"`;
    if (init.headers?.["If-None-Match"] === etag) return reply(304, undefined, { etag });
    const out = {};
    for (const [name, text] of Object.entries(gist.files)) {
      out[name] = text.length > truncateAbove
        ? { content: text.slice(0, truncateAbove), truncated: true, raw_url: `https://raw.example.test/${encodeURIComponent(name)}` }
        : { content: text, truncated: false };
    }
    return reply(200, { files: out, truncated: gist.listTruncated }, { etag });
  };
  return gist;
}

/** A passthrough fetch that counts nothing and fails like a lost connection. */
export const offlineFetch = async () => {
  throw new TypeError("fetch failed");
};

export const GOOD_RESULT = {
  primary_emotion: "joy",
  emotions: [{ id: "joy", intensity: 4 }],
  mood_score: 9,
  summary: "Happy day",
  empathy: "That sounds lovely.",
  comfort: "Enjoy it.",
  gentle_step: "",
  concern: "none",
  language: "en",
};

export const GOOD_QUOTE = { text: "This too shall pass.", author: "Persian proverb", source: "Folk saying", url: "https://example.org/quote", translation: null, language: "en" };

/** A valid journal entry. */
export function makeEntry(over = {}) {
  const n = Math.random().toString(16).slice(2, 10);
  return { id: `e-${n}-abcd1234`, createdAt: "2026-11-22T10:00:00.000Z", mode: "local", text: "A quiet walk after work", interpretation: { ...GOOD_RESULT }, quote: null, quote_status: "none", usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0.001 }, ...over };
}
