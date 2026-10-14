import type { HarnessV1 } from "@ai-sdk/harness";
import type { HarnessAgent, HarnessAgentSettings } from "@ai-sdk/harness/agent";
import type { ToolSet } from "ai";
import type { HarnessAdapter as CoreHarnessAdapter } from "@tabdo/core/harness";

/** Specialize the portable capability port with the official Node SDK types. */
export type HarnessAdapter = CoreHarnessAdapter<HarnessV1>;
export type NativeAgent = HarnessAgent<HarnessV1, ToolSet>;
export type NativeAgentSettings = HarnessAgentSettings<HarnessV1, ToolSet>;
export { HarnessConfigurationError, assertSandboxCompatibility } from "@tabdo/core/harness";
