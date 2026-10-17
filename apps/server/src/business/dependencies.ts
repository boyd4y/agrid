import type { SystemServices } from "@tabdo/core/services";
import type { ServerDatabase } from "./db/factory.js";
import type { Transaction } from "./db/types.js";
import type { BackgroundWakeup } from "./background.js";

export type DatabaseDependencies = Readonly<{
  database: ServerDatabase;
  /** Trusted invocation scope, captured by HTTP identity or loaded from a persisted task. */
  workspaceId?: string;
}>;
export type RuntimeDependencies = DatabaseDependencies & SystemServices & Readonly<{
  afterRollback?(transaction: Transaction, key: string, effect: () => void | Promise<void>): void;
  afterCommit?(transaction: Transaction, key: string, effect: () => void): void;
  wakeAfterCommit?(transaction: Transaction, wakeup: BackgroundWakeup): void;
}>;
export type CommandDependencies = RuntimeDependencies & Readonly<{
  automationQueueName: string;
  sites?: import("./sites/dependencies.js").SiteCapabilities;
}>;
