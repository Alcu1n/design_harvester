// Controlled API fixtures only. No model calls, database mutations or NAS access.
// Run after pnpm build + a local Next production server.
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../packages/core/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const origin = process.argv[2] || "http://127.0.0.1:3104";
await mkdir("output/playwright", { recursive: true });
const english = {
  name: "Quiet editorial design",
  summary: "Serif headings establish a clear reading hierarchy.",
  tags: ["Editorial"],
  signatureTraits: [1, 2, 3].map((i) => ({
    description: `Observed typography ${i}`,
    evidenceIds: ["desktop-0"],
  })),
};
const chinese = {
  name: "安静的编辑设计",
  summary: "衬线标题和充足留白构成清晰的阅读层次。",
  tags: ["编辑设计"],
  signatureTraits: [1, 2, 3].map((i) => ({
    description: `实测排版建立设计层级 ${i}`,
    evidenceIds: ["desktop-0"],
  })),
};
const issue = {
  path: "sections.21.body",
  message: "Generated code comments must use natural English.",
};
const report = "fixture/versions/version/checks/report.json";
const timestamp = "2026-09-14T10:00:00Z";
let state = "queued";
let manualStatus = null;
function fixture() {
  const ready = state === "ready";
  const task = {
    id: "task",
    version_id: "version",
    kind: "HARVEST",
    status: ready
      ? "READY"
      : state === "failed"
        ? "FAILED"
        : state === "queued"
          ? "QUEUED"
          : "RUNNING",
    stage: ready
      ? "COMPLETE"
      : state === "translation"
        ? "TRANSLATING_DESIGN_DNA"
        : "VALIDATING_ENGLISH",
    created_at: timestamp,
    repair_state: { repairs: 2, outputs: { analysis: "candidate-2" } },
    events: [
      {
        stage: "REPAIRING_CONTENT",
        attempt: 2,
        issues: [issue],
        report,
        time: timestamp,
        retryAt: timestamp,
      },
    ],
    error:
      state === "queued"
        ? {
            code: "CONTENT_REPAIR_SCHEDULED",
            message: "正在修复英文文档 · 2/5",
          }
        : state === "failed"
          ? {
              code: "CONTENT_REPAIR_FAILED",
              message:
                "已用完 5 次自动修复。sections.21.body: Generated code comments must use natural English.",
            }
          : null,
  };
  if (manualStatus) {
    task.status = manualStatus;
    task.manual_status = { status: manualStatus };
  }
  const version = {
    id: "version",
    snapshot_id: "snapshot",
    created_at: timestamp,
    analysis: english,
    display_zh: ready ? chinese : null,
    metadata: { language: "en" },
    validation: ready
      ? { valid: true, language: "en" }
      : { valid: false, language: "en", issues: [issue], report },
    quality: ready ? "QUALIFIED" : "PENDING",
    score: ready ? 95 : null,
  };
  return {
    id: "fixture",
    canonical_url: "https://example.com/",
    title: "我的自定义名称",
    tags: ["个人标签"],
    notes: "用户备注保持原样。",
    default_version_id: ready ? "version" : null,
    versions: [version],
    tasks: [task],
    assets: [
      "fixture/versions/version/DESIGN.md",
      "fixture/versions/version/IOS_design.md",
    ],
  };
}
const browser = await chromium.launch();
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 393, height: 852 }
        : { width: 1440, height: 1100 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (
        path === "/api/harvest-runs/task/status" &&
        route.request().method() === "POST"
      ) {
        manualStatus = route.request().postDataJSON().status;
        assert.ok(["READY", "FAILED"].includes(manualStatus));
        return route.fulfill({ json: { ok: true } });
      }
      assert.equal(
        route.request().method(),
        "GET",
        "Only the mocked status mutation is allowed",
      );
      if (path === "/api/designs/fixture")
        return route.fulfill({ json: fixture() });
      if (path === "/api/designs") {
        const d = fixture();
        return route.fulfill({
          json: {
            items: [
              { ...d, ...d.versions[0], id: d.id, status: d.tasks[0].status },
            ],
            total: 1,
            tags: [],
          },
        });
      }
      if (path.endsWith("evidence.json"))
        return route.fulfill({
          json: {
            viewports: [
              {
                name: "desktop",
                elements: [
                  {
                    id: "desktop-0",
                    text: "Example",
                    selector: "h1",
                    styles: {
                      color: "rgb(30,30,30)",
                      "background-color": "rgb(250,250,245)",
                      "font-family": "Georgia",
                      "font-size": "64px",
                    },
                  },
                ],
              },
            ],
            warnings: [],
          },
        });
      if (path.endsWith(".png") || path.endsWith(".webp"))
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1000"><rect width="1440" height="1000" fill="#ebece5"/><text x="100" y="180" font-family="Georgia" font-size="70" fill="#292e28">Editorial fixture</text><path d="M100 240H1300" stroke="#73796b"/><text x="100" y="340" font-size="25" fill="#73796b">Controlled screenshot for interface verification</text></svg>',
        });
      if (path.endsWith("report.json"))
        return route.fulfill({ json: { valid: false, issues: [issue] } });
      if (path.endsWith(".md"))
        return route.fulfill({
          contentType: "text/markdown",
          body: "# Overview\n\nSerif headings establish a clear reading hierarchy.\n\n```swift\n// Respect Dynamic Type.\n```",
        });
      return route.fulfill({
        status: 404,
        json: { error: "Unexpected fixture request" },
      });
    });
    for (const next of [
      "queued",
      "english",
      "translation",
      "failed",
      "ready",
    ]) {
      state = next;
      manualStatus = null;
      await page.goto(origin + "/designs/fixture");
      await page
        .getByRole("heading", { name: "我的自定义名称", exact: true })
        .waitFor();
      await page
        .locator(".markdown")
        .getByText("Serif headings establish a clear reading hierarchy.")
        .waitFor();
      if (state === "ready") {
        await page
          .getByRole("heading", { name: chinese.name, exact: true })
          .waitFor();
        assert.equal(await page.locator(".progress-panel").count(), 0);
      } else {
        const expected =
          state === "queued"
            ? "2/5"
            : state === "translation"
              ? "正在翻译中文介绍"
              : state === "failed"
                ? "已用完 5 次"
                : "正在校验英文文档";
        assert.ok(
          (await page.locator(".progress-panel").innerText()).includes(
            expected,
          ),
        );
        assert.equal(
          await page
            .getByRole("heading", { name: english.name, exact: true })
            .count(),
          0,
          "English candidate must not leak into Chinese DNA",
        );
        await page
          .getByText("已生成，未通过规范或语言校验。当前文件为待修复候选。", {
            exact: true,
          })
          .waitFor();
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "No horizontal overflow",
      );
      await page.screenshot({
        path: `output/playwright/content-${mobile ? "mobile" : "desktop"}-${state}-014.png`,
      });
      if (state === "failed") {
        await page.getByText("任务记录", { exact: true }).click();
        await page
          .getByRole("link", { name: "查看检查报告", exact: true })
          .waitFor();
        assert.ok(
          (await page.locator(".task-log").innerText()).includes(issue.path),
        );
        await page.locator(".task-log").screenshot({
          path: `output/playwright/content-${mobile ? "mobile" : "desktop"}-report-014.png`,
        });
      }
    }
    state = "failed";
    manualStatus = null;
    await page.goto(origin + "/designs/fixture");
    const statusSelect = page.getByLabel("手动修改任务状态", { exact: true });
    await statusSelect.selectOption("READY");
    await page
      .getByText("已手动标记为已完成；此标记不代表文档通过校验。", {
        exact: true,
      })
      .waitFor();
    await page
      .getByText("已生成，未通过规范或语言校验。当前文件为待修复候选。", {
        exact: true,
      })
      .waitFor();
    await statusSelect.selectOption("FAILED");
    await page
      .getByText("已手动标记为失败；此标记不代表文档通过校验。", {
        exact: true,
      })
      .waitFor();
    await page.screenshot({
      path: `output/playwright/content-${mobile ? "mobile" : "desktop"}-manual-014.png`,
    });
    state = "ready";
    manualStatus = null;
    await page.goto(origin);
    await page.getByText(chinese.summary, { exact: true }).waitFor();
    assert.ok((await page.locator("main").innerText()).includes("个人标签"));
    assert.ok(
      !(await page.locator("main").innerText()).includes(english.summary),
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "Desktop/mobile: queued repair, English review, Chinese translation, failure reports, English documents, Chinese DNA/cards and preserved curation passed. API fixtures only.",
  );
} finally {
  await browser.close();
}
