import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  devIndicators: false,
  transpilePackages: ["@harvester/core"],
  serverExternalPackages: [
    "pg",
    "pg-boss",
    "sharp",
    "playwright",
    "@google/design.md",
  ],
  outputFileTracingExcludes: {
    "/*": [
      "../../.auth/**/*",
      "../../.data/**/*",
      "../../.work/**/*",
      "../../.tools/**/*",
      "../../.env",
      "../../artifacts/**/*",
    ],
  },
  poweredByHeader: false,
};
export default config;
