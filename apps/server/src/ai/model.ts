import { getOpenRouterStatus, isOpenRouterAvailable, OPENROUTER_DEFAULT_MODEL, OPENROUTER_SHARED_MODELS, type OpenRouterProviderStatus } from "./providers/openrouter.js";

export const HARNESSES = ["codex", "claude", "pi"] as const;
export type HarnessId = (typeof HARNESSES)[number];
export const NATIVE_DEFAULT_MODEL = "__harness_default__";
export type HarnessStatus = {
  id: HarnessId; label: string; available: boolean;
  models: { id: string; label: string }[]; defaultModel: string;
  provider?: "openrouter" | "openai" | "anthropic" | "pi";
  runtimeModes: ("local" | "sandbox")[]; defaultRuntime: "local" | "sandbox";
  hint?: string;
};
const env = (name: string) => process.env[name]?.trim();
const hasSandbox = () => Boolean(env("VERCEL_OIDC_TOKEN") || (env("VERCEL_TOKEN") && env("VERCEL_TEAM_ID") && env("VERCEL_PROJECT_ID")));
export function listProviders(): OpenRouterProviderStatus[] { return [getOpenRouterStatus()]; }
export function listHarnesses(): HarnessStatus[] {
  const remote = hasSandbox(), router = isOpenRouterAvailable();
  const codex = Boolean(env("OPENAI_API_KEY") || env("CODEX_API_KEY")), claude = Boolean(env("ANTHROPIC_API_KEY") || env("CLAUDE_API_KEY"));
  const pi = router || Boolean(env("PI_API_KEY") && env("PI_BASE_URL"));
  const nativeModels = (name: string) => [...(env(name) ? [{ id: env(name)!, label: env(name)! }] : []), { id: NATIVE_DEFAULT_MODEL, label: "Harness 默认模型" }];
  return [
    { id: "codex", label: "Codex", available: remote && codex, provider: "openai", models: nativeModels("CODEX_MODEL"), defaultModel: env("CODEX_MODEL") || NATIVE_DEFAULT_MODEL, runtimeModes: ["sandbox"], defaultRuntime: "sandbox", hint: !codex ? "需要 OpenAI Responses 配置" : !remote ? "需要配置 Vercel Sandbox" : undefined },
    { id: "claude", label: "Claude Code", available: remote && claude, provider: "anthropic", models: nativeModels("CLAUDE_MODEL"), defaultModel: env("CLAUDE_MODEL") || NATIVE_DEFAULT_MODEL, runtimeModes: ["sandbox"], defaultRuntime: "sandbox", hint: !claude ? "需要 Anthropic Messages 配置" : !remote ? "需要配置 Vercel Sandbox" : undefined },
    { id: "pi", label: "Pi", available: pi, provider: router ? "openrouter" : "pi", models: router ? [...OPENROUTER_SHARED_MODELS] : nativeModels("PI_MODEL"), defaultModel: env("PI_MODEL") || (router ? OPENROUTER_DEFAULT_MODEL : NATIVE_DEFAULT_MODEL), runtimeModes: ["local", "sandbox"], defaultRuntime: "local", hint: !pi ? "需要 OpenRouter 或自定义 Pi 模型提供商配置" : undefined },
  ];
}
export const anyHarnessAvailable = () => listHarnesses().some((h) => h.available);
