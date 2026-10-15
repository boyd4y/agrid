import type { CommandDependencies } from "../dependencies.js";
export type IntegrationCapabilities = Readonly<{
  publicUrl: string;
  encryptionKey: string;
  bodyLimit: number;
  fetch: typeof fetch;
}>;
export type IntegrationDependencies = CommandDependencies & IntegrationCapabilities;
