import test from "node:test";
import assert from "node:assert/strict";
import { evidence, analysis, displayZh } from "./fixtures.ts";
import {
  renderDesign,
  renderIOS,
  splitCSSValues,
  tokens,
  tokenConversions,
} from "../src/render.ts";
import { englishIssues, translationIssues } from "../src/content-checks.ts";
import { iosSections } from "../src/contracts.ts";
test("CSS border shorthand retains function boundaries and distinct observed colors", () => {
  const e = structuredClone(evidence);
  e.viewports[0].elements[0].styles["border-color"] =
    "rgb(38, 32, 26) oklch(0.6 0.1 120)";
  assert.deepEqual(
    splitCSSValues(e.viewports[0].elements[0].styles["border-color"]),
    ["rgb(38, 32, 26)", "oklch(0.6 0.1 120)"],
  );
  assert.ok(Object.values(tokens(e).colors).includes("oklch(0.6 0.1 120)"));
  assert.equal(
    tokenConversions(e)[0].original,
    e.viewports[0].elements[0].styles["border-color"],
  );
  e.viewports[0].elements[0].styles["border-color"] = "not-a-real-color";
  assert.match(renderDesign(e, analysis), /not-a-real-color/);
});
test("both rendered documents and translated warnings use English, YAML examples are not tokens", () => {
  const e = structuredClone(evidence);
  e.warnings = ["未观察到暗色模式。"];
  const a = {
    ...analysis,
    evidenceWarnings: ["Dark appearance was not observed."],
    componentStrategy:
      analysis.componentStrategy +
      "\n```yaml\ncolors:\n  invalid: not-a-color\n```",
  };
  const md = renderDesign(e, a);
  assert.match(md, /```text/);
  assert.doesNotMatch(md, /\p{Script=Han}/u);
  assert.doesNotMatch(
    renderIOS({
      sections: iosSections.map((heading) => ({
        heading,
        body: "Use native platform conventions.",
      })),
    }),
    /\p{Script=Han}/u,
  );
  assert.equal(
    englishIssues({ ...a, summary: "这是中文说明" }, e)[0].path,
    "summary",
  );
  assert.equal(englishIssues({ body: "Это русский текст." }, e).length, 1);
  assert.equal(englishIssues(a, e).length, 0);
});
test("Chinese presentation must preserve the number and order of evidence references", () => {
  assert.deepEqual(translationIssues(analysis, displayZh), []);
  const bad = structuredClone(displayZh);
  bad.signatureTraits[0].evidenceIds = ["invented"];
  assert.ok(translationIssues(analysis, bad).length);
  assert.ok(
    translationIssues(analysis, { ...displayZh, summary: "English only" })
      .length,
  );
});

test("observed technical names remain intact while generated comments are checked", () => {
  const e = structuredClone(evidence);
  e.viewports[0].elements[0].text = "品牌 星河";
  e.viewports[0].elements[0].styles["font-family"] = '"思源宋体", Georgia';
  const body =
    "Use 思源宋体 for the observed `星河` brand. See https://example.com/中文.";
  assert.deepEqual(englishIssues({ body }, e), []);
  assert.equal(
    englishIssues({ body: "```swift\n// 这是一段中文注释\n```" }, e).length,
    1,
  );
  assert.equal(englishIssues({ body: "Use `虚构品牌` here." }, e).length, 1);
});

test("renderer preserves complex colors and fractional typography without format rejection", () => {
  const e = structuredClone(evidence),
    styles = e.viewports[0].elements[0].styles;
  Object.assign(styles, {
    "border-top-color": "color(display-p3 0.2 0.4 0.6)",
    "border-right-color": "rgb(10 20 30 / 0.5)",
    "border-bottom-color": "hsl(120 40% 30%)",
    "border-left-color": "oklch(0.6 0.1 120)",
    "font-size": "64.25px",
    "font-weight": "450",
    "line-height": "72.125px",
    "letter-spacing": "-0.125px",
  });
  assert.match(renderDesign(e, analysis), /color\(display-p3 0.2 0.4 0.6\)/);
  assert.equal((tokens(e).typography.h1 as any).fontWeight, 450);
  assert.equal((tokens(e).typography.h1 as any).fontSize, "64.25px");
  styles["font-weight"] = "not-a-weight";
  assert.match(renderDesign(e, analysis), /not-a-weight/);
  styles["font-weight"] = "400";
  styles["font-size"] = "not-a-size";
  assert.match(renderDesign(e, analysis), /not-a-size/);
});

test("Chinese translation cannot introduce or change measured numerals", () => {
  assert.ok(
    translationIssues(analysis, {
      ...displayZh,
      summary: displayZh.summary + " 使用 24px 间距。",
    }).some((i) => i.path === "summary"),
  );
});
