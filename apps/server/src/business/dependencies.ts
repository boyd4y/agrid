import type { SystemServices } from "@tabdo/core/services";
import type { ServerDatabase } from "./db/factory.js";
import type { Transaction } from "./db/types.js";
import type { BackgroundWakeup } from "./background.js";

export type DatabaseDependencies = Readonly<{ database: ServerDatabase }>;
export type RuntimeDependencies = DatabaseDependencies & SystemServices & Readonly<{
  wakeAfterCommit?(transaction: Transaction, wakeup: BackgroundWakeup): void;
}>;
export type CommandDependencies = RuntimeDependencies & Readonly<{
  automationQueueName: string;
}>;
