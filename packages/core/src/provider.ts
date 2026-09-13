import { AntigravityProvider, agyAuthReady } from "./antigravity.ts";
import { GeminiCLIProvider, authReady } from "./model.ts";
import { DeepSeekProvider, deepseekAuthReady } from "./deepseek.ts";
import { providerInfo, type ModelConfig } from "./model-config.ts";
export { providerInfo } from "./model-config.ts";
export const modelProvider = (config: ModelConfig = providerInfo()) =>
  config.provider === "deepseek" ? new DeepSeekProvider(config.model) :
  config.provider === "gemini-cli" ? new GeminiCLIProvider(config.model === "CLI-default" || config.model === "CLI default" ? undefined : config.model) : new AntigravityProvider(config.model);
export const providerAuthReady = (config: ModelConfig = providerInfo()) =>
  config.provider === "deepseek" ? deepseekAuthReady() : config.provider === "gemini-cli" ? authReady() : agyAuthReady();
