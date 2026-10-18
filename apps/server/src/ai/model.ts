import { listRuntimeProviders } from "../business/agent/sandbox-configuration.js";
import type { RuntimeProviderStatus } from "@tabdo/shared";
import { resolvePiProvider } from "../business/agent/runtime-configuration.js";

import { HARNESSES, NATIVE_DEFAULT_MODEL, type HarnessId } from "../harness/contracts.js";
export { HARNESSES, NATIVE_DEFAULT_MODEL, type HarnessId } from "../harness/contracts.js";
export type HarnessStatus = {
  id: HarnessId; label: string; available: boolean;
  models: { id: string; label: string }[]; defaultModel: string;
  provider?: "openai" | "anthropic" | "pi";
  runtimeModes: ("local" | "sandbox")[]; defaultRuntime: "local" | "sandbox";
  runtimeProviders: RuntimeProviderStatus[];
  hint?: string;
};
const env = (name: string) => process.env[name]?.trim();
export function listProviders() {
  const selected = resolvePiProvider(process.env);
  return [{ id: "pi", label: "Pi", available: Boolean(selected), baseURL: selected?.baseUrl ?? null,
    defaultModel: selected?.defaultModel || NATIVE_DEFAULT_MODEL,
    models: selected?.defaultModel ? [{ id: selected.defaultModel, label: selected.defaultModel }] : [],
    ...(!selected ? { hint: "需要配置 PI_API_KEY、PI_BASE_URL 和 PI_MODEL" } : {}) }];
}
export function listHarnesses(): HarnessStatus[] {
  const runtimes = (harness: HarnessId): { runtimeProviders: RuntimeProviderStatus[]; configured: boolean; defaultRuntime: "local" | "sandbox" } => {
    const runtimeProviders = listRuntimeProviders(process.env, harness);
    const local = runtimeProviders.some(entry => entry.id === "local" && entry.available);
    const remote = runtimeProviders.some(entry => entry.id !== "local" && entry.available);
    return { runtimeProviders, configured: local || remote, defaultRuntime: harness === "pi" && local && env("NODE_ENV") !== "production" ? "local" : remote ? "sandbox" : "local" };
  };
  const codexRuntime = runtimes("codex"), claudeRuntime = runtimes("claude"), piRuntime = runtimes("pi"), selectedPi = resolvePiProvider(process.env);
  const codex = Boolean(env("OPENAI_API_KEY") || env("CODEX_API_KEY")), claude = Boolean(env("ANTHROPIC_API_KEY") || env("CLAUDE_API_KEY"));
  const pi = Boolean(selectedPi);
  const nativeModels = (name: string) => [...(env(name) ? [{ id: env(name)!, label: env(name)! }] : []), { id: NATIVE_DEFAULT_MODEL, label: "Harness 默认模型" }];
  return [
    { id: "codex", label: "Codex", available: codexRuntime.configured && codex, provider: "openai", models: nativeModels("CODEX_MODEL"), defaultModel: env("CODEX_MODEL") || NATIVE_DEFAULT_MODEL, runtimeModes: ["local", "sandbox"], runtimeProviders: codexRuntime.runtimeProviders, defaultRuntime: codexRuntime.defaultRuntime, hint: !codex ? "需要 OpenAI Responses 配置" : !codexRuntime.configured ? "需要配置运行提供商" : undefined },
    { id: "claude", label: "Claude Code", available: claudeRuntime.configured && claude, provider: "anthropic", models: nativeModels("CLAUDE_MODEL"), defaultModel: env("CLAUDE_MODEL") || NATIVE_DEFAULT_MODEL, runtimeModes: ["local", "sandbox"], runtimeProviders: claudeRuntime.runtimeProviders, defaultRuntime: claudeRuntime.defaultRuntime, hint: !claude ? "需要 Anthropic Messages 配置" : !claudeRuntime.configured ? "需要配置运行提供商" : undefined },
    { id: "pi", label: "Pi", available: piRuntime.configured && pi, provider: "pi", models: nativeModels("PI_MODEL"), defaultModel: selectedPi?.defaultModel || NATIVE_DEFAULT_MODEL, runtimeModes: ["local", "sandbox"], runtimeProviders: piRuntime.runtimeProviders, defaultRuntime: piRuntime.defaultRuntime, hint: !pi ? "需要配置 PI_API_KEY、PI_BASE_URL 和 PI_MODEL" : !piRuntime.configured ? "需要配置运行提供商" : undefined },
  ];
}
export const anyHarnessAvailable = () => listHarnesses().some((h) => h.available);
