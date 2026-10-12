import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import {
  createOpenRouterModel,
  getOpenRouterStatus,
  isOpenRouterAvailable,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_SHARED_MODELS,
  type OpenRouterProviderStatus,
} from "./providers/openrouter.js";

/** Harness = runtime personality / tool loop. Providers (OpenRouter, …) supply models. */
export const HARNESSES = ["codex", "claude", "pi"] as const;
export type HarnessId = (typeof HARNESSES)[number];

export type HarnessStatus = {
  id: HarnessId;
  label: string;
  available: boolean;
  models: { id: string; label: string }[];
  defaultModel: string;
  /** Which AI provider backs this harness when online */
  provider?: "openrouter" | "openai" | "anthropic" | "pi";
  hint?: string;
};

function env(name: string) {
  return process.env[name]?.trim() || null;
}

function piDirectCredentials(): { key: string; baseURL: string } | null {
  const piKey = env("PI_API_KEY");
  const piBase = env("PI_BASE_URL");
  if (piKey && piBase) return { key: piKey, baseURL: piBase };
  return null;
}

const FREE = OPENROUTER_DEFAULT_MODEL;

const CODEX_MODELS = [
  { id: FREE, label: "OpenRouter Free" },
  ...OPENROUTER_SHARED_MODELS.filter((m) => m.id.startsWith("openai/")),
];

const CLAUDE_MODELS = [
  { id: FREE, label: "OpenRouter Free" },
  ...OPENROUTER_SHARED_MODELS.filter((m) => m.id.startsWith("anthropic/")),
];

const PI_MODELS = [
  { id: FREE, label: "OpenRouter Free" },
  { id: "openrouter/auto", label: "OpenRouter Auto" },
  ...OPENROUTER_SHARED_MODELS.filter(
    (m) => !m.id.startsWith("openrouter/")
  ),
];

export function listProviders(): OpenRouterProviderStatus[] {
  return [getOpenRouterStatus()];
}

export function listHarnesses(): HarnessStatus[] {
  const or = isOpenRouterAvailable();
  const openaiKey = env("OPENAI_API_KEY") || env("CODEX_API_KEY");
  const anthropicKey = env("ANTHROPIC_API_KEY") || env("CLAUDE_API_KEY");
  const piDirect = piDirectCredentials();

  return [
    {
      id: "codex",
      label: or ? "Codex" : "Codex (OpenAI)",
      available: or || Boolean(openaiKey),
      models: CODEX_MODELS,
      defaultModel: env("CODEX_MODEL") || FREE,
      provider: or ? "openrouter" : openaiKey ? "openai" : undefined,
      hint: or || openaiKey ? undefined : "Set OPENROUTER_API_KEY",
    },
    {
      id: "claude",
      label: or ? "Claude" : "Claude (Anthropic)",
      available: or || Boolean(anthropicKey),
      models: CLAUDE_MODELS,
      defaultModel: env("CLAUDE_MODEL") || FREE,
      provider: or ? "openrouter" : anthropicKey ? "anthropic" : undefined,
      hint: or || anthropicKey ? undefined : "Set OPENROUTER_API_KEY",
    },
    {
      id: "pi",
      label: "Pi",
      available: or || Boolean(piDirect),
      models: PI_MODELS,
      defaultModel: env("PI_MODEL") || FREE,
      provider: or ? "openrouter" : piDirect ? "pi" : undefined,
      hint: or || piDirect ? undefined : "Set OPENROUTER_API_KEY",
    },
  ];
}

export function resolveModel(
  harness: HarnessId,
  modelId?: string
): {
  model: LanguageModel;
  harness: HarnessId;
  modelId: string;
  provider: string;
} | null {
  const statuses = listHarnesses();
  const status = statuses.find((h) => h.id === harness);
  if (!status?.available) return null;

  const mid = modelId || status.defaultModel;

  // Standalone OpenRouter provider — preferred for every harness
  const viaOr = createOpenRouterModel(mid);
  if (viaOr) {
    return {
      model: viaOr.model,
      harness,
      modelId: viaOr.modelId,
      provider: viaOr.provider,
    };
  }

  if (harness === "codex") {
    const key = env("OPENAI_API_KEY") || env("CODEX_API_KEY");
    if (!key) return null;
    const baseURL = env("OPENAI_BASE_URL") || env("CODEX_BASE_URL") || undefined;
    const openai = createOpenAI({
      apiKey: key,
      ...(baseURL ? { baseURL } : {}),
    });
    return { model: openai.chat(mid), harness, modelId: mid, provider: "openai" };
  }

  if (harness === "claude") {
    const key = env("ANTHROPIC_API_KEY") || env("CLAUDE_API_KEY");
    if (!key) return null;
    const anthropic = createAnthropic({ apiKey: key });
    return {
      model: anthropic(mid),
      harness,
      modelId: mid,
      provider: "anthropic",
    };
  }

  if (harness === "pi") {
    const pi = piDirectCredentials();
    if (!pi) return null;
    const openai = createOpenAI({
      apiKey: pi.key,
      baseURL: pi.baseURL,
      name: "pi",
    });
    return { model: openai.chat(mid), harness, modelId: mid, provider: "pi" };
  }

  return null;
}

export function anyHarnessAvailable() {
  return listHarnesses().some((h) => h.available);
}
