import { HarnessAgent } from "@ai-sdk/harness/agent";
import { HARNESS_V1_BUILTIN_TOOLS } from "@ai-sdk/harness";
import type { HarnessV1 } from "@ai-sdk/harness";
import type { ToolSet } from "ai";
import type { HarnessAdapter, NativeAgent, NativeAgentSettings } from "./index.js";

// SDK settings are a union (activeTools or inactiveTools); preserve exclusivity.
type WithoutAdapter<T> = T extends unknown ? Omit<T, "harness" | "model"> : never;

/** Assemble the official agent; no application defaults or replacement tool loop. */
export function createHarnessAgent(adapter: HarnessAdapter, settings: WithoutAdapter<NativeAgentSettings>): NativeAgent {
  return new HarnessAgent<HarnessV1, ToolSet>({
    ...settings,
    harness: adapter.harness,
    model: adapter.model,
    tools: { ...settings.tools, ...(adapter.clientQuestions === "common"
      ? { askUserQuestions: HARNESS_V1_BUILTIN_TOOLS.askUserQuestions } : {}) },
  });
}
