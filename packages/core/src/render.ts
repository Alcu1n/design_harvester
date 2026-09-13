import { stringify } from "yaml";
import { lint } from "@google/design.md/linter";
import {
  iosSections,
  type Evidence,
  type Analysis,
  type IOSAnalysis,
} from "./contracts.ts";
// Split CSS shorthand values only outside functions and quoted strings.
export function splitCSSValues(value: string) {
  const result: string[] = [];
  let token = "",
    depth = 0,
    quote = "",
    escaped = false;
  for (const char of value) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      token += char;
      escaped = true;
      continue;
    }
    if (quote) {
      token += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      token += char;
      continue;
    }
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (/\s/.test(char) && depth === 0) {
      if (token) result.push(token);
      token = "";
    } else token += char;
  }
  if (token) result.push(token);
  return result;
}
export function tokenConversions(e: Evidence) {
  return e.viewports.flatMap((v) =>
    v.elements.flatMap((el) => {
      const value = el.styles["border-color"] || "";
      const values = splitCSSValues(value);
      const conversions: {
        elementId: string;
        property: string;
        original: string;
        values: (string | number)[];
        operation: string;
      }[] = [];
      if (values.length > 1)
        conversions.push({
          elementId: el.id,
          property: "border-color",
          original: value,
          values,
          operation: "split-css-shorthand",
        });
      const weight = el.styles["font-weight"];
      if (/^(?:\d+\.?\d*|\.\d+)$/.test(weight))
        conversions.push({
          elementId: el.id,
          property: "font-weight",
          original: weight,
          values: [Number(weight)],
          operation: "css-number-to-yaml-number",
        });
      return conversions;
    }),
  );
}
const prose = (text: string) =>
  text.replace(/^(\s*(?:`{3,}|~{3,}))(?:yaml|yml)(?=\s|$)/gim, "$1text");
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
        .flatMap((x) => [
          x.styles.color,
          x.styles["background-color"],
          ...(["top", "right", "bottom", "left"].some(
            (side) => x.styles[`border-${side}-color`],
          )
            ? ["top", "right", "bottom", "left"].map(
                (side) => x.styles[`border-${side}-color`],
              )
            : splitCSSValues(x.styles["border-color"] || "")),
        ])
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
        fontWeight: /^(?:\d+\.?\d*|\.\d+)$/.test(s["font-weight"])
          ? Number(s["font-weight"])
          : s["font-weight"],
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
  a = {
    ...a,
    ...Object.fromEntries(
      Object.entries(a).map(([k, v]) => [
        k,
        typeof v === "string"
          ? prose(v)
          : Array.isArray(v)
            ? v.map((x) => (typeof x === "string" ? prose(x) : x))
            : v,
      ]),
    ),
    signatureTraits: a.signatureTraits.map((t) => ({
      ...t,
      description: prose(t.description),
    })),
  };
  const t = tokens(e);
  return `---\n${stringify({ version: "alpha", name: a.name, ...t })}---\n\n## Overview\n\n${a.philosophy}\n\n${a.summary}\n\n### Signature Traits\n\n${a.signatureTraits.map((t) => `- ${t.description} (evidence: ${t.evidenceIds.join(", ")})`).join("\n")}\n\n## Colors\n\n${a.colorStrategy}\n\n${Object.entries(
    t.colors,
  )
    .map(([k, v]) => `- ${k}: ${v}`)
    .join(
      "\n",
    )}\n\n## Typography\n\n${a.typographyStrategy}\n\n## Layout\n\n${a.layoutStrategy}\n\n### Spacing\n\n${a.spacingStrategy}\n\n### Responsive Behavior\n\n${a.responsiveStrategy}\n\n## Elevation & Depth\n\n${a.surfaceStrategy}\n\n## Shapes\n\n${a.shapeStrategy}\n\n## Components\n\n${a.componentStrategy}\n\n### Motion\n\n${a.motionStrategy}\n\n## Do's and Don'ts\n\n### Do\n\n${a.do.map((x) => "- " + x).join("\n")}\n\n### Don't\n\n${a.dont.map((x) => "- " + x).join("\n")}\n\n### Evidence & limitations\n\nSource: ${e.source.url}\n\nCaptured: ${e.source.capturedAt}\n\nTokens record computed browser styles from the desktop viewport, including fractional and viewport-dependent values. They are observations, not universal semantic spacing rules. Consult the layout discussion and viewport evidence before adapting them to native interfaces. Semantic names and design interpretations are inferred. Font families are CSS declarations and do not prove which font rendered every glyph.\n\n${a.evidenceWarnings.map((w) => "- " + prose(w)).join("\n")}\n`;
}
export function renderIOS(a: IOSAnalysis) {
  return (
    "# iOS Design Adaptation\n\nThis document proposes an Apple-native adaptation of the observed web design. It does not describe observed iOS behavior. Target iOS 17 or later; APIs requiring newer systems must state their availability and provide alternatives.\n\n" +
    iosSections
      .map(
        (h) =>
          `## ${h}\n\n${prose(a.sections.find((s) => s.heading === h)!.body)}`,
      )
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
