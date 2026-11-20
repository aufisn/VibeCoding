# FridgeChef

Take a photo of the inside of your fridge, and FridgeChef recognises the ingredients and writes a recipe from them.

It works in three steps, like the app in the book. Both AI steps use **Claude Sonnet 5.5** (`claude-sonnet-5-5`) through the Anthropic API:

1. **Recognize:** Claude lists the ingredients in the photo, by category (vegetables, fruits, dairy & eggs, meat & seafood, …). The answer comes as JSON in a fixed shape (structured outputs), so the app can always read it.
2. **Adjust:** you untick anything that's wrong and add what's missing. Items Claude is unsure about start unticked.
3. **Cook:** choose the **cuisine**, **difficulty**, **max time** and **servings**, and Claude writes **two different recipes**, also in a fixed JSON shape.

**Save** keeps a recipe on your device (the **Saved** tab), and **Download as text** saves it as a `.txt` file.

[OpenRouter](https://openrouter.ai) stays as an optional backup provider (see "Free models" below).

You can run it two ways, with the same page:

- **On your Mac:** `npm start`, then open http://127.0.0.1:8790. The key is in `.env`.
- **From anywhere (phone included), no laptop needed:** open https://aufisn.github.io/VibeCoding/Study-04/. The key is a GitHub secret, and a GitHub Actions job does the work. See "Run it from anywhere" below.

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

## Run it from anywhere (GitHub)

The same design as Market Agent. GitHub Pages can't keep a secret, so the page never has the Anthropic key:

```
phone page ──encrypted photo──▶ secret Gist ◀──encrypted answer── GitHub Actions job (holds the key as a secret) ──▶ Claude
     └──────────── "start the job" (run token) ──────────────────────▲
```

1. The page encrypts the request with your passphrase (AES-256-GCM) and saves it in a secret Gist. The request is either the shrunk photo or your ingredient list and options.
2. It starts the **FridgeChef** workflow (`.github/workflows/fridgechef.yml`) with a random request ID.
3. The job decrypts the request, asks Claude, and saves the answer encrypted in the Gist.
4. The page decrypts and shows it, then deletes it from the Gist. The job deletes anything older than a day.

Recognize and Cook are separate jobs, each about 30–60 seconds, mostly GitHub starting a computer. GitHub Actions is free for public repos. Claude costs about half a cent to recognize a photo and about 1–2 cents for two recipes.

**What's public, and what isn't.** The repo is public, so the code and the Actions logs are public. The logs show only a random request ID and progress words. Photos and recipes exist only encrypted in the secret Gist, and the key exists only in GitHub's secret store.

### One-time setup

1. **A secret Gist** (the mailbox): on https://gist.github.com, create a *secret* gist with one file, `README.md`, containing "FridgeChef mailbox". Its ID is the 32 letters and numbers at the end of its web address.
2. **A passphrase:** at least 12 characters. It encrypts photos and answers. Keep it in your password manager.
3. **A gist token** (the job and the page use it to read and write the Gist): github.com → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → scope **gist** only. Market Agent's gist token works too.
4. **Repository secrets.** Run these in Terminal from `Study-04`. Each command asks for its value, or reads it from `.env`, so the value never shows on screen or in a chat:

   ```sh
   grep '^ANTHROPIC_API_KEY=' .env | cut -d= -f2- | gh secret set ANTHROPIC_API_KEY --repo aufisn/VibeCoding
   grep '^ANTHROPIC_WORKSPACE_ID=' .env | cut -d= -f2- | gh secret set ANTHROPIC_WORKSPACE_ID --repo aufisn/VibeCoding
   gh secret set FC_PASSPHRASE --repo aufisn/VibeCoding
   gh secret set FC_GIST_ID --repo aufisn/VibeCoding
   gh secret set FC_GIST_TOKEN --repo aufisn/VibeCoding
   gh secret list --repo aufisn/VibeCoding        # shows the names only, never the values
   ```

5. **A run token** (lets the page start the job): Personal access tokens → **Fine-grained tokens** → Repository access: **Only select repositories → VibeCoding** → Permissions → **Actions: Read and write**. Nothing else.
6. **On your phone:** open https://aufisn.github.io/VibeCoding/Study-04/, open **GitHub connection**, enter the Gist ID, both tokens and the passphrase, and press **Save**.

They're kept only in that browser on that device: use **Forget on this device** on a shared device. Pages from other aufisn.github.io projects (such as Market Agent) share that browser storage, so open only your own pages there.

**If a token or the passphrase leaks:** delete the token on GitHub and make a new one. For the passphrase, set a new `FC_PASSPHRASE` and enter it on each device.

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
| `server/claude.mjs` | Claude client (official SDK): `identifyIngredients()` (photo → JSON ingredients), `writeRecipes()` (two recipes as JSON), `checkModel()`, cost per request, safe error messages |
| `server/fridgechef.mjs` | `recognize()` (photo → ingredients) and `cook()` (ingredients + options → two recipes). Shared by the local server (`/api/recognize`, `/api/recipes`) and the GitHub job |
| `public/options.js` | Categories, cuisines, difficulty, time and servings limits, and the checks on them. Shared by the page, the server and the job |
| `ci/run-request.mjs` | The GitHub job: reads the encrypted request from the Gist, asks Claude, writes the encrypted answer |
| `../.github/workflows/fridgechef.yml` | The GitHub Actions workflow (started by the page, never on a schedule) |
| `public/fc-crypto.js` | Encryption (AES-256-GCM, PBKDF2-SHA256, 310,000 rounds), shared by the page and the job |
| `public/mailbox.js`, `public/remote.js` | The Gist mailbox, and GitHub mode (upload, start the job, wait, decrypt) |
| `public/photo.js` | Shrinks the photo before sending |
| `server/openrouter.mjs` | OpenRouter backup client: `keyInfo()`, `chat()`, safe error messages |
| `scripts/check-key.mjs` | `npm run check`: key and model check, with the key masked (free for Claude) |
| `scripts/try-models.mjs` | Tries text generation or image recognition and prints the answer, tokens and cost |
| `examples/test-fridge.png` | A drawn test fridge with known contents (`.svg` is its source) |
| `public/` | The web page (HTML, CSS, JS). It never contains the key |
| `tests/*.test.mjs` | Key handling, server protections, Claude client, and GitHub mode end to end with a fake GitHub (tests never call any API) |
| `.env.example` | The settings format. Copy it to `.env` |
