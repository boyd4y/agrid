import type { PlatformDatabase } from "./db/factory.js";

export type DatabaseDependencies = Readonly<{ database: PlatformDatabase }>;
export type RuntimeDependencies = DatabaseDependencies & Readonly<{
  now(): Date;
  uuid(): string;
}>;
export type CommandDependencies = RuntimeDependencies & Readonly<{
  automationQueueName: string;
}>;
