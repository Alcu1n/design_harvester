import { stringify } from "yaml";
import { lint } from "@google/design.md/linter";
import {
  iosSections,
  type Evidence,
  type Analysis,
  type IOSAnalysis,
} from "./contracts.ts";
export function tokens(e: Evidence) {
  const desktop =
    e.viewports.find((v) => v.name === "desktop") || e.viewports[0];
  const colors: Record<string, string> = {},
    typography: Record<string, unknown> = {},
    spacing: Record<string, string> = {},
    rounded: Record<string, string> = {};
  const colorValues = [
    ...new Set(
      desktop.elements
        .flatMap((x) =>
          ["color", "background-color", "border-color"].map((k) => x.styles[k]),
        )
        .filter((v) => v && v !== "rgba(0, 0, 0, 0)" && v !== "transparent"),
    ),
  ].slice(0, 20);
  colorValues.forEach((v, i) => (colors["color-" + (i + 1)] = v));
  for (const el of desktop.elements) {
    if (
      ["h1", "h2", "h3", "p", "button", "small", "label"].includes(el.tag) &&
      !typography[el.tag]
    ) {
      const s = el.styles;
      typography[el.tag] = {
        fontFamily: s["font-family"],
        fontSize: s["font-size"],
        fontWeight: Number(s["font-weight"]) || 400,
        ...(s["line-height"] !== "normal"
          ? { lineHeight: s["line-height"] }
          : {}),
        ...(s["letter-spacing"] !== "normal"
          ? { letterSpacing: s["letter-spacing"] }
          : {}),
      };
    }
  }
  const scale = (props: string[]) =>
    [
      ...new Set(
        desktop.elements
          .flatMap((x) => props.map((k) => x.styles[k]))
          .filter((v) => /^\d+(\.\d+)?px$/.test(v) && parseFloat(v) > 0),
      ),
    ]
      .sort((a, b) => parseFloat(a) - parseFloat(b))
      .slice(0, 16);
  scale(["padding-top", "padding-left", "gap", "margin-top"]).forEach(
    (v, i) => (spacing["space-" + (i + 1)] = v),
  );
  scale(["border-top-left-radius"]).forEach(
    (v, i) => (rounded["radius-" + (i + 1)] = v),
  );
  return { colors, typography, spacing, rounded };
}
export function validateAnalysis(e: Evidence, a: Analysis) {
  const ids = new Set(e.viewports.flatMap((v) => v.elements.map((x) => x.id)));
  return a.signatureTraits.every((t) =>
    t.evidenceIds.every((id) => ids.has(id)),
  );
}
export function renderDesign(e: Evidence, a: Analysis) {
  const t = tokens(e);
  return `---\n${stringify({ version: "alpha", name: a.name, ...t })}---\n\n## Overview\n\n${a.philosophy}\n\n${a.summary}\n\n### Signature Traits\n\n${a.signatureTraits.map((t) => `- ${t.description}（证据：${t.evidenceIds.join(", ")}）`).join("\n")}\n\n## Colors\n\n${a.colorStrategy}\n\n${Object.entries(
    t.colors,
  )
    .map(([k, v]) => `- ${k}: ${v}`)
    .join(
      "\n",
    )}\n\n## Typography\n\n${a.typographyStrategy}\n\n## Layout\n\n${a.layoutStrategy}\n\n### Spacing\n\n${a.spacingStrategy}\n\n### Responsive Behavior\n\n${a.responsiveStrategy}\n\n## Elevation & Depth\n\n${a.surfaceStrategy}\n\n## Shapes\n\n${a.shapeStrategy}\n\n## Components\n\n${a.componentStrategy}\n\n### Motion\n\n${a.motionStrategy}\n\n## Do's and Don'ts\n\n### Do\n\n${a.do.map((x) => "- " + x).join("\n")}\n\n### Don't\n\n${a.dont.map((x) => "- " + x).join("\n")}\n\n### Evidence & limitations\n\n来源：${e.source.url}\n\n采集：${e.source.capturedAt}\n\nToken 值来自桌面视口的浏览器计算样式，保留小数与视口相关的采样值，不代表跨视口固定的语义间距。相对布局规则见正文与三尺寸证据，不应将采样值机械用于原生布局；语义命名和正文设计解释为推断。字体列表表示 CSS 声明，不保证每个字形的实际渲染字体。\n\n${e.warnings.map((w) => "- " + w).join("\n")}\n`;
}
export function renderIOS(a: IOSAnalysis) {
  return (
    "# iOS Design Adaptation\n\n本文是基于 Web 设计语言的 Apple 原生适配建议，不是原网站的实测 iOS 行为。默认面向 iOS 17+；高版本 API 必须声明可用性及替代方案。\n\n" +
    iosSections
      .map((h) => `## ${h}\n\n${a.sections.find((s) => s.heading === h)!.body}`)
      .join("\n\n") +
    "\n"
  );
}
export function lintDesign(markdown: string) {
  try {
    const r = lint(markdown);
    return {
      valid: r.summary.errors === 0,
      summary: r.summary,
      findings: r.findings,
    };
  } catch {
    return {
      valid: false,
      summary: { errors: 1, warnings: 0, infos: 0 },
      findings: [{ message: "DESIGN.md 无法解析", severity: "error" }],
    };
  }
}
export function tokenDiff(a: Evidence, b: Evidence) {
  const left = tokens(a),
    right = tokens(b);
  return Object.keys(left).flatMap((group) => {
    const x = left[group as keyof typeof left] as Record<string, unknown>,
      y = right[group as keyof typeof right] as Record<string, unknown>;
    return [...new Set([...Object.keys(x), ...Object.keys(y)])]
      .filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]))
      .map((k) => ({
        token: group + "." + k,
        before: x[k] ?? null,
        after: y[k] ?? null,
      }));
  });
}
