import assert from "node:assert/strict";
import test from "node:test";
import type { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { complete, llmTransport, modelConfiguration } from "../../generate/llm.js";

const openai = { LLM_PROVIDER: "openai", OPENAI_MODEL: "fixture-model", OPENAI_API_KEY: "test-key-only", LLM_TIMEOUT_MS: "1000" };
const deepseek = { LLM_PROVIDER: "deepseek", DEEPSEEK_MODEL: "fixture-deepseek", DEEPSEEK_API_KEY: "test-deepseek-key", LLM_TIMEOUT_MS: "1000" };

test("OpenAI uses the configured model, JSON output, separate system/data messages, and timeout", async (t) => {
  const mock = t.mock.method(llmTransport, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    assert.equal((init!.headers as Record<string, string>).authorization, "Bearer test-key-only");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, "fixture-model");
    assert.deepEqual(body.messages, [{ role: "system", content: "System instructions" }, { role: "user", content: "Source data" }]);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.ok(init!.signal instanceof AbortSignal);
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
  });
  assert.equal(await complete("Source data", { system: "System instructions", env: openai }), '{"ok":true}');
  assert.equal(mock.mock.callCount(), 1);
  assert.ok(!JSON.stringify(modelConfiguration(openai)).includes(openai.OPENAI_API_KEY));
});

test("DeepSeek uses its endpoint, credentials, configured model, JSON output, and token limit", async (t) => {
  const mock = t.mock.method(llmTransport, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(init!.method, "POST");
    assert.equal((init!.headers as Record<string, string>).authorization, "Bearer test-deepseek-key");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, "fixture-deepseek");
    assert.deepEqual(body.messages, [{ role: "system", content: "Return JSON" }, { role: "user", content: "Source data" }]);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.max_tokens, 8192);
    assert.equal(body.max_completion_tokens, undefined);
    assert.ok(init!.signal instanceof AbortSignal);
    return Response.json({ choices: [{ message: { content: '{"ok":true}', reasoning_content: "Not the result" } }] });
  });
  assert.equal(await complete("Source data", { system: "Return JSON", env: { ...openai, ...deepseek } }), '{"ok":true}');
  assert.equal(mock.mock.callCount(), 1);
  assert.deepEqual(modelConfiguration(deepseek), { provider: "deepseek", model: "fixture-deepseek", timeoutMs: 1000 });
});

test("Anthropic is explicit, configured, and joins text blocks", async (t) => {
  t.mock.method(llmTransport, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal((init!.headers as Record<string, string>)["x-api-key"], "test-anthropic-key");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, "fixture-anthropic");
    assert.equal(body.system, "System");
    return Response.json({ content: [{ type: "text", text: '{"ok":' }, { type: "text", text: 'true}' }] });
  });
  assert.equal(await complete("Input", { system: "System", env: {
    LLM_PROVIDER: "anthropic", ANTHROPIC_MODEL: "fixture-anthropic", ANTHROPIC_API_KEY: "test-anthropic-key",
  } }), '{"ok":true}');
});

test("Bedrock uses the configured model/region and destroys its client", async (t) => {
  let destroyed = false;
  t.mock.method(llmTransport, "bedrock", (region: string) => {
    assert.equal(region, "us-gov-west-1");
    return { send: async (command: ConverseCommand, options: { abortSignal: AbortSignal }) => {
      assert.equal(command.input.modelId, "fixture-bedrock");
      assert.deepEqual(command.input.system, [{ text: "System" }]);
      assert.ok(options.abortSignal instanceof AbortSignal);
      return { output: { message: { content: [{ text: '{"ok":' }, { text: 'true}' }] } } };
    }, destroy: () => { destroyed = true; } } as unknown as BedrockRuntimeClient;
  });
  assert.equal(await complete("Input", { system: "System", env: {
    LLM_PROVIDER: "bedrock", BEDROCK_MODEL_ID: "fixture-bedrock", AWS_REGION: "us-gov-west-1",
  } }), '{"ok":true}');
  assert.equal(destroyed, true);
});

test("missing or invalid configuration never initiates a request", async (t) => {
  const http = t.mock.method(llmTransport, "fetch", async () => { throw new Error("Unexpected request"); });
  const bedrock = t.mock.method(llmTransport, "bedrock", () => { throw new Error("Unexpected client"); });
  for (const env of [
    {}, { LLM_PROVIDER: "unknown" }, { ...openai, OPENAI_API_KEY: "" },
    { ...openai, OPENAI_MODEL: "" }, { ...openai, LLM_TIMEOUT_MS: "0" },
    { ...deepseek, DEEPSEEK_API_KEY: "" }, { ...deepseek, DEEPSEEK_MODEL: "" },
    { LLM_PROVIDER: "bedrock", BEDROCK_MODEL_ID: "fixture-bedrock" },
  ]) await assert.rejects(complete("Input", { env }));
  assert.equal(http.mock.callCount(), 0);
  assert.equal(bedrock.mock.callCount(), 0);
});

test("provider errors do not echo response secrets or silently switch providers", async (t) => {
  const http = t.mock.method(llmTransport, "fetch", async () => new Response("secret-response-marker", { status: 401 }));
  const other = t.mock.method(llmTransport, "bedrock", () => { throw new Error("Unexpected fallback"); });
  await assert.rejects(complete("Input", { env: openai }), (error: Error) =>
    /HTTP 401/.test(error.message) && !error.message.includes("secret-response-marker"));
  assert.equal(http.mock.callCount(), 1);
  assert.equal(other.mock.callCount(), 0);
});

test("DeepSeek rejects failed, empty, truncated, malformed, and interrupted responses", async (t) => {
  const responses = [
    new Response("secret-response-marker", { status: 401 }),
    Response.json({ choices: [{ message: { content: "", reasoning_content: "Reasoning alone is not output" } }] }),
    Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }),
    new Response("secret-response-marker", { status: 200 }),
  ];
  const mock = t.mock.method(llmTransport, "fetch", async () => {
    const response = responses.shift();
    if (!response) throw new Error("secret-transport-marker");
    return response;
  });
  for (const expected of [/deepseek returned HTTP 401/, /deepseek returned no text/, /deepseek output was truncated/, /deepseek returned an invalid JSON/, /deepseek request failed/]) {
    await assert.rejects(complete("Return JSON", { env: deepseek }), (error: Error) =>
      expected.test(error.message) && !error.message.includes("secret-"));
  }
  assert.equal(mock.mock.callCount(), 5);
});

test("empty, truncated, and malformed provider results fail clearly", async (t) => {
  const responses = [
    Response.json({ choices: [] }),
    Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }),
    new Response("not-json-secret-marker", { status: 200 }),
  ];
  t.mock.method(llmTransport, "fetch", async () => responses.shift()!);
  await assert.rejects(complete("Input", { env: openai }), /no text/);
  await assert.rejects(complete("Input", { env: openai }), /truncated/);
  await assert.rejects(complete("Input", { env: openai }), (error: Error) =>
    /invalid JSON/.test(error.message) && !error.message.includes("secret-marker"));
});
