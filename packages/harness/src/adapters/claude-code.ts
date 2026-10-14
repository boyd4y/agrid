import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { HarnessConfigurationError, type HarnessAdapter } from "../index.js";

export function createClaudeCodeAdapter(options: { apiKey: string; baseUrl?: string; model?: string }): HarnessAdapter {
  if (!options.apiKey.trim()) throw new HarnessConfigurationError("Claude Code requires an explicit API key");
  return { harness: createClaudeCode({ auth: { ANTHROPIC_API_KEY: options.apiKey,
    ...(options.baseUrl ? { ANTHROPIC_BASE_URL: options.baseUrl } : {}) } }),
    model: options.model, requiresNetworkSandbox: true, clientQuestions: "native" };
}
