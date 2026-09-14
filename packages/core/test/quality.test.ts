import test from "node:test";
import assert from "node:assert/strict";
import { fallbackQuality, modelQuality } from "../src/quality.ts";
import { evidence, analysis } from "./fixtures.ts";
import { iosSections } from "../src/contracts.ts";
test("fallback grading is reproducible, conservative and explicit about unassessed semantics", () => {
  const empty = fallbackQuality({ reason: "No document" });
  assert.equal(empty.score, 0);
  assert.equal(
    fallbackQuality({
      evidence: {} as any,
      reason: "Malformed historical evidence",
    }).score,
    0,
  );
  const partial = fallbackQuality({
    analysis,
    evidence,
    markdown: "# Design",
    reason: "Review failed",
  });
  const complete = fallbackQuality({
    analysis,
    evidence,
    markdown: "# Design",
    ios: {
      sections: iosSections.map((heading) => ({
        heading,
        body: "Use native controls.",
      })),
    },
    reason: "Review failed",
  });
  assert.ok(complete.score > partial.score);
  assert.ok(complete.score <= 48);
  assert.equal(complete.subscores.visualFidelity, 0);
  assert.equal(complete.method, "deterministic-completeness-v1");
  assert.equal(
    fallbackQuality({
      analysis: {
        ...analysis,
        signatureTraits: analysis.signatureTraits.map((t) => ({
          ...t,
          evidenceIds: ["invented"],
        })),
      },
      evidence,
      reason: "Review failed",
    }).subscores.evidenceAccuracy,
    0,
  );
});
test("model scores use five equally weighted dimensions, including zero", () => {
  const grade = modelQuality({
    score: 99,
    subscores: {
      evidenceAccuracy: 20,
      visualFidelity: 20,
      designAbstraction: 20,
      responsiveUnderstanding: 20,
      iosAdaptation: 0,
    },
    issues: [],
  });
  assert.equal(grade.score, 16);
});
