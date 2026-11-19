// The only code that talks to OpenRouter. The key is held in this closure and
// sent only to openrouter.ai, in the Authorization header. Errors returned to
// callers are short plain messages; they never include the key or the raw
// response headers.

export const API_BASE = "https://openrouter.ai/api/v1";
const TIMEOUT_MS = 60_000;

/** A safe message for an OpenRouter error status. Pure. */
export function describeError(status, body) {
  const meta = body?.error?.metadata ?? {};
  // A free model's shared pool at the provider is full: busy for everyone, not this key.
  if (status === 429 && (meta.limit_source === "upstream_provider_shared_pool" || /rate-limited upstream/i.test(String(meta.raw ?? "")))) {
    return `This free model is busy for everyone right now${meta.provider_name ? ` (${String(meta.provider_name).slice(0, 40)}'s shared limit)` : ""}, not a problem with your key. Try again in a few minutes.`;
  }
  const detail = typeof body?.error?.message === "string" ? body.error.message.slice(0, 200) : "";
  const known = {
    400: "OpenRouter couldn't read the request.",
    401: "OpenRouter refused the API key. Check OPENROUTER_API_KEY in .env, or make a new key at openrouter.ai/keys.",
    402: "The OpenRouter account has no credit left for this model.",
    403: "OpenRouter blocked this request (moderation or key permissions).",
    404: "That model isn't available on OpenRouter. Check the model names in .env.",
    408: "OpenRouter timed out.",
    429: "Too many requests: free models have a rate limit. Wait a minute and try again.",
    502: "The model's provider is down or overloaded. Try again shortly.",
    503: "No provider can run this model right now. Try again shortly.",
  };
  const base = known[status] ?? `OpenRouter answered with error ${status}.`;
  return detail && !detail.includes("sk-or-") ? `${base} (${detail})` : base;
}

export class OpenRouterError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
  }
}

/**
 * @param {{ apiKey: string, fetch?: typeof fetch, appName?: string, appUrl?: string }} options
 */
export function createOpenRouterClient({ apiKey, fetch: doFetch = globalThis.fetch, appName = "FridgeChef", appUrl = "http://localhost" }) {
  if (!apiKey) throw new Error("createOpenRouterClient needs an apiKey");

  async function call(path, { method = "GET", body } = {}) {
    let res;
    try {
      res = await doFetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // Optional attribution headers OpenRouter shows on its dashboard.
          "HTTP-Referer": appUrl,
          "X-Title": appName,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err?.name === "TimeoutError" ? "OpenRouter took too long to answer." : "Couldn't reach OpenRouter. Check the internet connection.";
      throw new OpenRouterError(msg, 0);
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* not JSON */
    }
    if (!res.ok) throw new OpenRouterError(describeError(res.status, data), res.status);
    return data;
  }

  return {
    /** Details of the key itself (label, usage, limit, free tier), from GET /key. */
    async keyInfo() {
      const { data } = await call("/key");
      return {
        label: data?.label ?? null,
        usage: data?.usage ?? null,
        limit: data?.limit ?? null,
        limitRemaining: data?.limit_remaining ?? null,
        isFreeTier: data?.is_free_tier ?? null,
      };
    },

    /** One chat completion. `messages` use the OpenAI format (text and image_url parts). */
    async chat({ model, messages, maxTokens = 1500, temperature = 0.4 }) {
      const data = await call("/chat/completions", { method: "POST", body: { model, messages, max_tokens: maxTokens, temperature } });
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new OpenRouterError("The model returned an empty answer. Try again.", 200);
      return { text, model: data.model ?? model, usage: data.usage ?? null };
    },
  };
}
