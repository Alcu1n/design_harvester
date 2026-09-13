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
        if (Object.is(schema, AnalysisSchema)) {
          analysisCalls++;
          if (shouldCancel) await cancel(active);
          return analysis as any;
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
      assert.equal(result.default_version_id, qualified);
      assert.equal(result.versions[0].quality, "LOW_CONFIDENCE");
      score = 80;
      const revision = await createRun(d.canonical_url, id, sid);
      const before = analysisCalls;
      await processTask(revision.runId, fake);
      assert.equal(
        (
          await sql("SELECT repair_state FROM tasks WHERE id=$1", [
            revision.runId,
          ])
        )[0].repair_state.repairs,
        1,
      );
      await sql("UPDATE tasks SET retry_at=now() WHERE id=$1", [
        revision.runId,
      ]);
      await processTask(revision.runId, fake);
      assert.equal(analysisCalls - before, 2);
      assert.equal((await detail(id)).default_version_id, qualified);
      score = 94;
      failIOS = true;
      const failed = await createRun(d.canonical_url, id, sid);
      await processTask(failed.runId, fake);
      assert.equal(
        (await sql("SELECT status FROM tasks WHERE id=$1", [failed.runId]))[0]
          .status,
        "FAILED",
      );
      const count = analysisCalls;
      failIOS = false;
      await resume(failed.runId);
      await processTask(failed.runId, fake);
      assert.equal(analysisCalls, count, "saved analysis reused after failure");
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

// These providers are deterministic fixtures; official lint still executes normally.
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
      const step = Object.is(schema, AnalysisSchema)
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
      return (await answers[step]()) as any;
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
  "content repairs persist, wait, exhaust five extra calls and allow a manual fresh budget",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      c.change("analysis", () => ({
        ...analysis,
        summary: "未通过的中文候选 " + c.calls.analysis,
      }));
      for (let i = 0; i < 6; i++) {
        await processTask(c.runId, c.provider);
        const [t] = await sql("SELECT * FROM tasks WHERE id=$1", [c.runId]);
        assert.equal(t.repair_state.repairs, Math.min(i + 1, 5));
        assert.equal(
          t.attempts,
          i === 5 ? 1 : 0,
          "content repair does not consume transport retries",
        );
        if (i < 5) {
          assert.equal(t.status, "QUEUED");
          assert.ok(t.retry_at);
          const before = c.calls.analysis;
          await processTask(c.runId, c.provider);
          assert.equal(c.calls.analysis, before, "retry time is honored");
          await c.due();
        } else assert.equal(t.status, "FAILED");
      }
      assert.equal(c.calls.analysis, 6);
      assert.equal(c.calls.ios, 6, "iOS generation runs even for every rejected web candidate");
      const { files } = await import("../src/storage.ts");
      assert.equal(
        (await files(c.prefix + "/candidates")).filter((f) =>
          f.endsWith("/analysis.json"),
        ).length,
        6,
      );
      await resume(c.runId);
      c.change("analysis", () => analysis);
      await processTask(c.runId, c.provider);
      await c.due();
      await processTask(c.runId, c.provider);
      const result = await detail(c.id);
      assert.equal(result.tasks[0].status, "READY");
      assert.equal(result.versions[0].metadata.language, "en");
      assert.equal(result.versions[0].display_zh.summary, displayZh.summary);
    });
  },
);

test(
  "identical failed content stops without spending all five repairs",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      c.change("analysis", () => ({
        ...analysis,
        summary: "同一份不合格内容。",
      }));
      await processTask(c.runId, c.provider);
      await c.due();
      await processTask(c.runId, c.provider);
      const [t] = await sql("SELECT * FROM tasks WHERE id=$1", [c.runId]);
      assert.equal(t.status, "FAILED");
      assert.equal(t.repair_state.repairs, 1);
      assert.match(t.error.message, /未产生进展/);
    });
  },
);

test(
  "translation repair reuses the final English documents across worker invocations",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      c.change("translation", () =>
        c.calls.translation === 1
          ? { ...displayZh, summary: "This is not a Chinese translation." }
          : displayZh,
      );
      await processTask(c.runId, c.provider);
      const { getJSON } = await import("../src/storage.ts");
      const [before] = await sql("SELECT repair_state FROM tasks WHERE id=$1", [
        c.runId,
      ]);
      const source = before.repair_state.outputs.analysis;
      await c.due();
      await processTask(c.runId, c.provider);
      assert.equal(c.calls.analysis, 1);
      assert.equal(c.calls.ios, 1);
      assert.equal(c.calls.critic, 1);
      assert.equal(c.calls.translation, 2);
      assert.equal(
        (await getJSON(c.prefix + "/display-zh.json")).sourceCandidate,
        source,
      );
      assert.equal((await detail(c.id)).tasks[0].status, "READY");
    });
  },
);

test(
  "legacy Chinese caches are preserved and cannot bypass new language checks",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      const legacy = { ...analysis, summary: "历史中文文档。" };
      await putJSON(c.prefix + "/analysis.json", legacy);
      await put(c.prefix + "/DESIGN.md", "historical document");
      await sql(
        'UPDATE versions SET metadata=metadata||\'{"language":"zh-CN"}\'::jsonb WHERE id=$1',
        [c.versionId],
      );
      await processTask(c.runId, c.provider);
      assert.equal(
        c.calls.analysis,
        undefined,
        "first inspect the old cached analysis",
      );
      assert.equal((await detail(c.id)).tasks[0].status, "QUEUED");
      await c.due();
      await processTask(c.runId, c.provider);
      const { get, getJSON } = await import("../src/storage.ts");
      assert.equal(
        (await get(c.prefix + "/legacy/DESIGN.md")).toString(),
        "historical document",
      );
      assert.equal(
        (await getJSON(c.prefix + "/legacy/analysis.json")).summary,
        legacy.summary,
      );
      assert.equal(c.calls.analysis, 1);
      assert.equal((await detail(c.id)).tasks[0].status, "READY");
    });
  },
);

test(
  "auth and quota pauses retain repair count; cancellation prevents publication",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      c.change("analysis", () =>
        c.calls.analysis === 1
          ? { ...analysis, summary: "需要英文修复。" }
          : analysis,
      );
      c.change("ios", () => {
        if (c.calls.ios === 1)
          return {
            sections: iosSections.map((heading) => ({
              heading,
              body: "Use native iOS conventions.",
            })),
          };
        throw new HarvestError("AUTH_REQUIRED", "测试授权失效");
      });
      await processTask(c.runId, c.provider);
      await c.due();
      await processTask(c.runId, c.provider);
      let result = await detail(c.id);
      assert.equal(result.tasks[0].status, "WAITING_AUTH");
      assert.equal(result.tasks[0].repair_state.repairs, 1);
      await resume(c.runId);
      c.change("ios", () => {
        throw new HarvestError("QUOTA_EXHAUSTED", "测试额度不足");
      });
      await processTask(c.runId, c.provider);
      result = await detail(c.id);
      assert.equal(result.tasks[0].status, "WAITING_QUOTA");
      assert.equal(result.tasks[0].repair_state.repairs, 1);
      await cancel(c.runId);
      await processTask(c.runId, c.provider);
      result = await detail(c.id);
      assert.equal(result.tasks[0].status, "CANCELED");
      assert.equal(result.default_version_id, null);
    });
  },
);

test(
  "English semantic review repairs iOS alone and translation fidelity shares the same budget",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      c.change("language", () =>
        c.calls.language === 1
          ? {
              englishWeb: true,
              englishIOS: false,
              issues: [
                {
                  target: "ios",
                  path: "sections.0.body",
                  message: "The wording is not idiomatic English.",
                },
              ],
            }
          : { englishWeb: true, englishIOS: true, issues: [] },
      );
      c.change("translationReview", () =>
        c.calls.translationReview === 1
          ? { faithful: false, issues: ["译文增加了一条没有证据的结论。"] }
          : { faithful: true, issues: [] },
      );
      await processTask(c.runId, c.provider);
      await c.due();
      await processTask(c.runId, c.provider);
      assert.equal(c.calls.analysis, 1);
      assert.equal(c.calls.ios, 2);
      assert.equal((await detail(c.id)).tasks[0].repair_state.repairs, 2);
      await c.due();
      await processTask(c.runId, c.provider);
      const result = await detail(c.id);
      assert.equal(result.tasks[0].status, "READY");
      assert.equal(c.calls.ios, 2);
      assert.equal(c.calls.translation, 2);
      assert.equal(
        result.versions[0].display_zh.sourceCandidate,
        result.versions[0].validation.candidates.analysis,
      );
    });
  },
);

test(
  "network retry does not renew the content repair budget",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      c.change("analysis", () => {
        if (c.calls.analysis === 1)
          return { ...analysis, summary: "第一次中文内容。" };
        if (c.calls.analysis === 2)
          throw new HarvestError("MODEL_TIMEOUT", "temporary network timeout");
        return analysis;
      });
      await processTask(c.runId, c.provider);
      await c.due();
      await processTask(c.runId, c.provider);
      let result = await detail(c.id);
      assert.equal(result.tasks[0].status, "QUEUED");
      assert.equal(result.tasks[0].repair_state.repairs, 1);
      await c.due();
      await processTask(c.runId, c.provider);
      result = await detail(c.id);
      assert.equal(result.tasks[0].status, "READY");
      assert.equal(result.tasks[0].repair_state.repairs, 1);
    });
  },
);

test(
  "quality revision consumes the shared budget without resetting earlier repairs",
  { skip: !enabled },
  async () => {
    await repairFixture(async (c) => {
      c.change("analysis", () =>
        c.calls.analysis === 1
          ? { ...analysis, summary: "待修复的中文。" }
          : analysis,
      );
      c.change("critic", () => ({
        score: c.calls.critic <= 2 ? 80 : 95,
        subscores: {
          evidenceAccuracy: 95,
          visualFidelity: 95,
          designAbstraction: 95,
          responsiveUnderstanding: 95,
          iosAdaptation: 95,
        },
        issues: [],
      }));
      await processTask(c.runId, c.provider);
      await c.due();
      await processTask(c.runId, c.provider);
      assert.equal((await detail(c.id)).tasks[0].repair_state.repairs, 2);
      await c.due();
      await processTask(c.runId, c.provider);
      const result = await detail(c.id);
      assert.equal(result.tasks[0].status, "READY");
      assert.equal(result.tasks[0].repair_state.repairs, 2);
    });
  },
);

test(
  "official token failure still generates iOS, Chinese DNA and every review",
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
      assert.equal(result.tasks[0].status, "FAILED");
      assert.equal(result.tasks[0].error.code, "TOKEN_NORMALIZATION_FAILED");
      for (const step of [
        "analysis",
        "ios",
        "language",
        "critic",
        "translation",
        "translationReview",
      ])
        assert.equal(c.calls[step], 1, step);
      const { exists } = await import("../src/storage.ts");
      assert.equal(await exists(c.prefix + "/IOS_design.md"), true);
      assert.equal(await exists(c.prefix + "/critic.json"), true);
      assert.equal(result.versions[0].display_zh.summary, displayZh.summary);
      assert.equal(result.versions[0].validation.valid, false);
      assert.equal(result.default_version_id, null);
    });
  },
);

test(
  "manual completion preserves failed validation and survives a stale worker",
  { skip: !enabled },
  async () => {
    const { setTaskStatus } = await import("../src/service.ts");
    await repairFixture(async (c) => {
      c.change("analysis", () => ({
        ...analysis,
        summary: "未通过的中文说明。",
      }));
      await processTask(c.runId, c.provider);
      await setTaskStatus(c.runId, "READY");
      let result = await detail(c.id);
      assert.equal(result.tasks[0].status, "READY");
      assert.equal(result.versions[0].validation.valid, false);
      assert.equal(result.default_version_id, null);
      assert.equal(result.tasks[0].manual_status.previousStatus, "QUEUED");
      await setTaskStatus(c.runId, "FAILED");
      await resume(c.runId);
      c.change("analysis", () => analysis);
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
      result = await detail(c.id);
      assert.equal(
        result.tasks[0].status,
        "READY",
        "late cancellation must not overwrite a manual status",
      );
      assert.equal(result.default_version_id, null);
      assert.equal(result.tasks[0].manual_status.status, "READY");
      assert.ok(
        result.tasks[0].events.some(
          (e: any) => e.stage === "MANUAL_STATUS_CHANGED",
        ),
      );
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
  "resuming a manually marked qualified task creates a new version",
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
        "QUALIFIED",
      );
      assert.equal(result.tasks[0].status, "QUEUED");
      assert.notEqual(result.tasks[0].id, c.runId);
    });
  },
);
