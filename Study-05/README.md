# Study-05 · Empathy Diary

Write one line about your day. Claude (Sonnet 5.5) names what you seem to feel, reflects your day back with empathy, and leaves you a few words of comfort. Entries are kept in a diary on your device, with a 7-day mood strip.

**Open it:** https://aufisn.github.io/VibeCoding/Study-05/

## Two ways to run it

| Where | How Claude is reached | The API key |
|---|---|---|
| **On your computer** (best) | `npm start`, then open http://127.0.0.1:8791, or just double-click `index.html` (it moves itself to the local server when it's running) | Read by the server from `Study-05/.env`; never sent to the browser |
| **GitHub Pages / no server** (e.g. on your phone) | The page calls the Anthropic API directly | You paste a key once in Settings; it's saved only in that browser. Use a separate key with a spending limit. |

```bash
cd Study-05
npm install
npm start
```

`.env` needs `ANTHROPIC_API_KEY` and, for workspace keys, `ANTHROPIC_WORKSPACE_ID` (see `.env.example`). The model is fixed to `claude-sonnet-5-5`. Each entry costs about $0.006.

## Safety

- If an entry hints at self-harm or danger, the reply stays warm and a support box points to local emergency services and [findahelpline.com](https://findahelpline.com). It isn't a substitute for professional help.
- Everything Claude or you write is shown as plain text (never HTML). The page loads no outside scripts or fonts.
- The local server listens on 127.0.0.1 only, accepts only its own page (Origin and Host checked), limits entries to 300 characters and 20 entries per 10 minutes, and never logs the key.

## Files

| File | What it does |
|---|---|
| `index.html` | The diary page (styles and app code inline) |
| `diary-core.js` | Shared by page and server: emotions, prompt, answer schema, input checks, answer checks, error messages, direct API call |
| `server.mjs` | Local server: serves the page and calls Claude with the key from `.env` |
| `tests/` | `npm test` (no network, no cost) |
| `.claude/agents/` | The five study subagents (backend, frontend, QA, AI integration, product manager), all on Sonnet |
