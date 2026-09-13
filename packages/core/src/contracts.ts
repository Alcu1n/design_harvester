import { z } from "zod";
export const Viewport = z.enum(["desktop", "tablet", "mobile"]);
export const viewports = {
  desktop: { width: 1440, height: 1000 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 393, height: 852 },
} as const;
export const Status = z.enum([
  "QUEUED",
  "RUNNING",
  "READY",
  "PARTIAL",
  "FAILED",
  "CANCELED",
  "WAITING_AUTH",
  "WAITING_QUOTA",
  "WAITING_CONFIG",
]);
export const ElementEvidence = z.object({
  id: z.string(),
  selector: z.string(),
  tag: z.string(),
  role: z.string(),
  text: z.string(),
  geometry: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  styles: z.record(z.string(), z.string()),
});
export const EvidenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  source: z.object({
    url: z.string(),
    finalUrl: z.string(),
    capturedAt: z.string(),
  }),
  viewports: z.array(
    z.object({
      name: Viewport,
      width: z.number(),
      height: z.number(),
      pageHeight: z.number(),
      elements: z.array(ElementEvidence),
      variables: z.record(z.string(), z.string()),
      fonts: z.array(z.string()),
      fontFaces: z.array(z.record(z.string(), z.string())).optional(),
      animations: z.array(z.record(z.string(), z.unknown())),
      warnings: z.array(z.string()),
    }),
  ),
  warnings: z.array(z.string()),
});
export type Evidence = z.infer<typeof EvidenceSchema>;
const prose = z.string().min(4).max(12000);
const trait = z.object({
  description: prose,
  evidenceIds: z.array(z.string()).min(1),
});
export const AnalysisSchema = z.object({
  name: z.string().min(1).max(120),
  evidenceWarnings: z.array(prose).default([]),
  summary: prose,
  tags: z.array(z.string().max(40)).min(1).max(8),
  philosophy: prose,
  colorStrategy: prose,
  typographyStrategy: prose,
  layoutStrategy: prose,
  spacingStrategy: prose,
  surfaceStrategy: prose,
  shapeStrategy: prose,
  componentStrategy: prose,
  motionStrategy: prose,
  responsiveStrategy: prose,
  signatureTraits: z.array(trait).min(3).max(10),
  do: z.array(prose).min(3).max(12),
  dont: z.array(prose).min(3).max(12),
});
export type Analysis = z.infer<typeof AnalysisSchema>;
export const iosSections = [
  "Design Intent",
  "Apple Platform Philosophy",
  "Colors",
  "Light & Dark Mode",
  "Typography",
  "Dynamic Type",
  "Layout",
  "Safe Areas",
  "Spacing",
  "Shapes",
  "Continuous Corners",
  "Materials & Depth",
  "Components",
  "Navigation",
  "Sheets & Presentation",
  "SF Symbols",
  "Motion",
  "Haptics",
  "Accessibility",
  "iPhone",
  "iPad",
  "SwiftUI Implementation Guidance",
  "Do's and Don'ts",
] as const;
export const IOSSchema = z
  .object({
    sections: z
      .array(z.object({ heading: z.enum(iosSections), body: prose }))
      .length(iosSections.length),
  })
  .refine(
    (x) =>
      new Set(x.sections.map((s) => s.heading)).size === iosSections.length,
    "All iOS sections are required",
  );
export type IOSAnalysis = z.infer<typeof IOSSchema>;
export const CriticSchema = z.object({
  score: z.number().int().min(0).max(100),
  subscores: z.object({
    evidenceAccuracy: z.number().min(0).max(100),
    visualFidelity: z.number().min(0).max(100),
    designAbstraction: z.number().min(0).max(100),
    responsiveUnderstanding: z.number().min(0).max(100),
    iosAdaptation: z.number().min(0).max(100),
  }),
  issues: z
    .array(z.object({ severity: z.enum(["error", "warning"]), message: prose }))
    .max(30),
});
export type Critic = z.infer<typeof CriticSchema>;
export class HarvestError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryAt?: Date,
  ) {
    super(message);
    this.name = "HarvestError";
  }
}
export const CreateSchema = z.object({ url: z.string().min(1).max(2048) });
export const UpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(10000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
});
export function eligible(c: Critic, valid: boolean, complete: boolean) {
  return (
    complete &&
    valid &&
    c.score >= 85 &&
    !c.issues.some((i) => i.severity === "error")
  );
}
