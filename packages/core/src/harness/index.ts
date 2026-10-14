/** Native SDK types are supplied by the implementation; no SDK is loaded by this contract. */
export type HarnessAdapter<Harness = unknown> = Readonly<{
  harness: Harness;
  model?: string;
  requiresNetworkSandbox: boolean;
  clientQuestions: "common" | "native";
}>;

export class HarnessConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = "HarnessConfigurationError"; }
}

export function assertSandboxCompatibility(adapter: HarnessAdapter, networkAccessible: boolean): void {
  if (adapter.requiresNetworkSandbox && !networkAccessible)
    throw new HarnessConfigurationError("This harness requires a network-accessible sandbox");
}
