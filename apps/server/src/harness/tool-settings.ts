import { validateDisabledTools as validate } from "@tabdo/backend/services/tool-settings";
import { mapServiceError } from "../services/backend-facade.js";
import type { HarnessId } from "./contracts.js";
export function validateDisabledTools(harness: HarnessId, disabledTools: readonly string[] = []) {
  try { return validate(harness, disabledTools); }
  catch (error) { return mapServiceError(error); }
}
