// Loads FridgeChef's settings from .env. The API key stays in this process
// (server side): nothing here sends it to the browser, logs it or writes it.
//
// .env is plain text, one NAME=value per line (see .env.example). Variables
// already set in the environment win over the file, so a key can also be
// passed as OPENROUTER_API_KEY=... node server.mjs without a file.

import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));

export const DEFAULTS = Object.freeze({
  OPENROUTER_VISION_MODEL: "google/gemma-4-26b-a4b-it:free",
  OPENROUTER_TEXT_MODEL: "google/gemma-4-31b-it:free",
  HOST: "127.0.0.1",
  PORT: "8790",
});

/**
 * Parse .env text into { NAME: value }. Pure. Supports comments (#), blank
 * lines, optional "export ", and single or double quotes around a value.
 * Lines that aren't NAME=value are reported, not guessed at.
 * @returns {{ values: Record<string,string>, problems: string[] }}
 */
export function parseEnv(text) {
  const values = {};
  const problems = [];
  String(text)
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) {
        problems.push(`line ${i + 1} isn't NAME=value`);
        return;
      }
      let value = m[2];
      const quoted = /^(["'])(.*)\1$/.exec(value);
      if (quoted) value = quoted[2];
      else value = value.replace(/\s+#.*$/, "").trim(); // trailing comment
      values[m[1]] = value;
    });
  return { values, problems };
}

/** "sk-or-v1-abc…74dd": enough to tell keys apart, useless to anyone else. */
export function maskKey(key) {
  if (typeof key !== "string" || key.length < 12) return "(not set)";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/** Problems with the settings, in plain words (never containing the key). Pure. */
export function checkConfig(config) {
  const problems = [];
  const key = config.OPENROUTER_API_KEY;
  if (!key) problems.push("OPENROUTER_API_KEY is missing. Add it to .env (see .env.example).");
  else {
    if (/\s/.test(key)) problems.push("OPENROUTER_API_KEY contains spaces or line breaks. Copy it again from openrouter.ai/keys.");
    if (!key.startsWith("sk-or-")) problems.push('OPENROUTER_API_KEY doesn\'t look like an OpenRouter key (they start with "sk-or-").');
  }
  for (const name of ["OPENROUTER_VISION_MODEL", "OPENROUTER_TEXT_MODEL"]) {
    if (!/^[\w.-]+\/[\w.:-]+$/.test(config[name] ?? "")) problems.push(`${name} should look like provider/model, e.g. ${DEFAULTS[name]}`);
  }
  const port = Number(config.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("PORT must be a number from 1 to 65535.");
  if (!["127.0.0.1", "localhost", "::1"].includes(config.HOST)) {
    problems.push("HOST must be 127.0.0.1, localhost or ::1: the server must not be reachable from other computers.");
  }
  return problems;
}

/**
 * Settings from the environment and .env. Returns a frozen config plus any
 * problems and warnings. The key is a non-enumerable property, so printing or
 * JSON.stringify-ing the config can't leak it by accident.
 */
export function loadConfig({ env = process.env, file = ENV_FILE, read = readFileSync, stat = statSync } = {}) {
  const warnings = [];
  let fromFile = {};
  let fileProblems = [];
  try {
    ({ values: fromFile, problems: fileProblems } = parseEnv(read(file, "utf8")));
    // Group or world readable: other users on this computer could read the key.
    const mode = stat(file).mode & 0o777;
    if (mode & 0o077) warnings.push(`.env can be read by other users (permissions ${mode.toString(8)}). Fix: chmod 600 .env`);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    if (!env.OPENROUTER_API_KEY) warnings.push(".env not found. Copy .env.example to .env and add your key.");
  }
  if (fileProblems.length) warnings.push(`.env: ${fileProblems.join("; ")}`);

  const pick = (name) => env[name] ?? fromFile[name] ?? DEFAULTS[name];
  const config = {
    OPENROUTER_VISION_MODEL: pick("OPENROUTER_VISION_MODEL"),
    OPENROUTER_TEXT_MODEL: pick("OPENROUTER_TEXT_MODEL"),
    HOST: pick("HOST"),
    PORT: pick("PORT"),
  };
  Object.defineProperty(config, "OPENROUTER_API_KEY", { value: env.OPENROUTER_API_KEY ?? fromFile.OPENROUTER_API_KEY, enumerable: false });
  const problems = checkConfig(config);
  return { config: Object.freeze(config), problems, warnings };
}
