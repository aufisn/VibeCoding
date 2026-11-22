# Study-05 · Empathy Diary

Write one line about your day. Claude (Sonnet 5.5) names what you seem to feel, reflects your day back with empathy, and leaves you a few words of comfort. Entries are kept in a diary on your device, with a 7-day mood strip.

**Open it:** https://aufisn.github.io/VibeCoding/Study-05/

## Ways to run it

| Where | How Claude is reached | The Claude key |
|---|---|---|
| **On your computer** (best, about 5 seconds per entry) | `npm start`, then open http://127.0.0.1:8791, or double-click `index.html` (it moves itself to the local server when it's running) | Read by the server from `Study-05/.env`; never sent to the browser |
| **GitHub mode** (online, e.g. on your phone, no laptop) at https://aufisn.github.io/VibeCoding/Study-05/ | Your entry is encrypted and put in the private Gist shared with FridgeChef (Study-04). The workflow `empathy-diary.yml` asks Claude and answers back, encrypted. Takes about a minute per entry. | Stays in the repo's GitHub Secrets (the same five secrets as FridgeChef); the page never holds it. If FridgeChef is already set up on this device, there is nothing new to enter. |
| **Opened from a folder without the server** | No AI. The page explains how to start the server or use the online version; your history stays readable. | None |

The page has no field for an Anthropic key, by design.

```bash
cd Study-05
npm install
npm start
```

`.env` needs `ANTHROPIC_API_KEY` and, for workspace keys, `ANTHROPIC_WORKSPACE_ID` (see `.env.example`). The model is fixed to `claude-sonnet-5-5`. Each entry costs about $0.006.

## Safety

- If an entry hints at self-harm or danger, the reply stays warm and a support box points to local emergency services and [findahelpline.com](https://findahelpline.com). It isn't a substitute for professional help.
- Everything Claude or you write is shown as plain text (never HTML). The page loads no outside scripts or fonts.
- **Privacy of your diary:** your diary history is saved in this browser only, unencrypted. On the online version, other pages on aufisn.github.io could read it, so don't use a shared browser. The local server version keeps its history separately at 127.0.0.1. "Delete all entries" in the history section wipes it.
- **Shared with FridgeChef:** the Gist ID, the two tokens and the passphrase are the same device settings as Study-04's, so any page on the aufisn.github.io origin can read them. The Claude key is never on the device. "Forget on this device" removes them for both apps (and cancels any request still waiting).
- **Clickjacking:** GitHub Pages can't send anti-framing headers, and `frame-ancestors` doesn't work in a meta tag. That's acceptable here because the page has no one-click action that spends money: every entry needs typed text and a deliberate send.
- The local server listens on 127.0.0.1 only, accepts only its own page (Origin and Host checked), limits entries to 300 characters and 20 entries per 10 minutes, and never logs the key.

## Files

| File | What it does |
|---|---|
| `index.html` | The diary page (styles and app code inline) |
| `diary-core.js` | Shared by page and server: emotions, prompt, answer schema, input checks, answer checks, error messages |
| `server.mjs` | Local server: serves the page and calls Claude with the key from `.env` |
| `web/` | GitHub mode in the browser: encryption, the Gist mailbox, `github-mode.mjs` (shared settings with Study-04) |
| `ci/run-request.mjs` | Runs inside the GitHub workflow: decrypts the request, asks Claude with the secret key, writes the encrypted answer |
| `../.github/workflows/empathy-diary.yml` | The workflow GitHub mode starts (also `security-check.yml`) |
| `tests/` | `npm test` (no network, no cost) |
| `.claude/agents/` | The six study subagents (backend, frontend, QA, AI integration, product manager, security reviewer), all on Sonnet and bound by the security rules in the root `CLAUDE.md` |
