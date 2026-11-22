# Study-05 · Empathy Diary

Write one line about your day. Claude (Sonnet 5.5) names what you seem to feel, reflects your day back with empathy, and leaves you a few words of comfort, plus a real quote with a link to its source. Every entry is saved to your private, encrypted **Journal**, which you can open on your phone and on your computer.

**Open it:** https://aufisn.github.io/VibeCoding/Study-05/

## Ways to run it

| Where | How Claude is reached | The Claude key |
|---|---|---|
| **On your computer** (best, about 6 to 10 seconds per entry) | `npm start`, then open http://127.0.0.1:8791, or double-click `index.html` (it moves itself to the local server when it's running) | Read by the server from `Study-05/.env`; never sent to the browser |
| **GitHub mode** (online, e.g. on your phone, no laptop) at https://aufisn.github.io/VibeCoding/Study-05/ | Your entry is encrypted and put in the private Gist shared with FridgeChef (Study-04). The workflow `empathy-diary.yml` asks Claude and answers back, encrypted. Takes about a minute per entry (a little longer with the quote search). | Stays in the repo's GitHub Secrets (the same five secrets as FridgeChef); the page never holds it. If FridgeChef is already set up on this device, there is nothing new to enter. |
| **Opened from a folder without the server** | No AI and no Journal. The page explains how to start the server or use the online version. | None |

The page has no field for an Anthropic key, by design.

```bash
cd Study-05
npm install
npm start
```

`.env` needs `ANTHROPIC_API_KEY` and, for workspace keys, `ANTHROPIC_WORKSPACE_ID` (see `.env.example`). To save entries to your Journal from the local server, add three more names (values only in `.env`, which is git-ignored): `FC_GIST_ID` (your secret Gist's ID), `FC_GIST_TOKEN` (a classic token with only the `gist` scope) and `FC_PASSPHRASE` (12+ characters, the same one as on your phone). Without them the diary still answers, but says "Not saved to your Journal yet" and offers "Try saving again". The interpretation uses `claude-sonnet-5-5`; the quote search uses `claude-haiku-5-5`.

## The Journal

- **Encrypted, in your Gist.** Each month is one encrypted file (`journal-YYYY-MM.enc`) in the same secret Gist as the GitHub-mode mailbox (AES-256-GCM, key made from your passphrase). Phone and computer read the same Journal. Nothing of it is kept in the browser: it lives in memory while the page is open. The Gist's file names show which months have entries, never what is in them. If you lose the passphrase, the Journal can't be read.
- **Each entry** has your diary line, Claude's interpretation (emotions, mood, summary, empathy, comfort, gentle step) and a quote.
- **Browse:** grouped by month (newest first) with a month picker, a search box (your words, the summary, the quote and its author), and a mood trend for the last 7 and 30 days (numbers and bars). A month that can't be opened (damaged file or a different passphrase) is reported plainly and doesn't hide the others.
- **Hide, not delete.** Every entry has **Hide** (no confirmation, because it can be undone). Hidden entries leave the list, the search and the trend; **Show hidden** brings them back dimmed with **Unhide**. There is no button that deletes a single entry.
- **Delete the whole journal** is in Settings, collapsed. You must type `DELETE MY JOURNAL` exactly before the button works. It removes every entry for all your devices, but older versions stay in your Gist's revision history on GitHub. Don't delete the Gist itself; FridgeChef uses it too.
- **Download my Journal** (Settings): Markdown or plain text, with or without hidden entries. The downloaded file is not encrypted.
- **From a terminal:** every `/api/journal*` request must send the header `X-Diary: 1` (the page does it itself), e.g. `curl -H "X-Diary: 1" "http://127.0.0.1:8791/api/journal/export?format=md" -o journal.md`. Without it the server answers 403.
- **Move old entries.** If this browser still holds the old plaintext history, a banner offers "Move them into my Journal". Only after the Journal confirms does the page remove the old copy; if the move fails, the old entries stay.
- **If saving fails** (no `.env` settings, GitHub unreachable), you still see the reply and quote, with "Not saved to your Journal yet" and a **Try saving again** button.

## Quotes

Each reply comes with "A thought for today": a quote with its author, source and a link (https only; the link text is the website's name). Claude Haiku 5.5 searches the web for it (at most 2 searches). It is labelled **Verified source** when our code found the wording in a cited passage, or **Source found, exact wording not confirmed** otherwise. A link the search didn't return is never shown; when no quote qualifies you see "No quote found today". A translation, when there is one, appears under the original and is labelled. When an entry hints at crisis, the quote still appears, below the support box. A reply now costs about $0.02 to $0.03 (the searches are most of it).

## Safety

- If an entry hints at self-harm or danger, the reply stays warm and a support box points to local emergency services and [findahelpline.com](https://findahelpline.com). It isn't a substitute for professional help.
- Everything Claude or you write is shown as plain text (never HTML). The page loads no outside scripts or fonts.
- **Privacy of your diary:** your entries are saved only in your encrypted Journal (see above), never as plain text in the browser. While a GitHub-mode request is still waiting, the words you sent stay in this browser's storage so the page can pick the answer up; they are removed when it arrives or you cancel.
- **Shared with FridgeChef:** the Gist ID, the two tokens and the passphrase are the same device settings as Study-04's, so any page on the aufisn.github.io origin can read them. The Claude key is never on the device. "Forget on this device" removes them for both apps (and cancels any request still waiting).
- **Clickjacking:** GitHub Pages can't send anti-framing headers, and `frame-ancestors` doesn't work in a meta tag. That's acceptable here because the page has no one-click action that spends money: every entry needs typed text and a deliberate send.
- The local server listens on 127.0.0.1 only, accepts only its own page (Origin and Host checked), limits entries to 300 characters and 20 entries per 10 minutes, and never logs the key.

## Files

| File | What it does |
|---|---|
| `index.html` | The diary page: write, reply and quote card, Journal, Settings (styles and app code inline) |
| `diary-core.js` | Shared by page and server: emotions, prompt, answer schema, input checks, answer checks, error messages |
| `server.mjs`, `server-journal.mjs`, `claude.mjs` | Local server: serves the page, calls Claude with the key from `.env`, and saves and reads the Journal |
| `web/` | Encryption, the Gist mailbox, `journal.mjs` (the Journal, used by the page, the server and the job) and `github-mode.mjs` (GitHub mode, shared settings with Study-04) |
| `ci/run-request.mjs` | Runs inside the GitHub workflow: decrypts the request, asks Claude with the secret key, writes the encrypted answer |
| `../.github/workflows/empathy-diary.yml` | The workflow GitHub mode starts (also `security-check.yml`) |
| `tests/` | `npm test` (no network, no cost) |
| `.claude/agents/` | The six study subagents (backend, frontend, QA, AI integration, product manager, security reviewer), all on Sonnet and bound by the security rules in the root `CLAUDE.md` |
