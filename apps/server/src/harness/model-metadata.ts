import { resolvePiModelMetadata as resolve } from "@tabdo/backend/agent/model-metadata";
import { backendCall } from "../services/backend-facade.js";
import type { RuntimeEnvironment } from "./contracts.js";
export { DEFAULT_PI_OUTPUT_TOKENS, type PiModelMetadata, type PiCompletion } from "./model-contracts.js";
export function resolvePiModelMetadata(modelId: string | undefined, env: RuntimeEnvironment = process.env) {
  return backendCall(() => resolve(modelId, env));
}
