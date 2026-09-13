import { z } from "zod";
import { sql, transaction } from "./db.ts";
import { ModelConfigSchema, providerInfo, type ModelConfig } from "./model-config.ts";
export async function getModelConfig(): Promise<ModelConfig> {
  const [row] = await sql("SELECT value FROM app_settings WHERE id='model'");
  const { provider, model } = providerInfo();
  return row ? ModelConfigSchema.parse(row.value) : { provider, model };
}
// Credentials are kept separate from public model settings and version metadata.
export const ModelSettingsInputSchema = ModelConfigSchema.extend({
  deepseekApiKey: z.string().trim().max(512).regex(/^[\x21-\x7e]*$/).optional(),
});
export async function getSavedDeepSeekKey(): Promise<string> {
  const [row] = await sql("SELECT value FROM app_settings WHERE id='deepseek-credential'");
  return typeof row?.value?.apiKey === "string" ? row.value.apiKey : "";
}
export async function hasSavedDeepSeekKey() {
  const [row] = await sql("SELECT EXISTS(SELECT 1 FROM app_settings WHERE id='deepseek-credential' AND length(value->>'apiKey')>0) AS configured");
  return Boolean(row.configured);
}
export async function saveModelConfig(input: unknown) {
  const { deepseekApiKey, ...config } = ModelSettingsInputSchema.parse(input);
  await transaction(async (client) => {
    await client.query("INSERT INTO app_settings(id,value) VALUES('model',$1) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(config)]);
    if (deepseekApiKey) await client.query("INSERT INTO app_settings(id,value) VALUES('deepseek-credential',$1) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify({ apiKey: deepseekApiKey })]);
  });
  return config;
}
