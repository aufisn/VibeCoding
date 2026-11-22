// The one place that talks to Claude (official SDK only). Used by server.mjs and ci/run-request.mjs.
// Two calls run in parallel for each diary entry (see the spike note in diary-core.js):
//   1. the reflection (structured output, no tools), and
//   2. the quote call (web search, max 2 searches, plain answer with citations).
// A failed quote call never fails the reflection: the answer just carries quote_error.

import { createRequire } from "node:module";
import Anthropic from "@anthropic-ai/sdk";

const require = createRequire(import.meta.url);
const Core = require("./diary-core.js");

const QUOTE_TIMEOUT_MS = 45_000;

/**
 * The real Claude client. `client` can be a fake in tests.
 * reflect(body) returns the reflection API message, plus `quote_message` (the quote call's API message)
 * or `quote_error` (a short code) when the quote call was made. Core.parseResult reads both.
 */
export function createClaude({ apiKey, workspaceId, ci = false, client } = {}) {
  const defaultHeaders = workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined;
  client ??= new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000, defaultHeaders });

  async function quote(text) {
    try {
      return { quote_message: await client.messages.create(Core.buildQuoteRequestBody(text), { timeout: QUOTE_TIMEOUT_MS, maxRetries: 1 }) };
    } catch (err) {
      // Search not enabled, overloaded, timeout...: the reflection still goes out. Status only, never the key.
      return { quote_error: `http_${err?.status ?? 0}` };
    }
  }

  return {
    async reflect(body) {
      const text = Core.entryFromBody(body);
      const quoted = text ? quote(text) : Promise.resolve({});
      try {
        // No server-side fallback: it can retry a refused request on another
        // model (Sonnet 5), and this study allows Sonnet 5.5 at most.
        const message = await client.messages.create(body);
        return { ...message, ...(await quoted) };
      } catch (err) {
        await quoted;
        const status = err?.status ?? 0;
        const e = new Error(Core.describeError(status, JSON.stringify(err?.error ?? {}), { server: !ci, ci }));
        e.status = status === 0 || status >= 500 ? 502 : status;
        throw e;
      }
    },
  };
}
