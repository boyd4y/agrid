// Contracts only. Factories/schema are explicit subpaths, with no global resources.
export type { PlatformDatabase } from "./db/factory.js";
export type { PlatformAuth } from "./auth/factory.js";
export type { DatabaseResource } from "./db/factory.js";
export type { DatabaseDependencies, RuntimeDependencies, CommandDependencies } from "./dependencies.js";
