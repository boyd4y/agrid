import type { HarnessV1 } from "@ai-sdk/harness";
import type { HarnessAgent, HarnessAgentSettings } from "@ai-sdk/harness/agent";
import type { ToolSet } from "ai";
export { ConfigurationError as HarnessConfigurationError } from "@tabdo/core/errors";
import { ConfigurationError as HarnessConfigurationError } from "@tabdo/core/errors";

/** Configuration for the supported official SDK harnesses. */
export type HarnessAdapter = Readonly<{
  harness: HarnessV1;
  model?: string;
  requiresNetworkSandbox: boolean;
  clientQuestions: "common" | "native";
}>;
export type NativeAgent = HarnessAgent<HarnessV1, ToolSet>;
export type NativeAgentSettings = HarnessAgentSettings<HarnessV1, ToolSet>;

export function assertSandboxCompatibility(adapter: HarnessAdapter, networkAccessible: boolean): void {
  if (adapter.requiresNetworkSandbox && !networkAccessible)
    throw new HarnessConfigurationError("This harness requires a network-accessible sandbox");
}
