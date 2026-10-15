import { resolvePiModelMetadata as resolve } from "../business/agent/model-metadata.js";
import { businessCall } from "../services/dependencies.js";
import type { RuntimeEnvironment } from "./contracts.js";
export { DEFAULT_PI_OUTPUT_TOKENS, type PiModelMetadata, type PiCompletion } from "./model-contracts.js";
export function resolvePiModelMetadata(modelId: string | undefined, env: RuntimeEnvironment = process.env) {
  return businessCall(() => resolve(modelId, env));
}
