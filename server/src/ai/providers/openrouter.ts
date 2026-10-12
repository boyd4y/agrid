/**
 * Standalone OpenRouter AI provider — reusable by any harness / settings UI.
 * Not nested under Pi; Pi/Codex/Claude may all route through this provider.
 */
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export const OPENROUTER_PROVIDER_ID = "openrouter" as const;

export type OpenRouterProviderStatus = {
  id: typeof OPENROUTER_PROVIDER_ID;
  label: string;
  available: boolean;
  baseURL: string | null;
  defaultModel: string;
  models: { id: string; label: string }[];
  hint?: string;
};

function env(name: string) {
  return process.env[name]?.trim() || null;
}

export function getOpenRouterCredentials(): {
  key: string;
  baseURL: string;
} | null {
  const key = env("OPENROUTER_API_KEY");
  if (!key) return null;
  return {
    key,
    baseURL: env("OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1",
  };
}

export const OPENROUTER_SHARED_MODELS = [
  { id: "openrouter/free", label: "OpenRouter Free" },
  { id: "openrouter/auto", label: "OpenRouter Auto" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
  { id: "anthropic/claude-opus-4", label: "Claude Opus 4" },
  { id: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
] as const;

export const OPENROUTER_DEFAULT_MODEL =
  env("OPENROUTER_MODEL") || "openrouter/free";

export function getOpenRouterStatus(): OpenRouterProviderStatus {
  const creds = getOpenRouterCredentials();
  return {
    id: OPENROUTER_PROVIDER_ID,
    label: "OpenRouter",
    available: Boolean(creds),
    baseURL: creds?.baseURL ?? null,
    defaultModel: OPENROUTER_DEFAULT_MODEL,
    models: [...OPENROUTER_SHARED_MODELS],
    hint: creds
      ? undefined
      : "Set OPENROUTER_API_KEY to enable OpenRouter for all harnesses",
  };
}

export function createOpenRouterModel(modelId?: string): {
  model: LanguageModel;
  modelId: string;
  provider: typeof OPENROUTER_PROVIDER_ID;
} | null {
  const creds = getOpenRouterCredentials();
  if (!creds) return null;
  const mid = modelId || OPENROUTER_DEFAULT_MODEL;
  const client = createOpenAI({
    apiKey: creds.key,
    baseURL: creds.baseURL,
    name: "openrouter",
    headers: {
      "HTTP-Referer": env("APP_URL") || "http://localhost:5173",
      "X-Title": "Agrid",
    },
  });
  return {
    model: client.chat(mid),
    modelId: mid,
    provider: OPENROUTER_PROVIDER_ID,
  };
}

export function isOpenRouterAvailable() {
  return Boolean(getOpenRouterCredentials());
}
