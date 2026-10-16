export const HARNESSES = ["codex", "claude", "pi"] as const;
export type HarnessId = (typeof HARNESSES)[number];
export const NATIVE_DEFAULT_MODEL = "__harness_default__";

export type { RuntimeMode } from "@tabdo/shared";
export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export { ConfigurationError as HarnessConfigurationError } from "@tabdo/core/errors";
