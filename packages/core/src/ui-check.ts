import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const out = path.resolve("../../artifacts/verification");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:3000/");
await page.getByRole("heading", { name: /全部设计/ }).waitFor();
await page.waitForTimeout(700);
await page.screenshot({
  path: path.join(out, "library-desktop.png"),
  fullPage: true,
});
const result = await page.request.get("http://localhost:3000/api/designs");
const data = await result.json();
if (data.items?.[0]) {
  await page.goto("http://localhost:3000/designs/" + data.items[0].id);
  await page.getByRole("heading", { name: "版本历史" }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(out, "detail-desktop.png"),
    fullPage: true,
  });
  if (
    await page.getByRole("button", { name: "复制", exact: true }).isEnabled()
  ) {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "复制", exact: true }).click();
    await page.getByRole("button", { name: "已复制", exact: true }).waitFor();
    if (
      !(await page.evaluate(() => navigator.clipboard.readText())).includes(
        "version: alpha",
      )
    )
      throw new Error("Copied document lost frontmatter");
  }
  if (await page.locator(".compare select").count()) {
    const select = page.locator(".compare select");
    const value = await select.locator("option").nth(1).getAttribute("value");
    await select.selectOption(value!);
    await page.getByAltText("对比版本截图", { exact: true }).waitFor();
    await page.locator(".version-list button").nth(1).click();
    await page.waitForFunction(
      () =>
        !(document.querySelector(".compare select") as HTMLSelectElement)
          ?.value,
    );
    await page.locator(".version-list button").first().click();
  }
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".edit-form textarea").fill("真实公共网页采集验证");
  await page.getByRole("button", { name: "保存整理" }).click();
  await page.getByText("真实公共网页采集验证", { exact: true }).waitFor();
}
await page.setViewportSize({ width: 393, height: 852 });
await page.goto("http://localhost:3000/");
await page.getByRole("heading", { name: /全部设计/ }).waitFor();
await page.waitForTimeout(500);
await page.screenshot({
  path: path.join(out, "library-mobile.png"),
  fullPage: true,
});
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
if (overflow) throw new Error("Mobile horizontal overflow");
await page.goto("http://localhost:3000/settings");
await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
await page.screenshot({
  path: path.join(out, "settings-mobile.png"),
  fullPage: true,
});
await browser.close();
if (errors.length) throw new Error(errors.join("\n"));
console.log(
  "UI checked: library, detail, edit, settings, desktop/mobile, no page errors or horizontal overflow",
);
