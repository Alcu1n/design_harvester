import { createHash } from "node:crypto";
import { z } from "zod";
import type { Analysis, Evidence } from "./contracts.ts";
export type ContentIssue = { path: string; message: string; rule?: string };
export const DisplayZhSchema = z.object({
  visualFontStyle: z.string().min(1).max(12000).optional(),
  name: z.string().min(1).max(180),
  summary: z.string().min(4).max(12000),
  tags: z.array(z.string().min(1).max(80)).min(1).max(8),
  signatureTraits: z
    .array(
      z.object({
        description: z.string().min(4).max(12000),
        evidenceIds: z.array(z.string()).min(1),
      }),
    )
    .min(3)
    .max(10),
});
export const ContentReviewSchema = z.object({
  englishWeb: z.boolean(),
  englishIOS: z.boolean(),
  issues: z
    .array(
      z.object({
        target: z.enum(["analysis", "ios"]),
        path: z.string(),
        message: z.string(),
      }),
    )
    .max(30),
});
export const TranslationReviewSchema = z.object({
  faithful: z.boolean(),
  issues: z.array(z.string()).max(30),
});
export const fingerprint = (value: unknown) => {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
};
// Technical names found in supplied evidence are exempt; explanatory prose is not.
export function englishIssues(
  value: unknown,
  evidence: Evidence,
  prefix = "",
): ContentIssue[] {
  const exemptions = evidence.viewports
    .flatMap((v) =>
      v.elements.flatMap((e) =>
        (e.styles["font-family"] || "")
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, "")),
      ),
    )
    .filter((s) => /[^\x00-\x7f]/.test(s));
  const observed = evidence.viewports.flatMap((v) =>
    v.elements.flatMap((e) => [
      e.text,
      e.selector,
      e.styles["font-family"] || "",
    ]),
  );
  const issues: ContentIssue[] = [];
  function visit(v: unknown, path: string) {
    if (typeof v === "string") {
      let prose = v.replace(/https?:\/\/[^\s)]+/g, "");
      // Exact observed names/identifiers can be quoted as inline code. Never exempt code blocks or comments.
      prose = prose.replace(
        /(?<!`)`([^`\n]{1,120})`(?!`)/g,
        (match, literal: string) =>
          observed.some((source) => source.includes(literal)) ? "" : match,
      );
      for (const name of exemptions) prose = prose.split(name).join("");
      if (
        /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Cyrillic}|\p{Script=Arabic}|\p{Script=Devanagari}/u.test(
          prose,
        )
      )
        issues.push({
          path,
          message:
            "Generated prose must be written entirely in natural English.",
          rule: "document-language",
        });
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}.${i}`));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v))
        visit(x, path ? `${path}.${k}` : k);
  }
  visit(value, prefix);
  return issues;
}
export function translationIssues(
  a: Analysis,
  zh: z.infer<typeof DisplayZhSchema>,
): ContentIssue[] {
  const issues: ContentIssue[] = [];
  for (const [key, text] of [
    ["name", zh.name],
    ["summary", zh.summary],
    ...zh.signatureTraits.map((t, i) => [
      `signatureTraits.${i}`,
      t.description,
    ]),
  ] as string[][])
    if (!/\p{Script=Han}/u.test(text))
      issues.push({ path: key, message: "设计介绍必须使用简体中文。" });
  if (
    a.signatureTraits.length !== zh.signatureTraits.length ||
    a.tags.length !== zh.tags.length
  )
    issues.push({
      path: "translation",
      message: "翻译必须保留全部特征和标签，不得增加或遗漏。",
    });
  // Keep measured numerals unchanged; semantic fidelity is reviewed separately.
  const numbers = (text: string) =>
    (text.match(/[+-]?(?:\d*\.)?\d+/g) || []).sort();
  const pairs: [string, string, string][] = [
    ["name", a.name, zh.name],
    ["summary", a.summary, zh.summary],
    ...a.tags.map(
      (t, i) => [`tags.${i}`, t, zh.tags[i] || ""] as [string, string, string],
    ),
    ...a.signatureTraits.map(
      (t, i) =>
        [
          `signatureTraits.${i}`,
          t.description,
          zh.signatureTraits[i]?.description || "",
        ] as [string, string, string],
    ),
  ];
  for (const [path, source, translation] of pairs)
    if (
      JSON.stringify(numbers(source)) !== JSON.stringify(numbers(translation))
    )
      issues.push({
        path,
        message: "译文必须保留原文数值，不得新增、更改或遗漏。",
      });
  a.signatureTraits.forEach((t, i) => {
    if (
      JSON.stringify(t.evidenceIds) !==
      JSON.stringify(zh.signatureTraits[i]?.evidenceIds)
    )
      issues.push({
        path: `signatureTraits.${i}.evidenceIds`,
        message: "翻译必须保留对应特征的原始证据 ID 和顺序。",
      });
  });
  return issues;
}
