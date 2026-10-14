import type { ActorDependencies } from "@tabdo/backend/auth/actor";
import type { CommandDependencies, RuntimeDependencies } from "@tabdo/backend/dependencies";
import type { SkillDocument } from "@tabdo/shared";

/** Each HTTP operation/gateway callback owns and releases its explicit resources. */
export type ProductScope = Readonly<{
  runtime: RuntimeDependencies;
  commands: CommandDependencies;
  identity: ActorDependencies;
  builtins: readonly SkillDocument[];
  close(): Promise<void>;
}>;
export type AcquireProductScope<Env> = (env: Env) => Promise<ProductScope>;
