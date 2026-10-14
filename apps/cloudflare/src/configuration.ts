/** Bindings come from Wrangler. Only optional application secrets are described here. */
export const runtimeSettingKeys = ["PI_API_KEY","PI_BASE_URL","PI_MODEL","PI_CONTEXT_WINDOW","PI_MAX_OUTPUT_TOKENS",
  "OPENROUTER_API_KEY","OPENROUTER_BASE_URL","OPENROUTER_MODEL","OPENAI_API_KEY","OPENAI_BASE_URL","CODEX_API_KEY","CODEX_MODEL",
  "ANTHROPIC_API_KEY","ANTHROPIC_BASE_URL","CLAUDE_MODEL","AI_CHAT_MAX_STEPS","AI_CHAT_TOTAL_MS","AI_CHAT_STEP_MS","AI_CHAT_FIRST_CHUNK_MS","AI_CHAT_CHUNK_MS","AI_RUN_POLL_MS"] as const;
type WidenSettings<T> = { [Key in keyof T]: T[Key] extends string ? string : T[Key] };
export type ProductEnvironment = WidenSettings<Env> & Partial<Record<typeof runtimeSettingKeys[number] | "RESEND_API_KEY" | "EMAIL_FROM",string>>;
export function runtimeEnvironment(env: ProductEnvironment): Readonly<Record<string,string|undefined>> {
  return Object.fromEntries(runtimeSettingKeys.map(key => [key,env[key]]));
}
