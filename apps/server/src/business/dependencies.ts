import type { SystemServices } from "@tabdo/core/services";
import type { ServerDatabase } from "./db/factory.js";

export type DatabaseDependencies = Readonly<{ database: ServerDatabase }>;
export type RuntimeDependencies = DatabaseDependencies & SystemServices;
export type CommandDependencies = RuntimeDependencies & Readonly<{
  automationQueueName: string;
}>;
