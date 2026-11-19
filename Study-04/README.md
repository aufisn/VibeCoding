# FridgeChef

Take a photo of the inside of your fridge, and FridgeChef recognises the ingredients and writes a recipe from them.

It works in two steps, both done by **Claude Sonnet 5.5** (`claude-sonnet-5-5`) through the Anthropic API:

1. **Image recognition:** Claude lists the ingredients in the photo, as JSON in a fixed shape (structured outputs, so the app can always read it).
2. **Text generation:** Claude writes a recipe from that list.

[OpenRouter](https://openrouter.ai) stays as an optional backup provider (see "Free models" below).

Status: the secure key setup and the local server are done. Photo analysis and recipe generation come next.

## Setup

You need Node.js 20 or newer. The only dependency is Anthropic's official SDK, `@anthropic-ai/sdk`.

```sh
npm install               # installs @anthropic-ai/sdk
cp .env.example .env      # then paste your key from the Claude Console into ANTHROPIC_API_KEY
chmod 600 .env            # only your user account can read it
npm run check             # checks the key and model access (free: nothing is generated)
npm start                 # http://127.0.0.1:8790
npm test                  # unit and security tests (no API calls)
```

Try the AI directly (each call costs a little; the cost is printed, and `--allow-paid` is required):

```sh
node scripts/try-models.mjs text --allow-paid
node scripts/try-models.mjs image examples/test-fridge.png --allow-paid
```

Claude Sonnet 5.5 costs $2 per million input tokens and $10 per million output tokens. One photo plus one recipe is roughly one to three cents.

If Claude declines a request on safety grounds, the API retries it on a suitable fallback model inside the same call (server-side fallback, `fallbacks: "default"`).

## How the API key is kept safe

The browser never talks to Anthropic or OpenRouter. It talks to the local server, and only the server uses the key:

```
browser (public/) ──/api/...──▶ server.mjs (holds the key) ──HTTPS──▶ api.anthropic.com (or openrouter.ai)
```

- **The key lives only in `.env`.** That file is git-ignored by the repo's `.gitignore` (`.env`, `.env.*`), so it is never committed or published to GitHub Pages. `.env.example` shows the format, without a key.
- **Nothing sends the key to the browser.** The page only gets `/api/status` (ready plus model names) and, later, results. The config object hides the key from `JSON.stringify` and logs, and the server and the check script print only a masked form (like `sk-ant-…a1b2`).
- **The key goes only to the provider** (`api.anthropic.com` through the official SDK, or `openrouter.ai`). Errors shown to you are short plain messages; any that mention a key are dropped.
- **The server listens on `127.0.0.1` only,** so other computers on your network can't use your key. A `HOST` that isn't local is refused.
- **Malicious web pages can't use it either.**
  - Requests with a foreign `Host` header are refused (DNS rebinding).
  - POSTs from another site are refused (Origin check).
  - A strict Content-Security-Policy lets the page load only its own files.
- **Only `public/` is served.** Path tricks like `/../.env` get a 404.
- **`.env` permissions are checked:** the server warns if other users on your computer could read it (fix: `chmod 600 .env`).

`tests/security.test.mjs` checks all of this against a running server with a fake key, including that no response ever contains the key.

**If the key ever leaks** (pasted in a chat, committed, screenshotted), delete it (Claude Console → API keys, or openrouter.ai/keys), create a new one, and put the new one in `.env`. Both let you set a spending limit.

## Free models (OpenRouter backup)

To use OpenRouter instead of Claude, set `AI_PROVIDER=openrouter` and the `OPENROUTER_*` settings in `.env`. In testing (19 November 2026), Google's free Gemma pool answered "busy" to every request for over 10 minutes, which is why FridgeChef uses Claude.

`:free` models cost nothing but share rate limits with everyone. When they're busy, OpenRouter answers 429 and the app says "This free model is busy for everyone right now… not a problem with your key". Wait a few minutes and try again.

The non-`:free` versions of the same models cost a tiny amount per request: a short test was $0.000002. To use one, drop `:free` from the model name in `.env`.

## Files

| File | What it is |
| --- | --- |
| `server.mjs` | Local server: serves `public/`, holds the key, security checks. `createApp({ routes })` is where the API routes plug in |
| `server/config.mjs` | Reads `.env` (`parseEnv`), checks the settings (`checkConfig`), masks the key (`maskKey`) |
| `server/claude.mjs` | Claude client (official SDK): `identifyIngredients()` (photo → JSON ingredients), `writeRecipe()`, `checkModel()`, cost per request, safe error messages |
| `server/openrouter.mjs` | OpenRouter backup client: `keyInfo()`, `chat()`, safe error messages |
| `scripts/check-key.mjs` | `npm run check`: key and model check, with the key masked (free for Claude) |
| `scripts/try-models.mjs` | Tries text generation or image recognition and prints the answer, tokens and cost |
| `examples/test-fridge.png` | A drawn test fridge with known contents (`.svg` is its source) |
| `public/` | The web page (HTML, CSS, JS). It never contains the key |
| `tests/*.test.mjs` | Key handling, server protections, Claude client (with a fake SDK: tests never call the API) |
| `.env.example` | The settings format. Copy it to `.env` |
