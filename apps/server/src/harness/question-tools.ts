import { HARNESS_V1_BUILTIN_TOOLS } from "@ai-sdk/harness";
import type { ToolSet } from "ai";
import type { HarnessId } from "../ai/model.js";

/** Claude exposes the reserved common tool through its native AskUserQuestion. */
export function nativeQuestionTools(harness: HarnessId): ToolSet {
  return harness === "claude" ? {} : { askUserQuestions: HARNESS_V1_BUILTIN_TOOLS.askUserQuestions };
}
