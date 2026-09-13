import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { DeepSeekProvider, deepseekHTTPError } from "../src/deepseek.ts";
import { ModelConfigSchema } from "../src/model-config.ts";
const schema = z.object({ name: z.string() });
test("DeepSeek sends JSON mode without tools and validates the business schema", async () => {
  const old = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-only";
  try {
    const mock: typeof fetch = async (url, options) => {
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      const body = JSON.parse(options!.body as string);
      assert.equal(body.model, "deepseek-flash");
      assert.equal(body.response_format.type, "json_object");
      assert.equal(body.tools, undefined);
      assert.ok(body.messages[1].content[0].text.includes('"schema"'));
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"name":"测试"}' } }] });
    };
    assert.deepEqual(await new DeepSeekProvider(undefined, mock, async () => "test-only").generate(schema, "描述", {}), { name: "测试" });
    for (const choice of [
      { finish_reason: "length", message: { content: '{"name":"test"}' } },
      { finish_reason: "stop", message: { content: '{"name":1}' } },
      { finish_reason: "stop", message: { content: '{}', tool_calls: [{}] } },
    ]) {
      await assert.rejects(new DeepSeekProvider(undefined, async () => Response.json({ choices: [choice] }), async () => "test-only").generate(schema, "", {}), { code: "MODEL_SCHEMA_INVALID" });
    }
    await assert.rejects(new DeepSeekProvider(undefined, async () => new Response("secret echoed upstream", { status: 401 }), async () => "test-only").generate(schema, "", {}), (e: any) => e.code === "AUTH_REQUIRED" && !e.message.includes("secret"));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(new DeepSeekProvider(undefined, async () => { throw Error("abort"); }, async () => "test-only").generate(schema, "", {}, [], controller.signal), { code: "CANCELED" });
  } finally { if (old === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = old; }
});
test("DeepSeek auth, balance and throttling pause without a provider fallback", () => {
  assert.equal(deepseekHTTPError(401, null).code, "AUTH_REQUIRED");
  assert.equal(deepseekHTTPError(402, null).retryAt, undefined);
  assert.equal(deepseekHTTPError(402, null).code, "QUOTA_EXHAUSTED");
  assert.ok(deepseekHTTPError(429, "10").retryAt!.getTime() > Date.now());
  assert.equal(deepseekHTTPError(429, "invalid").retryAt, undefined);
  assert.equal(deepseekHTTPError(503, null).code, "MODEL_FAILED");
  assert.equal(ModelConfigSchema.safeParse({ provider: "deepseek", model: "deepseek-flash", apiKey: "not-allowed" }).success, false);
  assert.equal(ModelConfigSchema.safeParse({ provider: "unknown", model: "x" }).success, false);
});
