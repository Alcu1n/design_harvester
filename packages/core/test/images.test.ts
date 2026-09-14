import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { validateImage } from "../src/image-import.ts";
import { ImageEvidenceSchema } from "../src/contracts.ts";
import { modelQuality } from "../src/quality.ts";
import { renderDesign } from "../src/render.ts";
import { analysis } from "./fixtures.ts";
test("uploaded formats are detected from bytes and damaged or oversized images are rejected", async () => {
  const png = await sharp({
    create: { width: 40, height: 60, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  assert.deepEqual(await validateImage(png), {
    width: 40,
    height: 60,
    ext: "png",
  });
  await assert.rejects(() => validateImage(Buffer.from("<svg></svg>")));
  await assert.rejects(() => validateImage(Buffer.alloc(10 * 1024 * 1024 + 1)));
  const huge = await sharp({
    create: { width: 6400, height: 6400, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await assert.rejects(() => validateImage(huge));
});
test("single image grading excludes cross-page consistency and Overview is not business-summary concatenation", () => {
  const e = ImageEvidenceSchema.parse({
    kind: "images",
    schemaVersion: "1.0",
    source: { url: "", finalUrl: "", capturedAt: "now" },
    viewports: [],
    warnings: [],
    images: [
      {
        id: "image-1",
        name: "App",
        path: "one.png",
        preview: "one.webp",
        modelPath: "one.png",
        width: 40,
        height: 60,
        sha256: "hash",
      },
    ],
  });
  const score = modelQuality(
    {
      score: 0,
      subscores: {
        evidenceAccuracy: 80,
        visualFidelity: 80,
        designAbstraction: 80,
        responsiveUnderstanding: 0,
        iosAdaptation: 80,
      },
      issues: [],
    },
    e,
  );
  assert.equal(score.score, 80);
  assert.deepEqual(score.notApplicable, ["responsiveUnderstanding"]);
  const md = renderDesign(e, {
    ...analysis,
    overview: "A quiet, warm interface with a clear reading hierarchy.",
    summary: "A business summary that must not be repeated.",
  });
  assert.match(md, /## Overview\n\nA quiet/);
  assert.doesNotMatch(md, /A business summary/);
  assert.doesNotMatch(md, /fontSize:/);
});
