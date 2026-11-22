// Empathy diary encryption (same as FridgeChef's), used by the web page (browser) and the GitHub job
// (Node): the same file runs in both, through the standard Web Crypto API.
//
// AES-256-GCM with a key made from your passphrase by PBKDF2-SHA256
// (310,000 rounds, random salt). Same envelope format as Market Agent:
//   {"v":1,"kdf":"PBKDF2-SHA256","iter":310000,"salt":"…","iv":"…","ct":"…"}
// Anything stored in the Gist is an envelope like this, so the Gist on its own
// (or GitHub's public Actions logs) never shows a diary entry.

const ITERATIONS = 310_000;
const subtle = () => globalThis.crypto.subtle;

/** Bytes → base64, in chunks so big photos don't overflow the call stack. */
export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function keyFor(passphrase, salt, iterations, usage) {
  if (!passphrase) throw new Error("The passphrase is missing.");
  const base = await subtle().importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, [usage]);
}

/** Encrypts any JSON-able value; returns the envelope as a JSON string. */
export async function encryptJson(value, passphrase) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(passphrase, salt, ITERATIONS, "encrypt");
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return JSON.stringify({ v: 1, kdf: "PBKDF2-SHA256", iter: ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) });
}

/** Decrypts an envelope string. A wrong passphrase or changed data throws. */
export async function decryptJson(envelopeText, passphrase) {
  let env;
  try {
    env = JSON.parse(envelopeText);
  } catch {
    throw new Error("The stored data isn't an encrypted diary file.");
  }
  if (env?.v !== 1 || env.kdf !== "PBKDF2-SHA256" || !Number.isInteger(env.iter) || env.iter < 100_000 || env.iter > 2_000_000) {
    throw new Error("The stored data isn't an encrypted diary file.");
  }
  const key = await keyFor(passphrase, fromBase64(env.salt), env.iter, "decrypt");
  let plain;
  try {
    plain = await subtle().decrypt({ name: "AES-GCM", iv: fromBase64(env.iv) }, key, fromBase64(env.ct));
  } catch {
    throw new Error("Couldn't decrypt: the passphrase is wrong, or the data was changed.");
  }
  return JSON.parse(new TextDecoder().decode(plain));
}
