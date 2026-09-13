import { chromium } from "playwright";
import { z } from "zod";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { AntigravityProvider } from "./antigravity.ts";
import { GeminiCLIProvider } from "./model.ts";
const dir = path.resolve("../../artifacts/verification");
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(
  '<html><body style="background:#faf8f1;color:#223c2a;font-family:Georgia;padding:40px"><h1 style="font-size:52px">Design Harvester</h1><p>Private design archive</p><button style="background:#234a31;color:white;padding:16px;border:0">Harvest</button></body></html>',
);
const image = path.join(dir, "gemini-smoke.png");
await page.screenshot({ path: image });
await browser.close();
const response = await (
  process.argv.includes("--agy")
    ? new AntigravityProvider()
    : new GeminiCLIProvider()
).generate(
  z.object({
    heading: z.string(),
    buttonColor: z.string(),
    usedTools: z.boolean(),
  }),
  "阅读截图。返回页面标题、按钮大致颜色以及是否使用模型工具。",
  { expectedTask: "只看图片，不调用任何工具。" },
  [image],
);
console.log(
  JSON.stringify(
    { success: response.heading.includes("Harvester"), response },
    null,
    2,
  ),
);
