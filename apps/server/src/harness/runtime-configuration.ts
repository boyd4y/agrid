import { HTTPException } from "hono/http-exception";
import * as configuration from "../business/agent/runtime-configuration.js";
import { mapServiceError } from "../services/dependencies.js";
import type { RuntimeEnvironment } from "./contracts.js";
import type { RuntimeProvider } from "@tabdo/shared";
import { assertRuntimeProviderAvailable, resolveRuntimeProvider } from "../business/agent/sandbox-configuration.js";
export type { NativeConfiguration, PiProviderConfiguration } from "../business/agent/runtime-configuration.js";
export function resolvePiModelId(modelId: string | undefined, env: RuntimeEnvironment) {
  try { return configuration.resolvePiModelId(modelId, env); }
  catch (error) { return mapServiceError(error); }
}
const value = (env: RuntimeEnvironment, name: string) => env[name]?.trim() || undefined;
export function sandboxCredentials(env: RuntimeEnvironment) {
  const token = value(env, "VERCEL_TOKEN"),
    teamId = value(env, "VERCEL_TEAM_ID"),
    projectId = value(env, "VERCEL_PROJECT_ID");
  if (token && teamId && projectId) return { token, teamId, projectId };
  if (value(env, "VERCEL_OIDC_TOKEN")) return {};
  throw new HTTPException(503, {
    message:
      "Sandbox 未配置：需要 VERCEL_TOKEN、VERCEL_TEAM_ID、VERCEL_PROJECT_ID，或部署环境的 VERCEL_OIDC_TOKEN",
  });
}

export function resolveNativeConfiguration(options: Parameters<typeof configuration.resolveNativeConfiguration>[0] & { provider?: RuntimeProvider }) {
  try {
    assertRuntimeProviderAvailable(options.provider ?? resolveRuntimeProvider(options.mode, undefined, options.env), options.env, options.harness);
    return configuration.resolveNativeConfiguration(options);
  } catch (error) { return mapServiceError(error); }
}
