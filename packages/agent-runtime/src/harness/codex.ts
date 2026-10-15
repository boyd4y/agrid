import { createCodex } from "@ai-sdk/harness-codex";
import { HarnessConfigurationError, type HarnessAdapter } from "./types.js";

export function createCodexAdapter(options: { apiKey: string; baseUrl?: string; model?: string }): HarnessAdapter {
  if (!options.apiKey.trim()) throw new HarnessConfigurationError("Codex requires an explicit API key");
  return { harness: createCodex({ auth: { OPENAI_API_KEY: options.apiKey,
    ...(options.baseUrl ? { OPENAI_BASE_URL: options.baseUrl } : {}) } }),
    model: options.model, requiresNetworkSandbox: true, clientQuestions: "common" };
}
