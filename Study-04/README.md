# FridgeChef

Take a photo of the inside of your fridge, and FridgeChef recognises the ingredients and writes a recipe from them.

It works in two steps, using models on [OpenRouter](https://openrouter.ai):

1. **Image recognition** (`OPENROUTER_VISION_MODEL`, default `google/gemma-4-26b-a4b-it:free`) lists the ingredients in the photo.
2. **Text generation** (`OPENROUTER_TEXT_MODEL`, default `google/gemma-4-31b-it:free`) writes a recipe from that list.

Status: the secure key setup and the local server are done. Photo analysis and recipe generation come next.

## Setup

You need Node.js 20 or newer. There's nothing to install: no npm dependencies.

```sh
cp .env.example .env      # then paste your key from https://openrouter.ai/keys into .env
chmod 600 .env            # only your user account can read it
npm run check             # checks the key and both models, without printing the key
npm start                 # http://127.0.0.1:8790
npm test                  # unit and security tests
```

## How the API key is kept safe

The browser never talks to OpenRouter. It talks to the local server, and only the server uses the key:

```
browser (public/) ──/api/...──▶ server.mjs (holds the key) ──HTTPS──▶ openrouter.ai
```

- **The key lives only in `.env`.** That file is git-ignored by the repo's `.gitignore` (`.env`, `.env.*`), so it is never committed or published to GitHub Pages. `.env.example` shows the format, without a key.
- **Nothing sends the key to the browser.** The page only gets `/api/status` (ready plus model names) and, later, results. The config object hides the key from `JSON.stringify` and logs, and the server and the check script print only a masked form (`sk-or-…74dd`).
- **The key goes only to `openrouter.ai`,** in the `Authorization` header. Errors shown to you are short plain messages; any that mention a key are dropped.
- **The server listens on `127.0.0.1` only,** so other computers on your network can't use your key. A `HOST` that isn't local is refused.
- **Malicious web pages can't use it either.**
  - Requests with a foreign `Host` header are refused (DNS rebinding).
  - POSTs from another site are refused (Origin check).
  - A strict Content-Security-Policy lets the page load only its own files.
- **Only `public/` is served.** Path tricks like `/../.env` get a 404.
- **`.env` permissions are checked:** the server warns if other users on your computer could read it (fix: `chmod 600 .env`).

`tests/security.test.mjs` checks all of this against a running server with a fake key, including that no response ever contains the key.

**If the key ever leaks** (pasted in a chat, committed, screenshotted), delete it at https://openrouter.ai/keys, create a new one, and put the new one in `.env`. OpenRouter also lets you set a spending limit per key.

## Free models

`:free` models cost nothing but share rate limits with everyone. When they're busy, OpenRouter answers 429 and the app says "This free model is busy for everyone right now… not a problem with your key". Wait a few minutes and try again.

The non-`:free` versions of the same models cost a tiny amount per request: a short test was $0.000002. To use one, drop `:free` from the model name in `.env`.

## Files

| File | What it is |
| --- | --- |
| `server.mjs` | Local server: serves `public/`, holds the key, security checks. `createApp({ routes })` is where the API routes plug in |
| `server/config.mjs` | Reads `.env` (`parseEnv`), checks the settings (`checkConfig`), masks the key (`maskKey`) |
| `server/openrouter.mjs` | The only code that calls OpenRouter: `keyInfo()`, `chat()`, safe error messages |
| `scripts/check-key.mjs` | `npm run check`: key and model check, with the key masked |
| `public/` | The web page (HTML, CSS, JS). It never contains the key |
| `tests/security.test.mjs` | Tests for the key handling and the server's protections |
| `.env.example` | The settings format. Copy it to `.env` |
