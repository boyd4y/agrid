import type { HarnessV1NetworkSandboxSession, HarnessV1SandboxSessionCreateOptions, HarnessV1SandboxSessionResumeOptions } from "@ai-sdk/harness";

export type SandboxCreateOptions = HarnessV1SandboxSessionCreateOptions<Record<never, never>>;
export type SandboxResumeOptions = HarnessV1SandboxSessionResumeOptions<Record<never, never>>;
export type SandboxHandle<Workspace = never> = Readonly<{ session: HarnessV1NetworkSandboxSession; workspace?: Workspace }>;

/** Lifecycle assembly only. File/process/network operations use the SDK's session directly. */
export interface SandboxAdapter<Workspace = never> {
  readonly networkAccessible: boolean;
  create(options?: SandboxCreateOptions): Promise<SandboxHandle<Workspace>>;
  resume(options: SandboxResumeOptions): Promise<SandboxHandle<Workspace>>;
}
export class SandboxConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = "SandboxConfigurationError"; }
}
