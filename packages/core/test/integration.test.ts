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
import { evidence, analysis } from "./fixtures.ts";
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
              body: "使用 iOS 原生语义，尊重动态字体与安全区。",
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
    const { extract, stabilizePage, visualInputs } =
      await import("../src/browser.ts");
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

test("model settings persist and generation metadata stays pinned", { skip: !enabled }, async () => {
  const { getModelConfig, saveModelConfig } = await import("../src/model-settings.ts");
  const previous = await getModelConfig();
  let designId: string | undefined;
  try {
    await saveModelConfig({ provider: "deepseek", model: "deepseek-flash" });
    const run = await createRun(`https://example.com/model-${randomUUID()}`);
    designId = run.designId;
    await saveModelConfig({ provider: "antigravity-cli", model: "gemini-3.8-flash-medium" });
    const [version] = await sql("SELECT metadata FROM versions WHERE design_id=$1", [designId]);
    assert.equal(version.metadata.provider, "deepseek");
    assert.equal(version.metadata.model, "deepseek-flash");
    assert.equal((await getModelConfig()).provider, "antigravity-cli");
  } finally {
    await saveModelConfig(previous);
    if (designId) await sql("DELETE FROM designs WHERE id=$1", [designId]);
  }
});

test("saved credentials override files, survive blank updates and never enter public settings", { skip: !enabled }, async () => {
  const { getModelConfig, saveModelConfig, getSavedDeepSeekKey, hasSavedDeepSeekKey } = await import("../src/model-settings.ts");
  const { deepseekKey, DeepSeekProvider } = await import("../src/deepseek.ts");
  const { z } = await import("zod");
  const previous = await getModelConfig();
  const key = await getSavedDeepSeekKey();
  try {
    const config = { provider: "deepseek", model: "deepseek-flash" };
    const result = await saveModelConfig({ ...config, deepseekApiKey: " test-credential-one " });
    assert.deepEqual(result, config);
    assert.deepEqual(await getModelConfig(), config);
    assert.equal(await hasSavedDeepSeekKey(), true);
    assert.equal(await deepseekKey(), "test-credential-one");
    await saveModelConfig({ ...config, deepseekApiKey: " " });
    assert.equal(await deepseekKey(), "test-credential-one");
    await saveModelConfig({ ...config, deepseekApiKey: "test-credential-two" });
    await new DeepSeekProvider(undefined, async (_, options) => {
      assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer test-credential-two");
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] });
    }).generate(z.object({ ok: z.boolean() }), "", {});
    await assert.rejects(saveModelConfig({ ...config, deepseekApiKey: "bad\nkey" }));
    assert.equal(await deepseekKey(), "test-credential-two");
  } finally {
    await saveModelConfig(previous);
    if (key) await saveModelConfig({ ...previous, deepseekApiKey: key });
    else await sql("DELETE FROM app_settings WHERE id='deepseek-credential'");
  }
});

after(async () => { await pool.end(); });
