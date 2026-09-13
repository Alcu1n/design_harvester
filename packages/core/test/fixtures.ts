import { AnalysisSchema, type Evidence } from "../src/contracts.ts";
export const evidence: Evidence = {
  schemaVersion: "1.0",
  source: {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    capturedAt: "2026-09-13T00:00:00Z",
  },
  viewports: [
    {
      name: "desktop",
      width: 1440,
      height: 1000,
      pageHeight: 1000,
      elements: [
        {
          id: "desktop-0",
          selector: "h1",
          tag: "h1",
          role: "h1",
          text: "Editorial",
          geometry: { x: 30, y: 30, width: 600, height: 70 },
          styles: {
            "font-family": "Georgia",
            "font-size": "64px",
            "font-weight": "400",
            "line-height": "72px",
            "letter-spacing": "-1px",
            color: "rgb(30, 30, 30)",
            "background-color": "rgb(250, 250, 245)",
            "padding-top": "24px",
            "border-top-left-radius": "8px",
          },
        },
        {
          id: "desktop-1",
          selector: "p",
          tag: "p",
          role: "p",
          text: "Text",
          geometry: { x: 30, y: 120, width: 400, height: 30 },
          styles: {
            "font-family": "Arial",
            "font-size": "16px",
            "font-weight": "400",
            "line-height": "24px",
            "letter-spacing": "normal",
            color: "rgb(30, 30, 30)",
            "background-color": "rgba(0, 0, 0, 0)",
            "padding-top": "8px",
            "border-top-left-radius": "0px",
          },
        },
      ],
      variables: {},
      fonts: ["Georgia"],
      animations: [],
      warnings: [],
    },
  ],
  warnings: [],
};
export const analysis = AnalysisSchema.parse({
  name: "Quiet editorial design",
  summary:
    "Serif headings and generous space establish a clear reading hierarchy.",
  tags: ["Editorial"],
  philosophy: "Keep the reading experience at the center of the design.",
  colorStrategy: "Restrained neutral colors provide contrast.",
  typographyStrategy: "Georgia is the declared heading font.",
  layoutStrategy: "Content follows a left-aligned reading order.",
  spacingStrategy: "Use the spacing measured in the browser.",
  surfaceStrategy: "Flat surfaces minimize visual noise.",
  shapeStrategy: "Subtle rounding softens the containers.",
  componentStrategy: "Headings and paragraphs form the reading structure.",
  motionStrategy: "No motion was observed.",
  responsiveStrategy:
    "Only desktop evidence is available; mobile behavior cannot be inferred.",
  signatureTraits: [1, 2, 3].map((i) => ({
    description: "Observed typography establishes the design hierarchy " + i,
    evidenceIds: ["desktop-0"],
  })),
  do: [
    "Use the observed font declarations.",
    "Maintain a clear reading hierarchy.",
    "Preserve generous whitespace.",
  ],
  dont: [
    "Do not invent colors.",
    "Avoid unsupported decorative shadows.",
    "Do not assume unobserved interactions.",
  ],
});
export const displayZh = {
  name: "安静的编辑设计",
  summary: "衬线标题和充足留白构成清晰的阅读层次。",
  tags: ["编辑设计"],
  signatureTraits: analysis.signatureTraits.map((t, i) => ({
    description: "实测排版建立设计层级 " + (i + 1),
    evidenceIds: t.evidenceIds,
  })),
};
