import { GenerationSchema } from "../src/generation.ts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { sql, pool } from "../src/db.ts";
import {
  createRun,
  detail,
  cancel,
  resume,
  deleteDesign,
  flushDeletions,
} from "../src/service.ts";
import { processTask } from "../src/pipeline.ts";
import { putJSON, put, exists, removeDesign } from "../src/storage.ts";
import {
  AnalysisSchema,
  IOSSchema,
  CriticSchema,
  iosSections,
  HarvestError,
} from "../src/contracts.ts";
import {
  DisplayZhSchema,
  ContentReviewSchema,
  TranslationReviewSchema,
} from "../src/content-checks.ts";
import { evidence, analysis, displayZh } from "./fixtures.ts";
import { extract } from "../src/browser.ts";
import type { DesignModelProvider } from "../src/model.ts";
const enabled = process.env.INTEGRATION === "1";
test(
  "persistent pipeline: checkpoints, revision, default protection, curation, cancel and deletion",
  { skip: !enabled },
  async () => {
    const id = randomUUID(),
      sid = randomUUID();
    await sql(
      "INSERT INTO designs(id,canonical_url,title,notes,tags) VALUES($1,$2,$3,$4,$5)",
      [
        id,
        "https://example.com/integration-" + id,
        "我的名称",
        "用户备注",
        '["个人标签"]',
      ],
    );
    await sql("INSERT INTO snapshots(id,design_id) VALUES($1,$2)", [sid, id]);
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent(
      '<html><body style="font-family:Georgia;background:#fafaf5;padding:24px"><h1 style="font-size:64px">Editorial</h1><p>Visible browser evidence</p></body></html>',
    );
    const extracted = await extract(page, "desktop");
    assert.equal(
      extracted.elements.find((e) => e.tag === "h1")?.styles["font-size"],
      "64px",
    );
    const png = await page.screenshot();
    await browser.close();
    const snapshot = `${id}/snapshots/${sid}`;
    await putJSON(snapshot + "/evidence.json", evidence);
    for (const v of ["desktop", "tablet", "mobile"])
      await put(snapshot + `/screenshots/${v}.png`, png);
    let score = 92,
      failIOS = false,
      shouldCancel = false,
      active = "";
    let analysisCalls = 0;
    const fake: DesignModelProvider = {
      async generate(schema) {
        if (Object.is(schema, ContentReviewSchema))
          return { englishWeb: true, englishIOS: true, issues: [] } as any;
        if (Object.is(schema, DisplayZhSchema)) return displayZh as any;
        if (Object.is(schema, TranslationReviewSchema))
          return { faithful: true, issues: [] } as any;
        if (Object.is(schema, GenerationSchema)) {
          analysisCalls++;
          if (shouldCancel) await cancel(active);
          return { analysis, displayZh } as any;
        }
        if (Object.is(schema, IOSSchema)) {
          if (failIOS)
            throw new HarvestError(
              "IOS_ADAPTER_FAILED",
              "测试中的 iOS 阶段失败",
            );
          return {
            sections: iosSections.map((heading) => ({
              heading,
              body: "Use native iOS behavior and respect Dynamic Type and safe areas.",
            })),
          } as any;
        }
        return {
          score,
          subscores: {
            evidenceAccuracy: score,
            visualFidelity: score,
            designAbstraction: score,
            responsiveUnderstanding: score,
            iosAdaptation: score,
          },
          issues: [],
        } as any;
      },
    };
    try {
      const d = await detail(id);
      const run = await createRun(d.canonical_url, id, sid);
      await processTask(run.runId, fake);
      let result = await detail(id);
      const qualified = result.default_version_id;
      assert.ok(qualified);
      assert.equal(result.tasks[0].status, "READY");
      assert.equal(result.title, "我的名称");
      assert.equal(result.notes, "用户备注");
      score = 60;
      const low = await createRun(d.canonical_url, id, sid);
      await processTask(low.runId, fake);
      result = await detail(id);
      assert.equal(result.default_version_id, result.versions[0].id);
      assert.equal(result.versions[0].quality, "SCORED");
      assert.equal(result.versions[0].score, 60);
      assert.equal(result.tasks[0].status, "READY");
      score = 80;
      const revision = await createRun(d.canonical_url, id, sid);
      const before = analysisCalls;
      await processTask(revision.runId, fake);
      assert.equal(
        analysisCalls - before,
        1,
        "low scores do not cause regeneration",
      );
      score = 94;
      failIOS = true;
      const failed = await createRun(d.canonical_url, id, sid);
      await processTask(failed.runId, fake);
      assert.equal(
        (await sql("SELECT status FROM tasks WHERE id=$1", [failed.runId]))[0]
          .status,
        "READY",
      );
      assert.notEqual((await detail(id)).default_version_id, qualified);
      shouldCancel = true;
      const canceled = await createRun(d.canonical_url, id, sid);
      active = canceled.runId;
      await processTask(canceled.runId, fake);
      assert.equal(
        (await sql("SELECT status FROM tasks WHERE id=$1", [active]))[0].status,
        "CANCELED",
      );
      const held = await pool.connect();
      try {
        await held.query("SELECT pg_advisory_lock(hashtext($1))", [active]);
        await deleteDesign(id);
        await flushDeletions();
        assert.equal(
          await exists(snapshot + "/evidence.json"),
          true,
          "active task lock protects assets even without a fresh heartbeat",
        );
        await assert.rejects(
          () => createRun(d.canonical_url, id, sid),
          /正在删除/,
        );
      } finally {
        await held.query("SELECT pg_advisory_unlock(hashtext($1))", [active]);
        held.release();
      }
      await flushDeletions();
      assert.equal(
        (await sql("SELECT id FROM designs WHERE id=$1", [id])).length,
        0,
      );
      assert.equal(await exists(snapshot + "/evidence.json"), false);
    } finally {
      await sql("DELETE FROM tasks WHERE design_id=$1", [id]);
      await sql("DELETE FROM versions WHERE design_id=$1", [id]);
      await sql("DELETE FROM designs WHERE id=$1", [id]);
      await removeDesign(id);
    }
  },
);

test(
  "browser dismisses safe overlays and stops unlabelled login walls",
  { skip: !process.env.INTEGRATION },
  async () => {
    const { cleanOverlay } = await import("../src/browser.ts");
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const prefix = randomUUID();
    const provider = {
      async generate() {
        throw new Error("No model call expected");
      },
    } as any;
    try {
      await page.setContent(
        '<div role="dialog"><button onclick="this.parentElement.remove()">Reject all</button></div><main>Readable content</main>',
      );
      await cleanOverlay(page, provider, prefix);
      assert.equal(await page.getByRole("dialog").count(), 0);
      await page.setContent(
        '<div style="position:fixed;inset:0;z-index:999;background:white"><h1>登录后继续</h1><button>登录</button></div>',
      );
      await assert.rejects(
        () => cleanOverlay(page, provider, prefix),
        /未发现安全关闭动作/,
      );
      assert.equal(await exists(prefix + "/overlay-0.png"), true);
      await page.setContent(
        '<div role="dialog"><button>Close and login</button></div>',
      );
      await assert.rejects(
        () =>
          cleanOverlay(
            page,
            {
              async generate() {
                return { action: "DISMISS", candidateId: "0" };
              },
            } as any,
            prefix,
          ),
        /不在允许范围/,
      );
      assert.equal(await page.getByRole("dialog").count(), 1);
    } finally {
      await browser.close();
      await removeDesign(prefix);
    }
  },
);

test(
  "responsive fixture preserves fonts, lazy content and complete long screenshots",
  { skip: !process.env.INTEGRATION },
  async () => {
    const { extract, stabilizePage, visualInputs } = await import(
      "../src/browser.ts"
    );
    const { viewports } = await import("../src/contracts.ts");
    const sharp = (await import("sharp")).default;
    const browser = await chromium.launch();
    const prefix = randomUUID();
    try {
      for (const [name, size] of Object.entries(viewports)) {
        const page = await browser.newPage({ viewport: size });
        await page.setContent(
          `<style>@font-face{font-family:FixtureSerif;src:local(Georgia)}body{margin:0;background:rgb(240,240,242);font-family:FixtureSerif,serif}h1{font-size:40px}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}.spacer{height:3200px}@media(max-width:900px){h1{font-size:32px}}@media(max-width:500px){h1{font-size:24px}main{grid-template-columns:1fr}}</style><h1>Responsive fixture</h1><main><section>One</section><section>Two</section></main><div class="spacer"></div><footer id="lazy">Waiting</footer><script>new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting))document.querySelector('#lazy').textContent='Lazy content loaded'}).observe(document.querySelector('#lazy'))</script>`,
        );
        await stabilizePage(page, size.height);
        const e = await extract(page, name as keyof typeof viewports);
        assert.equal(
          e.elements.find((x) => x.tag === "h1")?.styles["font-size"],
          name === "desktop" ? "40px" : name === "tablet" ? "32px" : "24px",
        );
        assert.equal(
          e.elements.find((x) => x.tag === "body")?.styles["background-color"],
          "rgb(240, 240, 242)",
        );
        assert.ok(e.fontFaces?.some((f) => f.family === "FixtureSerif"));
        assert.ok(
          e.elements.some((x) => x.text.includes("Lazy content loaded")),
        );
        const png = await page.screenshot({ fullPage: true });
        const metadata = await sharp(png).metadata();
        assert.equal(metadata.height, e.pageHeight);
        await put(prefix + "/screenshots/" + name + ".png", png);
        await page.close();
      }
      const tiles = await visualInputs(prefix);
      assert.ok(tiles.length > 3);
      for (const file of tiles)
        assert.ok((await sharp(file).metadata()).height! <= 1500);
    } finally {
      await browser.close();
      await removeDesign(prefix);
    }
  },
);

test(
  "model settings persist and generation metadata stays pinned",
  { skip: !enabled },
  async () => {
    const { getModelConfig, saveModelConfig } = await import(
      "../src/model-settings.ts"
    );
    const previous = await getModelConfig();
    let designId: string | undefined;
    try {
      await saveModelConfig({ provider: "deepseek", model: "deepseek-flash" });
      const run = await createRun(`https://example.com/model-${randomUUID()}`);
      designId = run.designId;
      await saveModelConfig({
        provider: "antigravity-cli",
        model: "gemini-3.8-flash-medium",
      });
      const [version] = await sql(
        "SELECT metadata FROM versions WHERE design_id=$1",
        [designId],
      );
      assert.equal(version.metadata.provider, "deepseek");
      assert.equal(version.metadata.model, "deepseek-flash");
      assert.equal((await getModelConfig()).provider, "antigravity-cli");
    } finally {
      await saveModelConfig(previous);
      if (designId) await sql("DELETE FROM designs WHERE id=$1", [designId]);
    }
  },
);

test(
  "saved credentials override files, survive blank updates and never enter public settings",
  { skip: !enabled },
  async () => {
    const {
      getModelConfig,
      saveModelConfig,
      getSavedDeepSeekKey,
      hasSavedDeepSeekKey,
    } = await import("../src/model-settings.ts");
    const { deepseekKey, DeepSeekProvider } = await import(
      "../src/deepseek.ts"
    );
    const { z } = await import("zod");
    const previous = await getModelConfig();
    const key = await getSavedDeepSeekKey();
    try {
      const config = { provider: "deepseek", model: "deepseek-flash" };
      const result = await saveModelConfig({
        ...config,
        deepseekApiKey: " test-credential-one ",
      });
      assert.deepEqual(result, config);
      assert.deepEqual(await getModelConfig(), config);
      assert.equal(await hasSavedDeepSeekKey(), true);
      assert.equal(await deepseekKey(), "test-credential-one");
      await saveModelConfig({ ...config, deepseekApiKey: " " });
      assert.equal(await deepseekKey(), "test-credential-one");
      await saveModelConfig({
        ...config,
        deepseekApiKey: "test-credential-two",
      });
      await new DeepSeekProvider(undefined, async (_, options) => {
        assert.equal(
          new Headers(options?.headers).get("Authorization"),
          "Bearer test-credential-two",
        );
        return Response.json({
          choices: [
            { finish_reason: "stop", message: { content: '{"ok":true}' } },
          ],
        });
      }).generate(z.object({ ok: z.boolean() }), "", {});
      await assert.rejects(
        saveModelConfig({ ...config, deepseekApiKey: "bad\nkey" }),
      );
      assert.equal(await deepseekKey(), "test-credential-two");
    } finally {
      await saveModelConfig(previous);
      if (key) await saveModelConfig({ ...previous, deepseekApiKey: key });
      else await sql("DELETE FROM app_settings WHERE id='deepseek-credential'");
    }
  },
);

after(async () => {
  await pool.end();
});

// Deterministic model fixtures; no real model or NAS acceptance is implied.
async function repairFixture(
  run: (ctx: {
    id: string;
    runId: string;
    versionId: string;
    prefix: string;
    provider: DesignModelProvider;
    calls: Record<string, number>;
    change: (step: string, fn: () => unknown) => void;
    due: () => Promise<void>;
  }) => Promise<void>,
) {
  const created = await createRun(`https://example.com/repair-${randomUUID()}`);
  const [task] = await sql("SELECT * FROM tasks WHERE id=$1", [created.runId]);
  const prefix = `${created.designId}/versions/${task.version_id}`;
  const snap = `${created.designId}/snapshots/${task.snapshot_id}`;
  const sharp = (await import("sharp")).default;
  const png = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await putJSON(snap + "/evidence.json", evidence);
  for (const v of ["desktop", "tablet", "mobile"])
    await put(snap + `/screenshots/${v}.png`, png);
  const calls: Record<string, number> = {};
  const answers: Record<string, () => unknown> = {
    analysis: () => analysis,
    ios: () => ({
      sections: iosSections.map((heading) => ({
        heading,
        body: "Use native iOS conventions, Dynamic Type and safe areas.",
      })),
    }),
    language: () => ({ englishWeb: true, englishIOS: true, issues: [] }),
    translation: () => displayZh,
    translationReview: () => ({ faithful: true, issues: [] }),
    critic: () => ({
      score: 95,
      subscores: {
        evidenceAccuracy: 95,
        visualFidelity: 95,
        designAbstraction: 95,
        responsiveUnderstanding: 95,
        iosAdaptation: 95,
      },
      issues: [],
    }),
  };
  const provider: DesignModelProvider = {
    async generate(schema) {
      const step = Object.is(schema, GenerationSchema)
        ? "analysis"
        : Object.is(schema, IOSSchema)
          ? "ios"
          : Object.is(schema, ContentReviewSchema)
            ? "language"
            : Object.is(schema, DisplayZhSchema)
              ? "translation"
              : Object.is(schema, TranslationReviewSchema)
                ? "translationReview"
                : "critic";
      calls[step] = (calls[step] || 0) + 1;
      const answer = await answers[step]();
      return (
        step === "analysis"
          ? { analysis: answer, displayZh: await answers.translation() }
          : answer
      ) as any;
    },
  };
  try {
    await run({
      id: created.designId,
      runId: created.runId,
      versionId: task.version_id,
      prefix,
      provider,
      calls,
      change: (s, f) => {
        answers[s] = f;
      },
      due: async () => {
        await sql(
          "UPDATE tasks SET retry_at=now()-interval '1 second' WHERE id=$1",
          [created.runId],
        );
      },
    });
  } finally {
    await sql("DELETE FROM designs WHERE id=$1", [created.designId]);
    await removeDesign(created.designId);
  }
}

test(
  "normal pipeline uses exactly three calls and never runs language review",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      c.change("analysis", () => ({
        ...analysis,
        summary: "中文内容需要改进。",
      }));
      c.change("language", () => ({
        englishWeb: false,
        englishIOS: true,
        issues: [
          {
            target: "analysis",
            path: "summary",
            message: "Rewrite in natural English.",
          },
        ],
      }));
      await processTask(c.runId, c.provider);
      const r = await detail(c.id);
      assert.equal(r.tasks[0].status, "READY");
      assert.equal(r.versions[0].score, 95);
      assert.equal(r.versions[0].validation.advisory, true);
      assert.deepEqual(c.calls, { analysis: 1, ios: 1, critic: 1 });
      assert.equal(r.versions[0].display_zh.summary, displayZh.summary);
      assert.equal(r.tasks[0].repair_state.repairs, 0);
      assert.equal(c.calls.ios, 1);
    });
  },
);

test(
  "optional stages fail independently and model grading falls back without blocking completion",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      for (const step of ["ios", "critic"])
        c.change(step, () => {
          throw new HarvestError("MODEL_FAILED", step + " unavailable");
        });
      await processTask(c.runId, c.provider);
      const r = await detail(c.id);
      assert.equal(r.tasks[0].status, "READY");
      assert.equal(
        r.versions[0].metadata.scoringMethod,
        "deterministic-completeness-v1",
      );
      assert.equal(typeof r.versions[0].score, "number");
      assert.ok(r.versions[0].score < 60);
      assert.equal(r.versions[0].display_zh.summary, displayZh.summary);
      for (const step of ["ios", "critic"]) assert.equal(c.calls[step], 3);
      assert.equal(r.versions[0].validation.issues.length, 2);
    });
  },
);

test(
  "missing Chinese output preserves English documents and supports separate generation",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      c.change("translation", () => undefined);
      await processTask(c.runId, c.provider);
      const r = await detail(c.id);
      assert.equal(r.tasks[0].status, "READY");
      assert.equal(r.versions[0].display_zh, null);
      assert.equal(c.calls.analysis, 1);
      assert.equal(c.calls.critic, 1);
      assert.equal(c.calls.translation, undefined);
    });
  },
);

test(
  "legacy Chinese caches are archived and regenerated in English",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      await putJSON(c.prefix + "/analysis.json", {
        ...analysis,
        summary: "历史中文文档。",
      });
      await put(c.prefix + "/DESIGN.md", "historical document");
      await processTask(c.runId, c.provider);
      const { get } = await import("../src/storage.ts");
      assert.equal(
        (await get(c.prefix + "/legacy/DESIGN.md")).toString(),
        "historical document",
      );
      assert.equal(c.calls.analysis, 1);
      assert.equal((await detail(c.id)).tasks[0].status, "READY");
    });
  },
);

test(
  "auth/quota before document creation stay paused and still receive conservative scores",
  { skip: !enabled },
  async () => {
    for (const code of [
      "AUTH_REQUIRED",
      "QUOTA_EXHAUSTED",
      "MODEL_CONFIGURATION_REQUIRED",
    ])
      await repairFixture(async (c) => {
        c.change("analysis", () => {
          throw new HarvestError(code, "测试提供方暂停");
        });
        await processTask(c.runId, c.provider);
        const r = await detail(c.id);
        assert.ok(r.tasks[0].status.startsWith("WAITING_"));
        assert.equal(r.versions[0].score, 0);
        assert.equal(r.default_version_id, null);
        assert.equal(c.calls.ios, undefined);
      });
  },
);

test(
  "auth failure after DESIGN.md avoids further unavailable provider calls and completes with a score",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      c.change("ios", () => {
        throw new HarvestError("AUTH_REQUIRED", "测试登录失效");
      });
      await processTask(c.runId, c.provider);
      const r = await detail(c.id);
      assert.equal(r.tasks[0].status, "READY");
      assert.equal(c.calls.critic, undefined);
      assert.equal(c.calls.translation, undefined);
      assert.equal(
        r.versions[0].metadata.scoringMethod,
        "deterministic-completeness-v1",
      );
    });
  },
);

test(
  "invalid analysis without a document retains scheduled retries, persisted budget and restart recovery",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      c.change("analysis", () => {
        if (c.calls.analysis === 1)
          throw new HarvestError(
            "MODEL_SCHEMA_INVALID",
            "Missing required analysis fields",
          );
        return analysis;
      });
      await processTask(c.runId, c.provider);
      let r = await detail(c.id);
      assert.equal(r.tasks[0].status, "QUEUED");
      assert.equal(r.tasks[0].attempts, 1);
      assert.equal(r.versions[0].score, 0);
      await processTask(c.runId, c.provider);
      assert.equal(c.calls.analysis, 1);
      await c.due();
      await processTask(c.runId, c.provider);
      r = await detail(c.id);
      assert.equal(r.tasks[0].status, "READY");
      assert.equal(r.versions[0].score, 95);
    });
  },
);

test(
  "unsupported official tokens never invoke lint or block completion and grading",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      const [task] = await sql("SELECT snapshot_id FROM tasks WHERE id=$1", [
        c.runId,
      ]);
      const invalid = structuredClone(evidence);
      invalid.viewports[0].elements[0].styles["border-color"] =
        "color(display-p3 0.2 0.4 0.6)";
      await putJSON(
        `${c.id}/snapshots/${task.snapshot_id}/evidence.json`,
        invalid,
      );
      await processTask(c.runId, c.provider);
      const result = await detail(c.id);
      assert.equal(result.tasks[0].status, "READY");
      assert.equal(result.tasks[0].error, null);
      assert.equal(result.versions[0].score, 95);
      for (const step of ["analysis", "ios", "critic"])
        assert.equal(c.calls[step], 1, step);
      const { exists } = await import("../src/storage.ts");
      assert.equal(await exists(c.prefix + "/IOS_design.md"), true);
      assert.equal(await exists(c.prefix + "/critic.json"), true);
      assert.equal(result.versions[0].display_zh.summary, displayZh.summary);
      assert.equal(result.versions[0].validation.officialLint, "disabled");
      assert.equal(result.default_version_id, c.versionId);
    });
  },
);

test(
  "manual completion survives a stale worker and obtains a conservative score",
  { skip: !enabled },
  async () => {
    const { setTaskStatus } = await import("../src/service.ts");
    await repairFixture(async (c) => {
      c.change("ios", async () => {
        await setTaskStatus(c.runId, "READY");
        return {
          sections: iosSections.map((heading) => ({
            heading,
            body: "Use native controls.",
          })),
        };
      });
      await processTask(c.runId, c.provider);
      const r = await detail(c.id);
      assert.equal(r.tasks[0].status, "READY");
      assert.equal(r.tasks[0].manual_status.status, "READY");
      assert.equal(typeof r.versions[0].score, "number");
      assert.equal(r.default_version_id, null);
      await assert.rejects(() => setTaskStatus(c.runId, "RUNNING" as any));
    });
  },
);

test(
  "manual completion followed immediately by resume fences the old execution",
  { skip: !enabled },
  async () => {
    const { setTaskStatus } = await import("../src/service.ts");
    await repairFixture(async (c) => {
      c.change("ios", async () => {
        await setTaskStatus(c.runId, "FAILED");
        await resume(c.runId);
        return {
          sections: iosSections.map((heading) => ({
            heading,
            body: "Use native controls.",
          })),
        };
      });
      await processTask(c.runId, c.provider);
      const result = await detail(c.id);
      assert.equal(result.tasks[0].status, "QUEUED");
      assert.equal(result.tasks[0].manual_status, null);
      assert.equal(result.default_version_id, null);
    });
  },
);

test(
  "resuming a manually marked completed task creates a new version",
  { skip: !enabled },
  async () => {
    const { setTaskStatus } = await import("../src/service.ts");
    await repairFixture(async (c) => {
      await processTask(c.runId, c.provider);
      const original = (await detail(c.id)).default_version_id;
      await setTaskStatus(c.runId, "FAILED");
      await resume(c.runId);
      const result = await detail(c.id);
      assert.equal(result.default_version_id, original);
      assert.equal(result.versions.length, 2);
      assert.equal(
        result.versions.find((v: any) => v.id === original)?.quality,
        "SCORED",
      );
      assert.equal(result.tasks[0].status, "QUEUED");
      assert.notEqual(result.tasks[0].id, c.runId);
    });
  },
);

test(
  "historical missing scores are backfilled without model calls or overwriting old artifacts",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      await put(c.prefix + "/DESIGN.md", "# Historical design");
      await put(
        c.prefix + "/critic.json",
        '{"original":"preserve this raw report"}',
      );
      await sql("UPDATE tasks SET status='FAILED' WHERE id=$1", [c.runId]);
      const r = await detail(c.id);
      assert.equal(typeof r.versions[0].score, "number");
      assert.equal(
        r.versions[0].metadata.scoringMethod,
        "deterministic-completeness-v1",
      );
      assert.deepEqual(c.calls, {});
      const { get, getJSON } = await import("../src/storage.ts");
      assert.equal(
        (await get(c.prefix + "/critic.json")).toString(),
        '{"original":"preserve this raw report"}',
      );
      assert.equal(
        r.versions[0].metadata.scoringResult.score,
        r.versions[0].score,
      );
      const second = await detail(c.id);
      assert.equal(
        second.versions[0].metadata.scoringReport,
        r.versions[0].metadata.scoringReport,
      );
    });
  },
);

test(
  "old accepted translations are restored despite nonempty semantic review notes",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      const source = c.prefix + "/candidates/old/analysis.json",
        translation = c.prefix + "/candidates/old/translation.json";
      await putJSON(source, analysis);
      await putJSON(translation, displayZh);
      await sql("UPDATE versions SET analysis=$2,validation=$3 WHERE id=$1", [
        c.versionId,
        JSON.stringify(analysis),
        JSON.stringify({
          valid: false,
          candidates: { analysis: source },
          issues: [{ message: "可接受" }],
        }),
      ]);
      await sql("UPDATE tasks SET status='READY',repair_state=$2 WHERE id=$1", [
        c.runId,
        JSON.stringify({ outputs: { analysis: source, translation } }),
      ]);
      const r = await detail(c.id);
      assert.equal(r.versions[0].display_zh.summary, displayZh.summary);
      assert.deepEqual(c.calls, {});
    });
  },
);

test(
  "presentation-only job does not rewrite documents or change original status/score/default",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      c.change("translation", () => undefined);
      await processTask(c.runId, c.provider);
      const { queuePresentation } = await import("../src/presentation-job.ts");
      const { get } = await import("../src/storage.ts");
      const before = await get(c.prefix + "/DESIGN.md");
      const original = await detail(c.id);
      const repair = await queuePresentation(c.id, c.versionId);
      c.change("translation", () => displayZh);
      await processTask(repair.runId, c.provider);
      const result = await detail(c.id);
      assert.deepEqual(await get(c.prefix + "/DESIGN.md"), before);
      assert.equal(result.versions[0].score, original.versions[0].score);
      assert.equal(result.default_version_id, original.default_version_id);
      assert.equal(result.versions[0].display_zh.summary, displayZh.summary);
      assert.equal(
        result.tasks.find((t: any) => t.id === c.runId)!.status,
        "READY",
      );
      assert.equal(c.calls.translation, 1);
      assert.equal(c.calls.analysis, 1);
      assert.equal(c.calls.ios, 1);
    });
  },
);

test(
  "multiple image import archives originals, bypasses browser, preserves order and regenerates from snapshot",
  { skip: !enabled },
  async () => {
    const { createImageRun, importRoot } = await import(
      "../src/image-import.ts"
    );
    const { getJSON, get } = await import("../src/storage.ts");
    const sharp = (await import("sharp")).default;
    const bytes = await sharp({
      create: { width: 80, height: 140, channels: 3, background: "#f2e7cd" },
    })
      .png()
      .toBuffer();
    const run = await createImageRun(
      [
        new File([new Uint8Array(bytes)], "first.png", { type: "image/png" }),
        new File([new Uint8Array(bytes)], "second.png", { type: "image/png" }),
      ],
      "图片设计",
      "Two screens from one app",
    );
    let count = 0;
    const fake: DesignModelProvider = {
      async generate(schema, _instruction, input, images) {
        count++;
        if (Object.is(schema, GenerationSchema)) {
          assert.equal(images?.length, 2);
          assert.equal((input as any).evidence.kind, "images");
          return {
            analysis: {
              ...analysis,
              overview:
                "Warm colors and clear visual hierarchy define a reusable interface.",
              signatureTraits: analysis.signatureTraits.map((t) => ({
                ...t,
                evidenceIds: ["image-1"],
              })),
              visualEstimates: {
                colors: [{ value: "#f2e7cd", role: "Warm background" }],
                fontStyle: "A rounded sans-serif style; exact family unknown.",
              },
            },
            displayZh: {
              ...displayZh,
              signatureTraits: displayZh.signatureTraits.map((t) => ({
                ...t,
                evidenceIds: ["image-1"],
              })),
            },
          } as any;
        }
        if (Object.is(schema, IOSSchema))
          return {
            sections: iosSections.map((heading) => ({
              heading,
              body: "Use native platform behavior as an implementation proposal.",
            })),
          } as any;
        return {
          score: 80,
          subscores: {
            evidenceAccuracy: 80,
            visualFidelity: 80,
            designAbstraction: 80,
            responsiveUnderstanding: 80,
            iosAdaptation: 80,
          },
          issues: [],
        } as any;
      },
    };
    try {
      await processTask(run.runId, fake);
      let r = await detail(run.designId);
      assert.equal(r.source_kind, "images");
      assert.equal(r.canonical_url, null);
      assert.equal(r.tasks[0].status, "READY");
      assert.equal(count, 3);
      const snapshot = `${r.id}/snapshots/${r.versions[0].snapshot_id}`;
      const e = await getJSON(snapshot + "/evidence.json");
      assert.deepEqual(
        e.images.map((i: any) => i.name),
        ["first.png", "second.png"],
      );
      assert.deepEqual(e.viewports, []);
      assert.deepEqual(await get(snapshot + "/" + e.images[0].path), bytes);
      assert.equal(
        (
          await sql("SELECT import_id FROM snapshots WHERE id=$1", [
            r.versions[0].snapshot_id,
          ])
        )[0].import_id,
        null,
      );
      const md = (
        await get(`${r.id}/versions/${r.versions[0].id}/DESIGN.md`)
      ).toString();
      assert.match(md, /visual estimate/);
      assert.doesNotMatch(md, /fontSize: 64px/);
      const next = await createRun(null, r.id, r.versions[0].snapshot_id);
      await processTask(next.runId, fake);
      r = await detail(r.id);
      assert.equal(r.versions.length, 2);
      assert.equal(r.tasks[0].status, "READY");
      assert.equal(count, 6);
    } finally {
      await sql("DELETE FROM designs WHERE id=$1", [run.designId]);
      await removeDesign(run.designId);
    }
  },
);

test(
  "stale Chinese cache is not attached to a changed English candidate",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      const source = c.prefix + "/candidates/old/analysis.json";
      await putJSON(source, analysis);
      await putJSON(c.prefix + "/display-zh.json", {
        ...displayZh,
        sourceCandidate: source,
      });
      await sql(
        "UPDATE versions SET analysis=$2,metadata=metadata||$3::jsonb WHERE id=$1",
        [
          c.versionId,
          JSON.stringify({
            ...analysis,
            summary: "A different English design.",
          }),
          JSON.stringify({ analysisCandidate: source }),
        ],
      );
      const result = await detail(c.id);
      assert.equal(result.versions[0].display_zh, null);
      assert.deepEqual(c.calls, {});
    });
  },
);
test(
  "DNA recovery retries technical failures twice and reuses a persisted candidate after restart",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      c.change("translation", () => undefined);
      await processTask(c.runId, c.provider);
      const { queuePresentation } = await import("../src/presentation-job.ts");
      const { fingerprint } = await import("../src/content-checks.ts");
      const repair = await queuePresentation(c.id, c.versionId);
      c.change("translation", () => {
        if (c.calls.translation < 3)
          throw new HarvestError("MODEL_TIMEOUT", "Temporary timeout");
        return displayZh;
      });
      await processTask(repair.runId, c.provider);
      assert.equal(c.calls.translation, 3);
      let result = await detail(c.id);
      assert.equal(result.versions[0].display_zh.summary, displayZh.summary);
      const again = await queuePresentation(c.id, c.versionId);
      const report = c.prefix + "/presentations/restart.json";
      await putJSON(report, displayZh);
      await sql("UPDATE tasks SET repair_state=$2 WHERE id=$1", [
        again.runId,
        JSON.stringify({
          presentation: {
            hash: fingerprint(analysis),
            path: report,
            attempts: 2,
          },
        }),
      ]);
      await processTask(again.runId, c.provider);
      assert.equal(c.calls.translation, 3);
      result = await detail(c.id);
      assert.equal(
        result.tasks.find((t: any) => t.id === again.runId)!.status,
        "READY",
      );
    });
  },
);
test(
  "cancellation during DNA recovery cannot publish a late translation",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      c.change("translation", () => undefined);
      await processTask(c.runId, c.provider);
      const { queuePresentation } = await import("../src/presentation-job.ts");
      const repair = await queuePresentation(c.id, c.versionId);
      const provider: DesignModelProvider = {
        async generate() {
          await cancel(repair.runId);
          return displayZh as any;
        },
      };
      await processTask(repair.runId, provider);
      const result = await detail(c.id);
      assert.equal(result.versions[0].display_zh, null);
      assert.equal(
        result.tasks.find((t: any) => t.id === repair.runId)!.status,
        "CANCELED",
      );
      assert.equal(
        result.tasks.find((t: any) => t.id === c.runId)!.status,
        "READY",
      );
    });
  },
);

test(
  "historical image score backfill also excludes the single-image consistency dimension",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      const [v] = await sql("SELECT snapshot_id FROM versions WHERE id=$1", [
        c.versionId,
      ]);
      await putJSON(`${c.id}/snapshots/${v.snapshot_id}/evidence.json`, {
        ...evidence,
        kind: "images",
        viewports: [],
        images: [{ id: "image-1" }],
      });
      await putJSON(c.prefix + "/critic.json", {
        score: 64,
        subscores: {
          evidenceAccuracy: 80,
          visualFidelity: 80,
          designAbstraction: 80,
          responsiveUnderstanding: 0,
          iosAdaptation: 80,
        },
        issues: [],
      });
      await sql("UPDATE tasks SET status='READY' WHERE id=$1", [c.runId]);
      const r = await detail(c.id);
      assert.equal(r.versions[0].score, 80);
      assert.deepEqual(r.versions[0].metadata.scoringResult.notApplicable, [
        "responsiveUnderstanding",
      ]);
    });
  },
);
