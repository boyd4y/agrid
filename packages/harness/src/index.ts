import type { HarnessV1 } from "@ai-sdk/harness";
import type { HarnessAgent, HarnessAgentSettings } from "@ai-sdk/harness/agent";
import type { ToolSet } from "ai";

/** Provider configuration only. Applications own users, prompts, tools and persistence. */
export type HarnessAdapter = Readonly<{
  harness: HarnessV1;
  model?: string;
  requiresNetworkSandbox: boolean;
  clientQuestions: "common" | "native";
}>;
export type NativeAgent = HarnessAgent<HarnessV1, ToolSet>;
export type NativeAgentSettings = HarnessAgentSettings<HarnessV1, ToolSet>;

export class HarnessConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = "HarnessConfigurationError"; }
}

export function assertSandboxCompatibility(adapter: HarnessAdapter, networkAccessible: boolean) {
  if (adapter.requiresNetworkSandbox && !networkAccessible)
    throw new HarnessConfigurationError("This harness requires a network-accessible sandbox");
}
