import { z } from "zod";
export const ModelConfigSchema = z.object({
  provider: z.enum(["antigravity-cli", "gemini-cli", "deepseek"]),
  model: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._/-]+$/),
}).strict();
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export const providerInfo = () =>
  process.env.MODEL_PROVIDER === "deepseek"
    ? { provider: "deepseek" as const, model: process.env.DEEPSEEK_MODEL || "deepseek-flash" }
    : process.env.MODEL_PROVIDER === "gemini-cli"
      ? { provider: "gemini-cli" as const, cliVersion: "0.59.0", model: process.env.GEMINI_MODEL || "CLI-default" }
      : { provider: "antigravity-cli" as const, cliVersion: "1.2.2", model: process.env.AGY_MODEL || "gemini-3.8-flash-medium" };
export function modelMetadata(config: ModelConfig) {
  return { ...config, ...(config.provider === "deepseek" ? { apiVersion: "chat-completions-v1" } : { cliVersion: config.provider === "gemini-cli" ? "0.59.0" : "1.2.2" }) };
}
