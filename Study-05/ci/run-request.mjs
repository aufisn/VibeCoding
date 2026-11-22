#!/usr/bin/env node
// Empathy diary's GitHub job: answers one request from the web page.
//
//   1. reads req-<id>.enc from the secret Gist and decrypts it: { type: "reflect", text }
//   2. checks the text (DiaryCore.checkEntry) and asks Claude (createClaude in claude.mjs)
//   3. appends the finished entry to the encrypted journal (journal-YYYY-MM.enc, read back to
//      verify); a journal problem never blocks the answer, it only sets saved: false
//   4. writes the answer, encrypted, as res-<id>.enc ({ ok, result, saved, entryId, entry, saveError? })
//      and deletes the request
//   5. deletes mailbox files older than a day (the Gist is shared with FridgeChef;
//      only req-/res- files with valid IDs are touched)
//
// Settings come from environment variables (GitHub Actions secrets):
//   ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID (optional),
//   FC_PASSPHRASE, FC_GIST_ID, FC_GIST_TOKEN, REQUEST_ID
//
// The repository is public, so its Actions logs are too: this script prints
// only progress words and plain errors, never the diary text, the answer or
// any secret.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { decryptJson, encryptJson } from "../web/fc-crypto.mjs";
import { createJournal, entryFromResult as journalEntryFromResult } from "../web/journal.mjs";
import { createGistClient, isRequestId, requestFile, resultFile, staleFiles } from "../web/mailbox.mjs";
import { createClaude } from "../claude.mjs";

const Core = createRequire(import.meta.url)("../diary-core.js");

const SECRET_NAMES = ["ANTHROPIC_API_KEY", "FC_PASSPHRASE", "FC_GIST_ID", "FC_GIST_TOKEN"];

/** Names of the settings that are missing. Pure. */
export function missingSettings(env) {
  return [...SECRET_NAMES, "REQUEST_ID"].filter((n) => !env[n]);
}

/** One decrypted request → the answer object { ok, result, text } or throws a plain Error. */
async function handleRequest(claude, request) {
  if (!request || typeof request !== "object" || request.type !== "reflect") throw Object.assign(new Error("Unknown request type."), { plain: true });
  const text = Core.checkEntry(request.text); // throws a friendly Error (status 400)
  return { ok: true, result: Core.parseResult(await claude.reflect(Core.buildRequestBody(text))), text };
}

/** The journal entry for a finished reflection (mode "github"). */
export const entryFromResult = (o) => journalEntryFromResult({ ...o, mode: "github" });

/**
 * Answers one request. `gist` and `claude` can be fakes in tests.
 * @returns {{ ok: boolean, message: string }}
 */
export async function runRequest({ id, passphrase, gist, claude, journal, now = () => Date.now(), log = console.log }) {
  if (!isRequestId(id)) return { ok: false, message: "The request ID isn't in the diary's format." };

  log("Reading the request from the Gist…");
  const files = await gist.files();
  const file = files[requestFile(id)];
  if (!file) return { ok: false, message: "That request isn't in the Gist (already answered, or never sent)." };

  let answer;
  try {
    const request = await decryptJson(await gist.text(file), passphrase);
    log("Asking Claude…");
    answer = await handleRequest(claude, request);
  } catch (err) {
    // Plain messages only: checkEntry, createClaude, parseResult and decryption never include secrets.
    const plain = err.plain || Number.isInteger(err.status) || /decrypt|passphrase|diary file/.test(err.message);
    answer = { ok: false, error: plain ? String(err.message) : "Something went wrong in the GitHub job." };
  }

  let saveInfo = {};
  if (answer.ok) {
    log("Saving to the journal…");
    const entry = entryFromResult({ id, text: answer.text, result: answer.result, createdAt: new Date(now()).toISOString() });
    try {
      journal ??= createJournal({ gist, passphrase });
      const r = await journal.append(entry);
      saveInfo = { saved: true, entryId: r.entryId, entry }; // the full entry goes back either way, so the page needn't keep the text
    } catch (err) {
      // JournalError messages are plain (no token, no passphrase); anything else gets a generic line.
      const plain = err?.name === "JournalError" ? err.message : "The journal could not be saved.";
      saveInfo = { saved: false, entryId: id, saveError: plain, entry };
      log("The journal was not saved.");
    }
    delete answer.text;
  }

  log("Saving the encrypted answer…");
  const changes = { [resultFile(id)]: await encryptJson({ id, finishedAt: new Date(now()).toISOString(), ...answer, ...saveInfo }, passphrase), [requestFile(id)]: null };
  for (const old of staleFiles(Object.keys(files), now())) if (!(old in changes)) changes[old] = null;
  await gist.write(changes);
  return { ok: answer.ok, saved: saveInfo.saved, message: answer.ok ? (saveInfo.saved ? "Done." : "Done (journal not saved).") : `Answered with an error: ${answer.error}` };
}

async function main(env) {
  const missing = missingSettings(env);
  if (missing.length) {
    console.error(`✖ Missing settings: ${missing.join(", ")}. Add them as repository secrets (see Study-04/README.md).`);
    process.exit(1);
  }
  const gist = createGistClient({ token: env.FC_GIST_TOKEN, gistId: env.FC_GIST_ID });
  const claude = createClaude({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID || undefined, ci: true });
  try {
    const result = await runRequest({ id: env.REQUEST_ID, passphrase: env.FC_PASSPHRASE, gist, claude });
    console.log(result.ok ? `✔ ${result.message}` : `✖ ${result.message}`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (err) {
    console.error(`✖ ${err.name === "GitHubError" ? err.message : "The job failed before it could answer."}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.env);
}
