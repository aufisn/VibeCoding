import { test } from "node:test";
import assert from "node:assert/strict";

import { costOf, createClaudeClient, describeClaudeError, INGREDIENTS_SCHEMA } from "../server/claude.mjs";
import { loadConfig, checkConfig } from "../server/config.mjs";

const FAKE_ANTHROPIC = "sk-ant-api03-TESTKEY000000000000000000000000000000000000000000000000000000abcd";
const FAKE_OPENROUTER = "sk-or-v1-TESTKEY0000000000000000000000000000000000000000000000000000wxyz";

/** A stand-in for the Anthropic SDK that records requests and returns `reply`. */
function fakeSdk(reply) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          if (reply instanceof Error) throw reply;
          return { model: params.model, stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 500 }, ...reply };
        },
      },
    },
    models: { retrieve: async (id) => ({ id, display_name: "Claude Sonnet 5.5" }) },
  };
}

test("identifyIngredients sends the photo with a strict JSON schema and parses the answer", async () => {
  const answer = { ingredients: [{ name: "eggs", quantity: "4", confidence: "high" }], notes: "" };
  const sdk = fakeSdk({ content: [{ type: "text", text: JSON.stringify(answer) }] });
  const claude = createClaudeClient({ sdk, model: "claude-sonnet-5-5" });
  const result = await claude.identifyIngredients({ base64: "iVBORw0KGgo=", mediaType: "image/png" });

  assert.deepEqual(result.ingredients, answer.ingredients);
  const req = sdk.calls[0];
  assert.equal(req.model, "claude-sonnet-5-5");
  assert.deepEqual(req.messages[0].content[0], { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } });
  assert.deepEqual(req.output_config.format, { type: "json_schema", schema: INGREDIENTS_SCHEMA });
  assert.equal(req.fallbacks, "default");
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(req.temperature, undefined, "Sonnet 5.5 rejects non-default sampling settings");
  assert.equal(req.thinking, undefined, "adaptive thinking is the default");
  assert.equal(result.cost, (1000 * 2 + 500 * 10) / 1e6);
});

test("image URLs must be https; unknown image types are refused", async () => {
  const claude = createClaudeClient({ sdk: fakeSdk({ content: [{ type: "text", text: "{}" }] }) });
  await assert.rejects(claude.identifyIngredients({ url: "http://x/y.jpg" }), /https/);
  await assert.rejects(claude.identifyIngredients({ base64: "x", mediaType: "image/bmp" }), /Unsupported image type/);
  const sdk = fakeSdk({ content: [{ type: "text", text: '{"ingredients":[],"notes":""}' }] });
  await createClaudeClient({ sdk }).identifyIngredients({ url: "https://example.org/f.jpg" });
  assert.deepEqual(sdk.calls[0].messages[0].content[0].source, { type: "url", url: "https://example.org/f.jpg" });
});

test("writeRecipe returns the text; refusals and cut-off answers become plain errors", async () => {
  const ok = createClaudeClient({ sdk: fakeSdk({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Omelette\nIngredients: ..." }] }) });
  assert.match((await ok.writeRecipe(["eggs", "milk"])).text, /^Omelette/);
  const refused = createClaudeClient({ sdk: fakeSdk({ stop_reason: "refusal", content: [] }) });
  await assert.rejects(refused.writeRecipe("eggs"), /declined/);
  const cut = createClaudeClient({ sdk: fakeSdk({ stop_reason: "max_tokens", content: [{ type: "text", text: "half" }] }) });
  await assert.rejects(cut.writeRecipe("eggs"), /cut off/);
});

test("API errors become plain messages that never contain the key", async () => {
  const err = Object.assign(new Error(`invalid x-api-key ${FAKE_ANTHROPIC}`), { status: 401 });
  const claude = createClaudeClient({ sdk: fakeSdk(err) });
  await assert.rejects(claude.writeRecipe("eggs"), (e) => {
    assert.match(e.message, /refused the API key/);
    assert.ok(!e.message.includes(FAKE_ANTHROPIC));
    return true;
  });
  assert.match(describeClaudeError({ status: 529 }), /overloaded/);
  assert.match(describeClaudeError({ status: 503 }), /server error/);
});

test("costOf uses per-model prices", () => {
  assert.equal(costOf("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 12);
  assert.equal(costOf("unknown-model", { input_tokens: 1 }), null);
});

/* ---------- Provider selection ---------- */

const load = (text, env = {}) => loadConfig({ env, read: () => text, stat: () => ({ mode: 0o100600 }) });

test("an Anthropic key selects Claude; otherwise OpenRouter; AI_PROVIDER overrides", () => {
  assert.equal(load(`ANTHROPIC_API_KEY=${FAKE_ANTHROPIC}\nOPENROUTER_API_KEY=${FAKE_OPENROUTER}\n`).config.AI_PROVIDER, "anthropic");
  assert.equal(load(`OPENROUTER_API_KEY=${FAKE_OPENROUTER}\n`).config.AI_PROVIDER, "openrouter");
  assert.equal(load(`ANTHROPIC_API_KEY=${FAKE_ANTHROPIC}\nOPENROUTER_API_KEY=${FAKE_OPENROUTER}\nAI_PROVIDER=openrouter\n`).config.AI_PROVIDER, "openrouter");
  const { config, problems } = load(`ANTHROPIC_API_KEY=${FAKE_ANTHROPIC}\n`);
  assert.deepEqual(problems, []);
  assert.equal(config.ANTHROPIC_MODEL, "claude-sonnet-5-5");
  assert.ok(!JSON.stringify(config).includes("TESTKEY"), "neither key is visible when printed");
});

test("checkConfig catches a wrong Anthropic key or model", () => {
  const base = { AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: FAKE_ANTHROPIC, ANTHROPIC_MODEL: "claude-sonnet-5-5", HOST: "127.0.0.1", PORT: "8790" };
  assert.deepEqual(checkConfig(base), []);
  assert.match(checkConfig({ ...base, ANTHROPIC_API_KEY: "" }).join(), /ANTHROPIC_API_KEY is missing/);
  assert.match(checkConfig({ ...base, ANTHROPIC_API_KEY: FAKE_OPENROUTER }).join(), /should start with "sk-ant-"/);
  assert.match(checkConfig({ ...base, ANTHROPIC_MODEL: "gpt-5" }).join(), /ANTHROPIC_MODEL/);
  assert.match(checkConfig({ ...base, AI_PROVIDER: "other" }).join(), /AI_PROVIDER/);
});

test("a key without a workspace gets a clear fix; ANTHROPIC_WORKSPACE_ID is checked", () => {
  const err = { status: 400, error: { error: { message: "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header" } } };
  assert.match(describeClaudeError(err), /ANTHROPIC_WORKSPACE_ID/);
  assert.match(describeClaudeError({ status: 400 }), /couldn't use the request/);
  const base = { AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: FAKE_ANTHROPIC, ANTHROPIC_MODEL: "claude-sonnet-5-5", HOST: "127.0.0.1", PORT: "8790" };
  assert.deepEqual(checkConfig({ ...base, ANTHROPIC_WORKSPACE_ID: "wrkspc_01AbC" }), []);
  assert.match(checkConfig({ ...base, ANTHROPIC_WORKSPACE_ID: "my workspace" }).join(), /wrkspc_/);
});
