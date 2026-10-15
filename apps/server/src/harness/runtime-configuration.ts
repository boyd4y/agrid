import { HTTPException } from "hono/http-exception";
import * as configuration from "@tabdo/backend/agent/runtime-configuration";
import { mapServiceError } from "../services/backend-facade.js";
import type { RuntimeEnvironment } from "./contracts.js";
export type { NativeConfiguration, PiProviderConfiguration } from "@tabdo/backend/agent/runtime-configuration";
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

export function resolveNativeConfiguration(options: Parameters<typeof configuration.resolveNativeConfiguration>[0]) {
  try {
    if (options.mode === "sandbox") sandboxCredentials(options.env);
    return configuration.resolveNativeConfiguration(options);
  } catch (error) { return mapServiceError(error); }
}
