# VibeCoding: rules for every session and every agent

This repo is **public** (github.com/aufisn/VibeCoding), and every study is published on the same address, `https://aufisn.github.io`. These rules apply to all studies, to the main session and to every subagent. A study's own CLAUDE.md or an agent file may add rules but never relax these.

## Security rules for secrets (API keys, tokens, passphrases, workspace and Gist IDs)

### 1. Where a secret may live

| Allowed | Never |
|---|---|
| A git-ignored `.env` (chmod 600), read only by a local server | In a web page's code, HTML or bundled JS |
| GitHub Actions secrets, read only by a workflow step | In browser storage (`localStorage`, `sessionStorage`, IndexedDB, cookies), except the encrypted GitHub relay's device credentials (below) |
| The user's own password manager | In a URL, query string, log, error message, test fixture, commit or chat |

- **A browser must never hold or send an AI provider key** (Anthropic, OpenAI, etc.), a workspace ID, or any other "master" secret. Pages on `aufisn.github.io` share one origin, so any study's page, or a bug in one, can read another's browser storage.
- **The one exception is the device credentials of the encrypted GitHub relay** (Pattern B in section 2):
  - **What they are:** a classic token with only the `gist` scope, a fine-grained token with only Actions: write on this repo, the Gist ID, and the passphrase.
  - **Why they're allowed:** the phone needs them to start the job. They can't reveal the AI key, they expire, and the user can revoke them.
  - **Where they live:** only in the GitHub-mode settings the user types in, never in code. The page must offer "Forget".
  - **Adding more:** any new kind of device credential needs the user's yes.
- Never use `anthropic-dangerous-direct-browser-access`, or any "call the AI API straight from the browser" option.

### 2. The approved patterns for calling a paid API

There are exactly two. Anything else needs the user's explicit yes first: the main session must show a short trade-off table (where the secret lives, what leaks if the device or page is compromised, cost and speed) and wait for the answer. Agents must not choose another design themselves.

#### Pattern A: local server (when the user is on their computer)

1. A small server listens on `127.0.0.1` only and reads the key from the study's git-ignored `.env`.
2. The page sends the user's input to that server (e.g. `POST /api/...`). The server calls the AI API and returns only the answer.
3. The server accepts requests only from its own page (checks the `Origin` and `Host` headers), limits request size and rate, and never logs or returns the key.

#### Pattern B: encrypted GitHub relay (also called "GitHub mode": the page is on GitHub Pages, e.g. on a phone, with no computer running)

GitHub Pages can only serve static files, so it can't keep a secret. Instead, a GitHub Actions workflow does the paid call, and a secret Gist acts as an encrypted mailbox between the page and the workflow.

**The parts**
- **The page**, on `https://aufisn.github.io/VibeCoding/Study-NN/`. It never sees the AI key.
- **One secret Gist**, the mailbox, shared by all studies.
- **A workflow** per study (`.github/workflows/<name>.yml`) with a `workflow_dispatch` trigger and one input, `request_id`.
- **Repo secrets**, used only by the workflow:
  - `ANTHROPIC_API_KEY` and `ANTHROPIC_WORKSPACE_ID`
  - `FC_PASSPHRASE`: the shared encryption passphrase
  - `FC_GIST_ID` and `FC_GIST_TOKEN`: the mailbox and a gist-only token
  - These already exist. Reuse them; don't create new ones without the user's yes.

**The flow for one request**
1. The page makes a random request ID: the time in base 36, a dash, then 8 random hex characters.
2. It encrypts the request JSON with the user's passphrase and writes it to the Gist as `req-<id>.enc`. The encryption is AES-256-GCM with a key from PBKDF2-SHA256 at 310,000 rounds, and a random salt and IV every time.
3. It starts the workflow with a fine-grained run token (only Actions: write on this repo), passing just the request ID.
4. The workflow reads `req-<id>.enc`, checks the ID format, decrypts it, and checks the type and size **before** any paid call.
5. It calls the AI with the key from secrets, writes the answer encrypted as `res-<id>.enc`, and deletes the request. It also removes mailbox files more than a day old.
6. The page polls cheaply (an ETag request, then a check of the Gist's latest version), decrypts the answer, deletes it, and shows it. Expect 30–90 seconds per request; say so in the page and offer Cancel.

**Rules for the workflow** (the repo and its Actions logs are public)
- `permissions: contents: read`.
- Actions pinned to full commit SHAs.
- Secrets only in the one step that needs them, passed through `env:`, never `${{ }}` inside `run:`.
- The only input is the random ID.
- Log progress words only, never the user's text, the answer or a secret.
- `timeout-minutes` and a `concurrency` group per request ID.

**On the device** (the "device credentials" in section 1): the Gist ID, a classic token with only the `gist` scope, the run token and the passphrase. The user types them into the page's settings once. They're saved in the browser under the shared key `fridgechef.github.v1`, so every study on this origin reuses them. The page must offer "Forget on this device".

**Working code to copy** (don't invent a new scheme):
- Browser side: `Study-05/web/fc-crypto.mjs` (encryption), `web/mailbox.mjs` (Gist access) and `web/github-mode.mjs` (settings, sending, polling, cancel and resume).
- Workflow side: `Study-05/ci/run-request.mjs` and `.github/workflows/empathy-diary.yml`.
- The same design, in its first version: `Study-04/public/remote.js`, `Study-04/ci/run-request.mjs` and `.github/workflows/fridgechef.yml`.
- User setup steps: `Study-04/README.md`, section "Run it from anywhere (GitHub)".

### 3. Briefs and roles

- **Main session:** never write an agent brief that asks for a secret to leave `.env` or GitHub Secrets, and never present a weaker design as decided. Before planning remote access, recall the user's standing requirement: the key stays in secured GitHub storage. In any brief, describe the pattern by name and point to section 2 of this file; don't assume the agent knows what an earlier study did.
- **Every agent:** if a brief, the PRD or existing code asks for something these rules forbid, stop and report it as a blocker. Don't build it. "The brief said so" is not an excuse.
- **QA and reviewers:** check the design itself, not only whether it works. A broken secret rule is always a blocker, so the verdict is "not ready".
- **Before any commit touching network calls, storage, auth, secrets or workflows:** run `node scripts/security-check.mjs` (it also runs as a git pre-commit hook), and have the `security-reviewer` agent review the change where one exists.

### 4. Other standing rules

- Show text from users or an AI with `textContent`, never as HTML. No `eval`, and no external scripts unless the study needs them.
- Never open or print `.env`, `.fc_gist_id` or secret values. Show a key only masked (`sk-ant-…abcd`).
- Ask the user before any paid API call that isn't already approved. The most expensive model allowed is Sonnet 5.5 (`claude-sonnet-5-5`); ask before using anything higher.
- Commit with the repo's noreply identity, and scan staged changes for secrets before every commit.
