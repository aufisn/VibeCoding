# Schedule: Empathy Diary v2 (Personal Journal)

Statuses: to do / in progress / done. Update this file when work finishes or scope changes.
Each task fits one session. Requirements are in `/Users/salimaufi/VibeCoding/Study-05/docs/PRD.md` (AC numbers refer to it).

## File ownership (so two agents never edit one file at once)

| Owner | Files they may edit |
|---|---|
| `ai-integration-specialist` | `diary-core.js`, `tests/core.test.mjs` |
| `backend-developer` | `web/journal.mjs` (new), `web/github-mode.mjs`, `web/mailbox.mjs`, `server.mjs`, `ci/run-request.mjs`, `.env.example`, `tests/journal.test.mjs` (new), `tests/server.test.mjs`, `tests/github-mode.test.mjs`, `tests/run-request.test.mjs` (new) |
| `frontend-developer` | `index.html`, `README.md` |
| `qa-engineer` | new files `tests/qa-*.mjs` and `docs/QA-REPORT.md` only |
| `security-reviewer` | none (reads, reports) |
| `product-manager` | `docs/` |

`.github/workflows/empathy-diary.yml` needs no change in this plan. If the backend developer thinks it does, they report it to the main session first.
Rule: a task starts only when everything in its "Depends on" column is done. Tasks in the same milestone with different owners and no dependency between them may run at the same time.

## M0. Plan agreed

| ID | Task | Owner | Depends on | Status |
|---|---|---|---|---|
| T0.1 | PRD and schedule written | product-manager | none | done |
| T0.2 | User answers the open questions (PRD section 9) | main session | T0.1 | to do |

## M1. Foundations (two agents in parallel, different files)

| ID | Task | Owner | Depends on | Status |
|---|---|---|---|---|
| T1.1 | Spike: can web search (`max_uses: 2`) and JSON-schema output combine in one call on `claude-sonnet-5-5`? Check current docs; if one call won't work, design the two-call fallback. Write the finding as a comment block at the top of the new code. No paid call without the user's yes (question 9). | ai-integration-specialist | T0.2 | to do |
| T1.2 | `diary-core.js`: add `quote` to the result schema and prompt (pick freely, verify with search, keep original wording, optional labelled translation, no quote when concern is possible or urgent); add the search tool to `buildRequestBody`; add search cost to `costOf`. Covers AC-F3.4, AC-F3.7. | ai-integration-specialist | T1.1 | to do |
| T1.3 | `diary-core.js`: `parseResult` verifies the quote in code (https URL from the results, text inside a cited passage, author and work present); otherwise `quote: null`; tolerate search errors (AC-F3.1, F3.2, F3.3, F3.6, F3.8). Unit tests with fake messages. | ai-integration-specialist | T1.2 | to do |
| T1.4 | `web/journal.mjs`: pure functions and Gist I/O. Month file names, `{v, entries, hidden}` shape, merge by ID, hide/unhide, delete one or all, 800 KB roll-over, list months, export to Markdown/text, append-with-verify (read, merge, write, read back, 4 tries with jitter). Uses `fc-crypto.mjs` and `mailbox.mjs`. Confirm Gist limits in GitHub's docs. Works in browser and Node. Covers AC-F1.1, F1.3, F2.1, F2.2, F2.3, F7.1, F7.2, F8.2. | backend-developer | T0.2 | to do |
| T1.5 | `tests/journal.test.mjs`: fake Gist with a forced interleaving of two writers, wrong passphrase, damaged file, duplicate IDs, size roll-over, no plaintext in stored text. | backend-developer | T1.4 | to do |
| T1.6 | Publish the module's function list (names, inputs, outputs) as a comment block at the top of `web/journal.mjs`, so the frontend can build against it. | backend-developer | T1.4 | to do |

## M2. Wiring (backend and frontend in parallel, different files)

| ID | Task | Owner | Depends on | Status |
|---|---|---|---|---|
| T2.1 | `ci/run-request.mjs`: after Claude answers, append the entry to the journal (`source: github`), set `saved` in the answer; journal failure never blocks the reply. Add `tests/run-request.test.mjs`. Prove the cleanup never touches `journal-*` (AC-F1.6). Logs: progress words only. | backend-developer | T1.3, T1.5 | to do |
| T2.2 | `server.mjs`: read `FC_GIST_ID`, `FC_GIST_TOKEN`, `FC_PASSPHRASE` from `.env`; append after reflect; add `GET /api/journal/months`, `GET /api/journal`, `POST /api/journal/hide`, `POST /api/journal/append` (retry save), `POST /api/journal/import`, `POST /api/journal/delete` (exact phrase). Origin, Host, size and rate checks on all; `no-store`; never log text or secrets. Update `.env.example` (names only). Server tests cover AC-F4.6, F5.4. | backend-developer | T2.1 | to do |
| T2.3 | `web/github-mode.mjs`: journal helpers for the page (load months, hide, unhide, import, delete, export) using the stored device credentials; `unwrap` passes `quote` and `saved`; nothing written to storage. Extend `tests/github-mode.test.mjs`. | backend-developer | T2.2 | to do |
| T2.4 | `index.html` part 1: Quote card on the reply (original, author, work, link, labelled translation, "No verified quote today"), save status line with "Try saving again" (in-memory only). AC-F3.1, F3.5, F3.6, F1.4. Build against the T1.6 function list and `diary-core.js`. | frontend-developer | T1.3, T1.6 | to do |
| T2.5 | `index.html` part 2: Journal view (month selector, search, 7 and 30 day trend, Hide, Show hidden, Load older), remove the plaintext history and "Delete all entries", read via `web/journal.mjs` in GitHub mode and via the server endpoints in local mode. AC-F4.1, F4.2, F5.1 to F5.3, F5.5. | frontend-developer | T2.4, T2.2, T2.3 | to do |
| T2.6 | `index.html` part 3: Settings (Download journal with warning, Danger zone with phrase and honest revision-history text, rewritten privacy note), one-time import offer, error states from PRD F8. AC-F4.3 to F4.5, F6.1 to F6.4, F7.3, F7.4, F8.1. | frontend-developer | T2.5 | to do |

T2.4 may start as soon as M1 is done, while backend works on T2.1 to T2.3 (different files). T2.5 waits for the backend endpoints.

## M3. Security review (gate; a veto blocks the release)

| ID | Task | Owner | Depends on | Status |
|---|---|---|---|---|
| T3.1 | Review the whole change against `/Users/salimaufi/VibeCoding/CLAUDE.md`: no secret or journal text in browser storage, URLs, logs or tests; no key or workspace ID in the page; only Pattern A and Pattern B; workflow rules unchanged (read-only permissions, pinned actions, secrets in one step, only the random ID as input); journal endpoints' Origin and Host checks; `textContent` everywhere; quote URL handling; `.env.example` has names only; model string is only `claude-sonnet-5-5`. Report blockers first. | security-reviewer | T2.1, T2.2, T2.3, T2.6 | to do |
| T3.2 | Fix every finding (backend files). | backend-developer | T3.1 | to do |
| T3.3 | Fix every finding (`index.html`, `diary-core.js`) one owner at a time: frontend first, then AI specialist. | frontend-developer, then ai-integration-specialist | T3.1 | to do |
| T3.4 | Run `node /Users/salimaufi/VibeCoding/scripts/security-check.mjs`; re-review fixes. | security-reviewer | T3.2, T3.3 | to do |

T3.2 and T3.3 touch different files and may run together. Frontend and AI specialist do not run at the same time only if a finding needs both a change in `index.html` and one in `diary-core.js`; otherwise they may.

## M4. QA

| ID | Task | Owner | Depends on | Status |
|---|---|---|---|---|
| T4.1 | Automated checks in new `tests/qa-*.mjs` (no network, no cost): storage inspection after save, no plaintext in the Gist text, concurrency, cleanup safety, exact phrase gating, error texts, model string check, Origin/Host/size. Run `npm test`. | qa-engineer | T3.4 | to do |
| T4.2 | Manual checklist on a desktop browser and a phone-size window: every AC in the PRD, results in `docs/QA-REPORT.md` with pass/fail per AC. | qa-engineer | T4.1 | to do |
| T4.3 | Paid check (only with the user's yes, question 9): 10 to 20 real entries; measure cost per entry against the $0.02-0.03 estimate, quote verification rate, and one phone-to-computer round trip in each mode. Never print keys. | qa-engineer | T4.2 | to do |
| T4.4 | Verdict: ready or not ready. Any broken secret rule is a blocker and means not ready. | qa-engineer | T4.3 | to do |

## M5. Release notes

| ID | Task | Owner | Depends on | Status |
|---|---|---|---|---|
| T5.1 | Update `README.md` (journal, quotes and their cost, new `.env` names, hide vs delete, honest revision-history note, export, replacing the old privacy text). | frontend-developer | T4.4 | to do |
| T5.2 | Update this schedule and the PRD status; main session commits and pushes. | product-manager | T5.1 | to do |

## Order at a glance

T0.2, then {T1.1, T1.2, T1.3 (AI)} in parallel with {T1.4, T1.5, T1.6 (backend)}, then {T2.1, T2.2, T2.3 (backend)} in parallel with {T2.4 then T2.5, T2.6 (frontend)}, then T3.1, then fixes, then QA, then README.
