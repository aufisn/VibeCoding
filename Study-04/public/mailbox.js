// FridgeChef's mailbox: a secret GitHub Gist that carries encrypted requests
// and answers between the web page and the GitHub job. Used by the page
// (browser) and by ci/run-request.mjs (Node).
//
//   req-<id>.enc   the photo, encrypted by the page
//   res-<id>.enc   the ingredients and recipe (or an error), encrypted by the job
//
// The job deletes the request when it answers; the page deletes the answer
// once it has shown it. Anything older than a day is cleaned up by the job.

const API = "https://api.github.com";
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A request ID: the time (base 36), a dash, 8 random hex characters. */
export function newRequestId(now = Date.now()) {
  const rnd = globalThis.crypto.getRandomValues(new Uint8Array(4));
  return `${now.toString(36)}-${[...rnd].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export const isRequestId = (id) => typeof id === "string" && /^[0-9a-z]{6,12}-[0-9a-f]{8}$/.test(id);
export const requestFile = (id) => `req-${id}.enc`;
export const resultFile = (id) => `res-${id}.enc`;

/** When the request was made (ms), from its ID. */
export const requestTime = (id) => parseInt(String(id).split("-")[0], 36);

/** Mailbox files older than `maxAge`, for cleanup. Pure. */
export function staleFiles(names, now = Date.now(), maxAge = MAX_AGE_MS) {
  return names.filter((n) => {
    const m = /^(?:req|res)-(.+)\.enc$/.exec(n);
    return m && isRequestId(m[1]) && now - requestTime(m[1]) > maxAge;
  });
}

/** A plain message for a GitHub API error. Never includes the token. */
export function describeGitHubError(status, what = "GitHub") {
  if (status === 401) return `${what} refused the token: it's wrong or expired. Make a new one and save it in Settings.`;
  if (status === 403) return `${what} says the token isn't allowed to do this (check its permissions), or the hourly limit was reached.`;
  if (status === 404) return `${what} couldn't find it: check the Gist ID or repository, and that the token can see it.`;
  if (status === 422) return `${what} didn't accept the request (is the workflow on the main branch?).`;
  if (status >= 500) return `${what} had a server problem. Try again in a minute.`;
  return `${what} request failed (${status || "no connection"}).`;
}

export class GitHubError extends Error {
  constructor(status, what) {
    super(describeGitHubError(status, what));
    this.name = "GitHubError";
    this.status = status;
  }
}

/** Gist access with a token that has the "gist" scope. */
export function createGistClient({ token, gistId, fetch = globalThis.fetch }) {
  if (!/^[0-9a-f]{20,40}$/i.test(gistId ?? "")) throw new Error("The Gist ID should be 32 letters and numbers (from the Gist's web address).");
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

  async function call(method, body) {
    let res;
    try {
      res = await fetch(`${API}/gists/${gistId}`, { method, headers: body ? { ...headers, "Content-Type": "application/json" } : headers, body: body && JSON.stringify(body), cache: "no-store" });
    } catch {
      throw new GitHubError(0, "The Gist");
    }
    if (!res.ok) throw new GitHubError(res.status, "The Gist");
    return res.json();
  }

  return {
    /** { name: fileObject } for every file in the Gist. */
    async files() {
      return (await call("GET")).files ?? {};
    },
    /** The full text of one file object (big files are fetched from raw_url). */
    async text(file) {
      if (!file.truncated) return file.content;
      const res = await fetch(file.raw_url, { cache: "no-store" });
      if (!res.ok) throw new GitHubError(res.status, "The Gist");
      return res.text();
    },
    /** Writes and/or deletes files: { name: "text" | null }. */
    async write(changes) {
      const files = {};
      for (const [name, text] of Object.entries(changes)) files[name] = text === null ? null : { content: text };
      await call("PATCH", { files });
    },
  };
}
