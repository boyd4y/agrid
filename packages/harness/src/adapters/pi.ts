import { createPi, type PiHarnessSettings } from "@ai-sdk/harness-pi";
import { HarnessConfigurationError, type HarnessAdapter } from "../index.js";

export type PiCompletion = { finishReason: string; outputTokens: number; reasoningTokens: number };
export type PiAdapterConfig = {
  providerId: string;
  apiKey: string;
  baseUrl: string;
  model: { id: string; name?: string; contextWindow: number; maxTokens: number; reasoning: boolean };
  maxTokensField: "max_tokens" | "max_completion_tokens";
  samplingParams?: Record<string, unknown>;
  reattachInProcess?: boolean;
  thinkingLevel?: PiHarnessSettings["thinkingLevel"];
  onMessageEnd?: (completion: PiCompletion) => void;
  consumeContinuationInput?: () => string | undefined;
};

export function createPiAdapter(options: PiAdapterConfig): HarnessAdapter {
  if (!options.apiKey.trim() || !options.baseUrl.trim() || !options.providerId.trim() || !options.model.id.trim())
    throw new HarnessConfigurationError("Pi requires an explicit provider, endpoint, API key and model");
  for (const value of [options.model.contextWindow, options.model.maxTokens])
    if (!Number.isSafeInteger(value) || value < 1) throw new HarnessConfigurationError("Invalid model token limits");
  const harness = createPi({
    auth: {},
    reattachInProcess: options.reattachInProcess ?? true,
    thinkingLevel: options.thinkingLevel ?? "off",
    extensionFactories: options.onMessageEnd || options.consumeContinuationInput ? [(pi) => {
      if (options.consumeContinuationInput) pi.on("input", (event) => {
        if (event.text !== "") return { action: "continue" };
        const text = options.consumeContinuationInput!();
        return text === undefined ? { action: "continue" } : { action: "transform", text };
      });
      if (options.onMessageEnd) pi.on("message_end", (event) => {
        if (event.message.role !== "assistant") return;
        options.onMessageEnd!({ finishReason: event.message.stopReason,
          outputTokens: event.message.usage.output, reasoningTokens: event.message.usage.reasoning ?? 0 });
      });
    }] : undefined,
    providers: { [options.providerId]: {
      baseUrl: options.baseUrl, apiKey: options.apiKey, authHeader: true, api: "openai-completions",
      models: [{ ...options.model, name: options.model.name ?? options.model.id, input: ["text"],
        compat: { maxTokensField: options.maxTokensField },
        samplingParams: { ...options.samplingParams, [options.maxTokensField]: options.model.maxTokens },
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    } },
  });
  return { harness, model: `${options.providerId}/${options.model.id}`, requiresNetworkSandbox: false, clientQuestions: "common" };
}
