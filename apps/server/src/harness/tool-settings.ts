import { validateDisabledTools as validate } from "../business/services/tool-settings.js";
import { mapServiceError } from "../services/dependencies.js";
import type { HarnessId } from "./contracts.js";
export function validateDisabledTools(harness: HarnessId, disabledTools: readonly string[] = []) {
  try { return validate(harness, disabledTools); }
  catch (error) { return mapServiceError(error); }
}
