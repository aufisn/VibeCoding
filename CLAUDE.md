# VibeCoding: rules for every session and every agent

This repo is **public** (github.com/aufisn/VibeCoding), and every study is published on the same address, `https://aufisn.github.io`. These rules apply to all studies, to the main session and to every subagent. A study's own CLAUDE.md or an agent file may add rules but never relax these.

## Security rules for secrets (API keys, tokens, passphrases, workspace and Gist IDs)

### 1. Where a secret may live

| Allowed | Never |
|---|---|
| A git-ignored `.env` (chmod 600), read only by a local server | In a web page's code, HTML or bundled JS |
| GitHub Actions secrets, read only by a workflow step | In browser storage (`localStorage`, `sessionStorage`, IndexedDB, cookies), except GitHub mode's device credentials (below) |
| The user's own password manager | In a URL, query string, log, error message, test fixture, commit or chat |

- **A browser must never hold or send an AI provider key** (Anthropic, OpenAI, etc.), a workspace ID, or any other "master" secret. Pages on `aufisn.github.io` share one origin, so any study's page, or a bug in one, can read another's browser storage.
- **The one exception is GitHub mode's device credentials:**
  - **What they are:** a classic token with only the `gist` scope, a fine-grained token with only Actions: write on this repo, the Gist ID, and the passphrase.
  - **Why they're allowed:** the phone needs them to start the job. They can't reveal the AI key, they expire, and the user can revoke them.
  - **Where they live:** only in the GitHub-mode settings the user types in, never in code. The page must offer "Forget".
  - **Adding more:** any new kind of device credential needs the user's yes.
- Never use `anthropic-dangerous-direct-browser-access`, or any "call the AI API straight from the browser" option.

### 2. The approved patterns for calling a paid API

- **Local:** the page talks to a local server on `127.0.0.1`. The server reads the key from `.env` and checks Origin and Host.
- **Remote (GitHub Pages, phone, no laptop):** the Study-04 "GitHub mode" pattern. The page encrypts the request (AES-256-GCM, PBKDF2) into the secret Gist and starts a workflow. The workflow holds the key in GitHub Secrets, answers into the Gist encrypted, and only the page can decrypt it. Reuse Study-04's code and secrets instead of inventing a new scheme.
- **Anything else needs the user's explicit yes first.** The main session must show a short trade-off table (where the secret lives, what leaks if the device or page is compromised, cost and speed) and wait for the answer. Agents must not choose it themselves.

### 3. Briefs and roles

- **Main session:** never write an agent brief that asks for a secret to leave `.env` or GitHub Secrets, and never present a weaker design as decided. Before planning remote access, recall the user's standing requirement: the key stays in secured GitHub storage.
- **Every agent:** if a brief, the PRD or existing code asks for something these rules forbid, stop and report it as a blocker. Don't build it. "The brief said so" is not an excuse.
- **QA and reviewers:** check the design itself, not only whether it works. A broken secret rule is always a blocker, so the verdict is "not ready".
- **Before any commit touching network calls, storage, auth, secrets or workflows:** run `node scripts/security-check.mjs` (it also runs as a git pre-commit hook), and have the `security-reviewer` agent review the change where one exists.

### 4. Other standing rules

- Show text from users or an AI with `textContent`, never as HTML. No `eval`, and no external scripts unless the study needs them.
- Never open or print `.env`, `.fc_gist_id` or secret values. Show a key only masked (`sk-ant-…abcd`).
- Ask the user before any paid API call that isn't already approved. The most expensive model allowed is Sonnet 5.5 (`claude-sonnet-5-5`); ask before using anything higher.
- Commit with the repo's noreply identity, and scan staged changes for secrets before every commit.
