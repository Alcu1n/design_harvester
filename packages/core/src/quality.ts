import {
  isImageEvidence,
  evidenceIds,
  AnalysisSchema,
  EvidenceSchema,
  IOSSchema,
  type Evidence,
  type Critic,
} from "./contracts.ts";

/** A conservative completeness score, never a claim of visual or linguistic accuracy. */
export function fallbackQuality(input: {
  analysis?: unknown;
  ios?: unknown;
  evidence?: Evidence;
  markdown?: string;
  reason: string;
}) {
  const parsedEvidence = EvidenceSchema.safeParse(input.evidence);
  const evidence = parsedEvidence.success ? parsedEvidence.data : undefined;
  const analysis = AnalysisSchema.safeParse(input.analysis);
  const ios = IOSSchema.safeParse(input.ios);
  const ids = new Set(evidence ? evidenceIds(evidence) : []);
  const refs = analysis.success
    ? analysis.data.signatureTraits.flatMap((t) => t.evidenceIds)
    : [];
  const grounded = refs.length
    ? refs.filter((id) => ids.has(id)).length / refs.length
    : 0;
  const subscores = {
    evidenceAccuracy: Math.round(grounded * 60),
    visualFidelity: 0,
    designAbstraction: analysis.success ? 60 : input.markdown?.trim() ? 20 : 0,
    responsiveUnderstanding: analysis.success
      ? Math.min(3, evidence?.viewports.length ?? 0) * 20
      : 0,
    iosAdaptation: ios.success ? 60 : 0,
  };
  const singleImage =
    !!evidence && isImageEvidence(evidence) && evidence.images.length === 1;
  const applicable = Object.entries(subscores)
    .filter(([key]) => !singleImage || key !== "responsiveUnderstanding")
    .map(([, value]) => value);
  return {
    notApplicable: singleImage ? ["responsiveUnderstanding"] : [],
    score: Math.round(
      applicable.reduce((a, b) => a + b, 0) / applicable.length,
    ),
    subscores,
    issues: [
      {
        severity: "warning" as const,
        message: `模型评分未完成，使用保守的完整度参考分：${input.reason}。视觉还原、语言自然度和语义准确性尚未评估；对应未评估项不授予分数。`,
      },
    ],
    method: "deterministic-completeness-v1",
    assessedAt: new Date().toISOString(),
  };
}
export function modelQuality(critic: Critic, evidence?: Evidence) {
  const singleImage =
    !!evidence && isImageEvidence(evidence) && evidence.images.length === 1;
  const values = Object.entries(critic.subscores)
    .filter(([key]) => !singleImage || key !== "responsiveUnderstanding")
    .map(([, v]) => v);
  return {
    ...critic,
    notApplicable: singleImage ? ["responsiveUnderstanding"] : [],
    score: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    method: "model-review-v2",
    assessedAt: new Date().toISOString(),
  };
}
