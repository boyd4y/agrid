import type { HarnessV1NetworkSandboxSession, HarnessV1SandboxSessionCreateOptions, HarnessV1SandboxSessionResumeOptions } from "@ai-sdk/harness";
import type { SandboxAdapter as CoreSandboxAdapter, SandboxHandle as CoreSandboxHandle } from "@tabdo/core/sandbox";

// The SDK owns file, command and network APIs; these aliases only assemble its lifecycle.
export type SandboxCreateOptions = HarnessV1SandboxSessionCreateOptions<Record<never, never>>;
export type SandboxResumeOptions = HarnessV1SandboxSessionResumeOptions<Record<never, never>>;
export type SandboxHandle<Workspace = never> = CoreSandboxHandle<HarnessV1NetworkSandboxSession, Workspace>;
export type SandboxAdapter<Workspace = never> = CoreSandboxAdapter<SandboxCreateOptions, SandboxResumeOptions, HarnessV1NetworkSandboxSession, Workspace>;
export { SandboxConfigurationError } from "@tabdo/core/sandbox";
