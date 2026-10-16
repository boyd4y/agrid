import { sandboxProviderSchema, type RuntimeMode, type RuntimeProvider, type RuntimeProviderStatus, type SandboxProvider } from "@tabdo/shared";
import { ServiceError } from "../errors.js";
import type { RuntimeEnvironment } from "./contracts.js";

const value = (env: RuntimeEnvironment, key: string) => env[key]?.trim();

export function resolveRuntimeProvider(mode: RuntimeMode, selected: SandboxProvider | undefined, env: RuntimeEnvironment): RuntimeProvider {
  if (mode === "local") return "local";
  const provider = sandboxProviderSchema.safeParse(selected ?? value(env, "SANDBOX_PROVIDER") ?? "vercel");
  if (!provider.success) throw new ServiceError(503, { message: "SANDBOX_PROVIDER 必须为 vercel、e2b 或 railway" });
  return provider.data;
}

export function listRuntimeProviders(env: RuntimeEnvironment, harness?: string): RuntimeProviderStatus[] {
  return [
    { id: "local", available: value(env, "HARNESS_LOCAL_ENABLED") !== "false", hint: "Local 只适用于受信任的开发或专用容器环境；目录不是操作系统隔离" },
    { id: "vercel", available: Boolean(value(env, "VERCEL_OIDC_TOKEN") || value(env, "VERCEL_TOKEN") && value(env, "VERCEL_TEAM_ID") && value(env, "VERCEL_PROJECT_ID")), hint: "需要 VERCEL_TOKEN、VERCEL_TEAM_ID、VERCEL_PROJECT_ID，或 VERCEL_OIDC_TOKEN" },
    { id: "e2b", available: Boolean(value(env, "E2B_API_KEY")) && (!harness || harness === "pi"),
      hint: harness && harness !== "pi" ? "当前版本 E2B 默认凭证代理与此 Harness 不兼容；请使用 Pi 或其他运行提供商" : "需要 E2B_API_KEY" },
    { id: "railway", available: Boolean(value(env, "RAILWAY_API_TOKEN") && value(env, "RAILWAY_SANDBOX_ENVIRONMENT_ID")
      && value(env, "RAILWAY_SANDBOX_ENVIRONMENT_ID") !== value(env, "RAILWAY_ENVIRONMENT_ID")), hint: "需要账户或工作区 RAILWAY_API_TOKEN 与独立的 RAILWAY_SANDBOX_ENVIRONMENT_ID；不能使用应用部署环境" },
  ];
}

export function assertRuntimeProviderAvailable(provider: RuntimeProvider, env: RuntimeEnvironment, harness?: string): void {
  const status = listRuntimeProviders(env, harness).find(entry => entry.id === provider);
  if (!status?.available) throw new ServiceError(503, { message: `${provider} 运行环境不可用：${status?.hint ?? "未知提供商"}` });
  const key = provider === "e2b" ? "E2B_TIMEOUT_MS" : provider === "railway" ? "RAILWAY_SANDBOX_IDLE_MINUTES" : undefined;
  const setting = key && value(env, key);
  if (key && setting && (!Number.isSafeInteger(Number(setting)) || Number(setting) < (provider === "e2b" ? 1 : 0)))
    throw new ServiceError(503, { message: `${key} 必须为${provider === "e2b" ? "正" : "非负"}整数` });
}
