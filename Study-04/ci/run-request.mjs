#!/usr/bin/env node
// FridgeChef's GitHub job: answers one request from the web page.
//
//   1. reads req-<id>.enc from the secret Gist and decrypts it: a photo to
//      recognize, or an ingredient list and options to cook from
//   2. asks Claude (server/fridgechef.mjs)
//   3. writes the answer, encrypted, as res-<id>.enc and deletes the request
//   4. deletes mailbox files older than a day
//
// Settings come from environment variables (GitHub Actions secrets):
//   ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID (optional), ANTHROPIC_MODEL (optional),
//   FC_PASSPHRASE, FC_GIST_ID, FC_GIST_TOKEN, REQUEST_ID
//
// The repository is public, so its Actions logs are too: this script prints
// only progress words and plain errors, never the photo, the ingredients,
// the recipes or any secret.

import { fileURLToPath } from "node:url";

import { decryptJson, encryptJson } from "../public/fc-crypto.js";
import { createGistClient, isRequestId, requestFile, resultFile, staleFiles } from "../public/mailbox.js";
import { createClaudeClient, DEFAULT_CLAUDE_MODEL } from "../server/claude.mjs";
import { handleRequest } from "../server/fridgechef.mjs";

const SECRET_NAMES = ["ANTHROPIC_API_KEY", "FC_PASSPHRASE", "FC_GIST_ID", "FC_GIST_TOKEN"];

/** Names of the settings that are missing. Pure. */
export function missingSettings(env) {
  return [...SECRET_NAMES, "REQUEST_ID"].filter((n) => !env[n]);
}

/**
 * Answers one request. `gist` and `claude` can be fakes in tests.
 * @returns {{ ok: boolean, message: string }}
 */
export async function runRequest({ id, passphrase, gist, claude, now = () => Date.now(), log = console.log }) {
  if (!isRequestId(id)) return { ok: false, message: "The request ID isn't in FridgeChef's format." };

  log("Reading the request from the Gist…");
  const files = await gist.files();
  const file = files[requestFile(id)];
  if (!file) return { ok: false, message: "That request isn't in the Gist (already answered, or never sent)." };

  let answer;
  try {
    const request = await decryptJson(await gist.text(file), passphrase);
    log("Asking Claude…");
    answer = { ok: true, ...(await handleRequest(claude, request, now)) };
  } catch (err) {
    // Plain messages only: ClaudeError, photo checks and decryption never include secrets.
    const plain = err.name === "ClaudeError" || err.status || /decrypt|passphrase|FridgeChef file/.test(err.message);
    answer = { ok: false, error: plain ? err.message : "Something went wrong in the GitHub job." };
  }

  log("Saving the encrypted answer…");
  const changes = { [resultFile(id)]: await encryptJson({ id, finishedAt: new Date(now()).toISOString(), ...answer }, passphrase), [requestFile(id)]: null };
  for (const old of staleFiles(Object.keys(files), now())) if (!(old in changes)) changes[old] = null;
  await gist.write(changes);
  return { ok: answer.ok, message: answer.ok ? "Done." : `Answered with an error: ${answer.error}` };
}

async function main(env) {
  const missing = missingSettings(env);
  if (missing.length) {
    console.error(`✖ Missing settings: ${missing.join(", ")}. Add them as repository secrets (see Study-04/README.md).`);
    process.exit(1);
  }
  const gist = createGistClient({ token: env.FC_GIST_TOKEN, gistId: env.FC_GIST_ID });
  const claude = createClaudeClient({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL, workspaceId: env.ANTHROPIC_WORKSPACE_ID || undefined });
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
