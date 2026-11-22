# PRD: Empathy Diary v2, the Personal Journal

Status: draft for the user's review. Items marked **[Proposal]** are the product manager's suggestions, not the user's decisions. Items marked **[Decided]** come from the user.

## 1. Problem and users

**User:** one person (the owner) who writes one line a day, on a phone and on a computer.

**Problems today**
- History is plaintext in one browser's `localStorage`. Phone and computer have separate histories, clearing the browser loses everything, and on the online version other pages on `aufisn.github.io` can read it.
- "Delete all entries" is one tap away from losing everything.
- The reply has no lasting "keepsake": nothing to come back to besides the interpretation.

**Need:** a private journal that follows the user across devices, can't be wiped by accident, and gives each day a real, verifiable quote.

## 2. Goals and non-goals

**Goals**
1. One shared journal for phone and computer, stored encrypted in the user's secret Gist. [Decided]
2. Every entry carries a quote that is backed by a source, or no quote. [Decided]
3. Deleting is hard and honest; hiding is easy and reversible. [Decided]
4. No plaintext journal in any browser storage. [Proposal]

**Non-goals (v2)**
- Accounts, sharing with other people, or multiple users.
- Editing a diary entry after it is saved.
- Reminders, notifications, images, voice.
- Any model above Sonnet 5.5; any AI call from the browser.
- A server database. The Gist is the only store.

## 3. Entry format [Decided]

Each journal entry has three parts:

| Part | Content |
|---|---|
| Diary entry | The user's line (max 300 characters, as today) |
| Interpretation | Today's result: emotions, mood score (1-10), summary, empathy, comfort, gentle step, concern level, language |
| Quote | `text` (original wording), `author`, `work` (source work), `url` (from the search results), optional `translation` plus `translation_language`. May be `null`. |

Plus metadata: `id` (the request ID format, unique), `createdAt`, `model`, `cost_usd`, and `source` (`github`, `local` or `import`).

## 4. Features

### F1. Shared encrypted journal

*As the owner, I want my entries saved in my secret Gist, so that my phone and computer show the same journal.*

Storage design **[Proposal]**
- **Encryption:** the existing envelope from `web/fc-crypto.mjs` (AES-256-GCM, PBKDF2-SHA256 310,000 rounds, random salt and IV every write) with the existing passphrase.
- **Layout:** one file per month, `journal-YYYY-MM.enc`, in the same Gist as `req-`/`res-` files. Month is taken from the entry's `createdAt` in UTC. Each file decrypts to `{ "v": 1, "entries": [...], "hidden": ["<id>", ...] }`. Hiding adds an ID to `hidden`; unhiding removes it.
- **Size:** one entry is about 2 KB of JSON, about 3 KB encrypted and base64. At one entry a day a month is about 100 KB. The Gist API returns file content in full only up to about 1 MB per file and marks bigger ones `truncated` (the existing `gist.text()` already follows `raw_url`). A Gist can also hold a limited number of files in API listings (about 300). Rule: if a month file would pass 800 KB, start `journal-YYYY-MM-2.enc`. The backend developer must confirm the real limits against GitHub's current docs.
- **Why monthly:** every append re-encrypts the whole file (about 0.1 s of PBKDF2), so small files keep saves and loads fast, and a bad write can only damage one month.
- **File names are not secret:** the Gist is secret but not private, so the names reveal which months have entries. Contents stay encrypted. Say this in Settings.
- **History:** the Gist's own revision list keeps older versions of every file.
- **Cleanup safety:** the job's 24-hour cleanup only touches `req-`/`res-` files with valid IDs, so `journal-*` files are never removed by it. A test must prove this (the Gist is shared with FridgeChef, which must not break either).

**Writers**
- **GitHub mode:** the workflow appends the new entry after Claude answers, then writes the answer file as today. The answer also carries `saved: true/false`.
- **Local mode:** `server.mjs` appends to the same Gist after Claude answers. `.env` gains `FC_GIST_ID`, `FC_GIST_TOKEN`, `FC_PASSPHRASE` (git-ignored, chmod 600, allowed under Pattern A). The page in local mode holds no Gist credentials.
- **Browser (GitHub mode only):** hide/unhide, import and delete write straight to the Gist with the device credentials the user already typed in (Gist token and passphrase). No new kind of credential.

Acceptance criteria
- AC-F1.1 After an entry in GitHub mode, `journal-<month>.enc` exists in the Gist and contains no readable diary text (a test greps the stored text for the entry words and finds none).
- AC-F1.2 An entry written on the phone appears on the computer after a reload, with no extra steps.
- AC-F1.3 Decryption with a wrong passphrase shows "Wrong passphrase" and shows no entries and no garbled data.
- AC-F1.4 If the Gist write fails after Claude answered, the user still sees the reply, sees "Not saved to your journal yet" with a "Try saving again" button, and the entry is kept in memory only (never in storage) until saved or the page closes.
- AC-F1.5 After saving, no diary text, interpretation or quote exists in `localStorage`, `sessionStorage`, IndexedDB or cookies (a test inspects them).
- AC-F1.6 The job's cleanup never deletes a `journal-*` file.
- AC-F1.7 If local mode has no Gist settings in `.env`, the page says so plainly and says the entry will not be saved (see open question 1).

### F2. Safe concurrent writes [Proposal]

*As the owner, I want no entry lost when the phone's workflow and my computer's server write at the same time, so that I can trust the journal.*

Gists have no conditional write (no "only if unchanged"). Procedure for every journal change (append, hide, import, delete):
1. Read the month file and note the Gist's latest version.
2. Merge in memory: add entries by `id` (an existing `id` is skipped, so a retry never duplicates).
3. Write the file (one PATCH).
4. Read back and check the change is present. If not (someone overwrote it), wait a random 0.5-2 s and repeat from step 1, up to 4 attempts. After that, report "not saved".

Concurrency groups: the workflow keeps one group **per request ID** (as now). A single global group would make GitHub cancel older pending runs, so a second entry made while the first waits would be dropped. The small race that remains (two writers within the same second) is covered by the read-back check.

Acceptance criteria
- AC-F2.1 A test with two fake writers that interleave never loses either entry.
- AC-F2.2 Retrying the same entry ID never creates a duplicate.
- AC-F2.3 After 4 failed attempts the result is "not saved" with the reason, and the Claude reply is still shown.
- AC-F2.4 `empathy-diary.yml` keeps a concurrency group built from the request ID only.

### F3. A verified quote for each situation [Decided]

*As the owner, I want a quote that fits my day and really exists, so that I can trust it and look it up.*

Design
- Claude picks a quote freely, then uses the **web search server tool, at most 2 searches per entry** (`max_uses: 2`), to check the exact wording and author.
- The answer's quote fields come from what the search found: text, author, source work, and a source URL that appears in the search results.
- **Verified means** (checked in our code, not only by the model): the URL is `https://` and appears in the search results, and the quote text, after trimming spaces and quote marks, appears in a cited passage from that result. Otherwise the quote is dropped (`quote: null`).
- Search results are untrusted web text. They are never treated as instructions and are shown as plain text only. The URL is shown as a link with `rel="noopener noreferrer"` and no other markup.
- The quote keeps its original wording. An optional translation into the user's language (`language` field) is shown in a separate line labelled "Translation (by Claude, not the author's words)".
- No quote when `concern` is `possible` or `urgent`, so the support box stays the focus. [Proposal]
- Model stays `claude-sonnet-5-5`.

Cost [Decided that it rises; numbers are estimates to be measured]

| | Today | v2 |
|---|---|---|
| Per entry | about $0.006 | about $0.02-0.03 (2 searches at about $0.01 each, plus longer input from search results) |
| 30 entries a month | about $0.18 | about $0.60-0.90 |

Acceptance criteria
- AC-F3.1 Every shown quote has author, source work and a clickable `https://` URL, and no quote is shown without all three.
- AC-F3.2 A fake answer with a quote whose text is not in any cited passage is shown as "No verified quote today", with no quote text on screen.
- AC-F3.3 A URL that is not in the search results, or is not `https://`, is rejected (unit test).
- AC-F3.4 The request body sets `max_uses` to 2 and the model to `claude-sonnet-5-5`; a test fails if another model string is present.
- AC-F3.5 The translation, when present, is visually separate and labelled; the original is always shown first.
- AC-F3.6 A quote or search text containing `<script>` or HTML is shown as plain text (`textContent`).
- AC-F3.7 `cost_usd` per entry includes search cost, and the page shows it (as today's cost line does, if present).
- AC-F3.8 If search is unavailable (error or not enabled), the reflection still works with `quote: null` and a short notice.

### F4. Hide, never casually delete [Decided]

*As the owner, I want to hide an entry without destroying it, and be unable to wipe my history by mistake.*

- No delete button on entries, and the "Delete all entries" button is removed.
- Each entry has **Hide**. Hidden entries disappear from the list, mood trend and search, and appear under **Show hidden** with an **Unhide** button. [Proposal for trend and search exclusion]
- **True deletion** lives only in Settings, under "Danger zone". Scope **[Proposal]**: delete one hidden entry, or the whole journal. The user must type a confirmation phrase, **[Proposal]** `DELETE MY JOURNAL`, exactly; the button stays disabled until it matches. No browser `confirm()` dialog.
- Honest wording in the danger zone: "This removes the entry from your journal now. Older versions stay in your Gist's revision history on GitHub, encrypted with your passphrase, until you delete the Gist's history yourself. Anyone with your passphrase and Gist access could still read them."
- Because the Gist is shared with FridgeChef, the UI must not suggest deleting the whole Gist.

Acceptance criteria
- AC-F4.1 No element named delete exists on an entry card; "Delete all entries" is gone (UI test).
- AC-F4.2 Hide then reload: the entry is not in the list but is in "Show hidden"; Unhide brings it back, on the other device too.
- AC-F4.3 Delete in Settings stays disabled until the exact phrase is typed (wrong case, extra space: disabled).
- AC-F4.4 After a true delete, the entry is not in the current file and the danger zone text above is shown before and after.
- AC-F4.5 Only hidden entries can be deleted individually.
- AC-F4.6 Local server: `/api/journal/delete` refuses a request whose `confirm` field is not the exact phrase (400).

### F5. Reading the journal

*As the owner, I want to browse and search my journal on any device.*

- **GitHub mode:** the page lists month files from the Gist, fetches the latest two months, decrypts in memory, and loads older months on "Load older". Nothing is cached in storage.
- **Local mode:** the page asks the server, which reads and decrypts: `GET /api/journal?month=YYYY-MM`, `GET /api/journal/months`, `POST /api/journal/hide` (hide/unhide). Same `Origin` and `Host` checks, size limit and rate limit as `/api/reflect`. Responses are `no-store`.
- **Browse** by month; **search box** (text, summary, quote author), run in memory; **mood trend** for 7 days and 30 days (average and a strip), from visible entries.

Acceptance criteria
- AC-F5.1 Opening the page on the second device with the same settings shows the same entries.
- AC-F5.2 Search finds an entry by a word from the diary line, the summary or the quote author, case-insensitive, and never lists hidden entries unless "Show hidden" is on.
- AC-F5.3 The trend shows the average mood score for the last 7 and 30 days, and says "Not enough entries" with fewer than 2 entries in the range.
- AC-F5.4 The journal endpoints return 421 for a bad `Host` and 403 for a foreign `Origin`, and return 413 for a body over the limit.
- AC-F5.5 Everything from the journal, Claude or the web is shown with `textContent`.

### F6. One-time import of old entries [Proposal]

*As the owner, I want my current browser history moved into the journal, so that I lose nothing.*

- On first load with a legacy history present and the journal reachable, the page offers "Move N earlier entries into your journal" (the user presses it; no silent import).
- Imported entries get `source: "import"`, `quote: null`, and a stable `id` made from their old timestamp, so pressing import twice, or on two devices, never duplicates.
- Only after the write is read back and verified does the page remove the plaintext copy. If anything fails, the old copy is left untouched and the offer stays.
- Local mode and the online page use different browser storage, so each offers its own import; the stable IDs merge them.

Acceptance criteria
- AC-F6.1 Import of N entries gives exactly N journal entries; a second import adds zero.
- AC-F6.2 A failed write leaves the legacy history in place.
- AC-F6.3 After success the legacy keys are gone from `localStorage`.
- AC-F6.4 Imported entries show no quote and an "Imported" label.

### F7. Export [Proposal]

*As the owner, I want to download my journal as my own backup.*

- "Download journal" in Settings produces a `.md` file (default) or `.txt`, built in memory from the decrypted journal and saved with the browser's download. Hidden entries are left out unless the user ticks "Include hidden".
- Per entry: date, the diary line, the interpretation fields, and the quote with author, work and URL.
- The page warns that the downloaded file is not encrypted.

Acceptance criteria
- AC-F7.1 The file contains every visible entry, newest or oldest first (stated in the UI), with date, text, summary, empathy, comfort and quote.
- AC-F7.2 Hidden entries appear only with the tickbox on.
- AC-F7.3 The unencrypted warning is visible before download.
- AC-F7.4 Nothing from the export is written to browser storage.

### F8. Error states

| Situation | What the user sees | Behaviour |
|---|---|---|
| Gist unreachable or token refused | "Could not reach your journal (GitHub said: ...)" using the existing `describeGitHubError` wording | Reply still shown if it exists; "Try again" button; nothing stored in the browser |
| Wrong passphrase | "That passphrase can't open your journal. Check Settings." | No entries shown; no overwrite of the journal ever happens with a wrong passphrase |
| Quote not verifiable | "No verified quote today" | Entry saved with `quote: null` |
| Search tool unavailable | Short notice, reflection still shown | `quote: null` |
| Journal file damaged or bad version | "This month could not be read" with the file name | Other months still load; the file is never overwritten silently |
| Write conflict after 4 tries | "Not saved yet" | "Try saving again" |

Acceptance criteria
- AC-F8.1 Each row above has a test or manual check with the exact text shown.
- AC-F8.2 With a wrong passphrase, a hide, append or import attempt is refused before any write (no overwrite).

## 5. Screens and flow

1. **Home** (today's page): input line, send, reply card. The reply card now has: emotions and mood, empathy, comfort, gentle step, and a **Quote card** (original, author, work, source link, optional labelled translation) and a save status line ("Saved to your journal" or "Not saved yet" with retry).
2. **Journal** (replaces "My diary" history): month selector, search box, 7-day and 30-day trend, entry cards each with **Hide**, a **Show hidden** switch, "Load older months".
3. **Settings:** device credentials (as today, with Forget), **Download journal**, **Danger zone** (true delete with phrase), import offer, privacy note rewritten (no plaintext copy; Gist file names visible; revision history).

Flow: write a line, send, wait (GitHub mode 30-90 s with Cancel, local mode about 5-10 s), reply with quote appears, entry is already saved, it shows at the top of the Journal.

## 6. Technical notes

- **Stack:** unchanged. Static page, Node 24 server, GitHub Actions workflow. Pattern A (local server) and Pattern B (encrypted GitHub relay) from `/Users/salimaufi/VibeCoding/CLAUDE.md` section 2. No new pattern.
- **AI:** `claude-sonnet-5-5` only, structured JSON output, plus the web search server tool with `max_uses: 2`. The exact tool version name must be checked in the current API docs. The tool must be enabled for the organisation/workspace in the Claude Console (open question 2).
- **Structured output and search together** may not combine in one call. The AI specialist spikes this first. Fallback: one call with search that returns the quote and citations, and the existing call for the interpretation. This costs more tokens, so the budget must be re-measured.
- **New shared module (proposal):** `web/journal.mjs`, used by the browser, the server and the CI job: month file naming, merge, hide, append-with-verify, import, delete, export text. It reuses `fc-crypto.mjs` and `mailbox.mjs`.
- **Secrets:** no new secrets in GitHub (`FC_*` and `ANTHROPIC_*` already exist). Local `.env` gains `FC_GIST_ID`, `FC_GIST_TOKEN`, `FC_PASSPHRASE`; add them to `.env.example` as empty names only. The browser holds only the existing device credentials. Never log entry text, quote text, passphrase or tokens. Workflow log shows progress words only.
- **Limits:** entry 300 characters; local server 20 entries per 10 minutes and 4 KB bodies (journal import needs a bigger limit on its own endpoint, set and justified by the backend developer); search at most 2 per entry.
- **Data:** the journal is the only store. Gist revisions are the backup.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Cost 3-5 times higher | Cap searches at 2; show cost; measure in the first real test; user approves the paid test |
| Search plus structured output don't mix | Spike first; two-call fallback |
| Claude invents a quote or the search page is wrong | Code-side check that the quote is in a cited passage; otherwise no quote |
| Prompt injection from web pages | Treat search text as data; never act on it; plain-text display; URL must come from results |
| Lost update with two writers | Read-back check and retries (F2); IDs make retries safe |
| Gist size or file limits | Monthly files; 800 KB roll-over; confirm limits |
| Passphrase lost or changed | The journal can't be read. Say so in Settings; no recovery by design |
| Revision history keeps "deleted" text | Honest wording in the UI (F4) |
| Passphrase now in the server `.env` | Allowed place under CLAUDE.md; chmod 600; git-ignored; never logged |
| Shared Gist with FridgeChef | Distinct `journal-` file names; cleanup untouched; test |

## 8. Later (not in v2)

- Edit or add a note to an entry.
- Monthly or yearly summary written by Claude.
- Import from an export file.
- A third quote language or a quote picked by theme.
- Optional daily cost cap.

## 9. Open questions for the user

1. **Local mode without Gist settings:** if `.env` has no `FC_GIST_*`, should the app (a) still reply but save nothing, or (b) refuse to run? The decision "no plaintext copy" rules out keeping today's local history. Suggested: (a) with a clear notice.
2. **Web search access:** is web search enabled for your Anthropic organisation/workspace? If not, it must be switched on in the Console before the feature can work.
3. **Quote when concern is "possible" or "urgent":** skip the quote (suggested) or keep it?
4. **Translation:** shown by default in the user's language when different from the quote's, or only on a tap?
5. **Hidden entries in the mood trend and search:** excluded (suggested) or included?
6. **Delete scope and phrase:** is "one hidden entry or the whole journal" enough? Is `DELETE MY JOURNAL` the phrase you want?
7. **Export:** Markdown by default, hidden entries excluded unless ticked. OK?
8. **Passphrase in local `.env`:** confirm you are happy to store `FC_PASSPHRASE` in `Study-05/.env` (same value as the GitHub secret).
9. **Paid testing budget:** may QA and the AI specialist run real paid calls (about 10-20 entries, roughly $0.50 at most) to verify search and cost?
10. **Legacy import:** a button the user presses (suggested), or automatic on first load?

## 10. User decisions (2026-11-22, answering section 9)

- **Test budget:** up to $0.50 of real Claude calls in total: about $0.30 for the AI specialist's spike and quote work, and about $0.20 for QA. Report the actual cost.
- **Quotes in a crisis:** always add a quote, even when concern is "possible" or "urgent". It must then be gentle and hopeful, never glib, and it appears below the support box.
- **True deletion:** **the whole journal only**, from Settings, after typing `DELETE MY JOURNAL`. Single entries can only be hidden or unhidden, never deleted.
- **Journal unreachable** (local `.env` without the Gist settings, or GitHub down): still show the reply and quote, say clearly that it wasn't saved, and offer "Try saving again".
- **Defaults confirmed, the main session's choice:**
  - Hidden entries are left out of the mood trend and search.
  - The legacy import runs only when the user presses a button.
  - Export defaults to Markdown, with hidden entries excluded unless ticked.
  - The translation shows under the original quote, labelled "Translation".
- **Already decided:**
  - `FC_GIST_ID`, `FC_GIST_TOKEN` and `FC_PASSPHRASE` go in `Study-05/.env`.
  - Whether web search is enabled is found out by the spike.
- **Quotes, decided after the spike (2026-11-22):**
  - **Show Claude's quote with a label.** It gets the "verified" label when the code proves the wording from a search citation. Otherwise it gets "Source found, exact wording not confirmed".
  - **Always enforced:** the link must be an `https` URL that the web search actually returned. If it isn't, no quote is shown. A made-up link is never displayed.
  - **The quote call uses `claude-haiku-5-5`.** The interpretation stays on `claude-sonnet-5-5`.
  - **Test budget:** about $0.30 was spent on the spike. The remaining $0.20 is split: up to $0.06 for the AI specialist to confirm Haiku, and up to $0.14 for QA.
