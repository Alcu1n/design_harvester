import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalize,
  publicIP,
  resolvePublic,
  sameOrigin,
} from "../src/security.ts";
import {
  eligible,
  AnalysisSchema,
  IOSSchema,
  iosSections,
  type Evidence,
} from "../src/contracts.ts";
import {
  renderDesign,
  lintDesign,
  validateAnalysis,
  tokens,
} from "../src/render.ts";
import { parseResponse, cliSettings } from "../src/model.ts";
import { evidence, analysis } from "./fixtures.ts";
test("canonical URL preserves meaningful queries and distinct paths", () => {
  assert.equal(
    canonicalize("https://EXAMPLE.com#hero"),
    "https://example.com/",
  );
  assert.notEqual(
    canonicalize("https://example.com/?theme=dark"),
    canonicalize("https://example.com/?theme=light"),
  );
  for (const s of [
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "http://localhost/",
    "https://example.com:8080",
  ])
    assert.throws(() => canonicalize(s));
});
test("blocks IPv4, IPv6, mapped, metadata and special ranges", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "172.16.1.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
  ])
    assert.equal(publicIP(ip), false, ip);
  assert.equal(publicIP("8.8.8.8"), true);
  await assert.rejects(() => resolvePublic("127.0.0.1"));
});
test("mutations require exact origin", () => {
  assert.throws(() =>
    sameOrigin(
      new Request("https://library.local/api/designs", {
        headers: { origin: "https://evil.example" },
      }),
    ),
  );
  sameOrigin(
    new Request("https://library.local/api/designs", {
      headers: { origin: "https://library.local" },
    }),
  );
});
test("renderer uses observed typography and official linter", () => {
  const md = renderDesign(evidence, analysis);
  assert.match(md, /fontSize: 64px/);
  assert.match(md, /fontFamily: Georgia/);
  const report = lintDesign(md);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(validateAnalysis(evidence, analysis), true);
  assert.equal(
    validateAnalysis(evidence, {
      ...analysis,
      signatureTraits: [{ description: "wrong", evidenceIds: ["invented"] }],
    }),
    false,
  );
});
test("quality gate requires complete valid version with no error", () => {
  const c = {
    score: 90,
    subscores: {
      evidenceAccuracy: 90,
      visualFidelity: 90,
      designAbstraction: 90,
      responsiveUnderstanding: 90,
      iosAdaptation: 90,
    },
    issues: [],
  };
  assert.equal(eligible(c, true, true), true);
  assert.equal(eligible(c, false, true), false);
  assert.equal(eligible({ ...c, score: 84 }, true, true), false);
  assert.equal(
    eligible(
      { ...c, issues: [{ severity: "error", message: "hallucination" }] },
      true,
      true,
    ),
    false,
  );
});
test("CLI envelope does not substitute structured validation", () => {
  assert.deepEqual(
    parseResponse(JSON.stringify({ response: '```json\n{"a":1}\n```' })),
    { a: 1 },
  );
  assert.throws(() => parseResponse('{"response":"not json"}'));
  assert.throws(() => parseResponse('{"stats":{}}'));
  assert.deepEqual(cliSettings.tools.core, []);
});
test("iOS sections cannot be duplicated to satisfy length", () => {
  assert.equal(
    IOSSchema.safeParse({
      sections: iosSections.map((heading) => ({
        heading,
        body: "这是一条原生适配建议。",
      })),
    }).success,
    true,
  );
  assert.equal(
    IOSSchema.safeParse({
      sections: iosSections.map(() => ({
        heading: "Colors",
        body: "这是重复的章节。",
      })),
    }).success,
    false,
  );
});

import { classifyCLIError } from "../src/model.ts";
test("CLI startup metrics do not get mistaken for quota or auth errors", () => {
  assert.equal(
    classifyCLIError(
      "",
      '[STARTUP] authenticate duration: 429.123\n{"error":{"type":"ProjectIdRequiredError","code":41}}',
    ).code,
    "MODEL_CONFIGURATION_REQUIRED",
  );
  assert.equal(
    classifyCLIError(
      "",
      "Loaded cached credentials.\n[STARTUP] authenticate duration: 392.23\nSome failure",
    ).code,
    "MODEL_FAILED",
  );
  assert.equal(
    classifyCLIError("", "RESOURCE_EXHAUSTED: quota exhausted").code,
    "QUOTA_EXHAUSTED",
  );
});
