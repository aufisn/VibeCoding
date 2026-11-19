import { test } from "node:test";
import assert from "node:assert/strict";

import { extractJson, imageUrlFor, recipePrompt, VISION_PROMPT } from "../scripts/try-models.mjs";

test("extractJson finds JSON in plain, fenced or chatty answers", () => {
  assert.deepEqual(extractJson('{"ingredients":[]}'), { ingredients: [] });
  assert.deepEqual(extractJson('Here you go:\n```json\n{"ingredients":[{"name":"eggs"}]}\n```\nEnjoy!'), { ingredients: [{ name: "eggs" }] });
  assert.deepEqual(extractJson('Sure! {"a":1} hope that helps'), { a: 1 });
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson("{broken"), null);
});

test("imageUrlFor sends local images as base64 data URLs and passes https URLs through", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  assert.equal(await imageUrlFor("a/photo.PNG", async () => png), `data:image/png;base64,${png.toString("base64")}`);
  assert.equal(await imageUrlFor("https://example.org/f.jpg"), "https://example.org/f.jpg");
  await assert.rejects(imageUrlFor("http://example.org/f.jpg"), /Unsupported/, "plain http isn't treated as a URL");
  await assert.rejects(imageUrlFor("notes.txt", async () => png), /Unsupported image type/);
  await assert.rejects(imageUrlFor("big.jpg", async () => Buffer.alloc(6 * 1024 * 1024)), /limit is 5 MB/);
});

test("prompts ask for the agreed formats", () => {
  assert.match(VISION_PROMPT, /JSON only/);
  assert.match(recipePrompt("eggs, milk"), /eggs, milk[\s\S]*Ingredients:[\s\S]*Steps:/);
});
