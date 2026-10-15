import type { IntegrationDependencies, IntegrationCapabilities } from "../business/integrations/dependencies.js";
import { commandDependencies } from "../services/dependencies.js";
export function integrationCapabilities(): IntegrationCapabilities {
  return {
    publicUrl: process.env.WEBHOOK_PUBLIC_URL || process.env.APP_URL || "http://localhost:5173",
    encryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY ?? "",
    bodyLimit: Number(process.env.WEBHOOK_MAX_BODY_BYTES ?? 2 * 1024 * 1024),
    fetch: (input, init) => fetch(input, init),
  };
}

export function integrationDependencies(): IntegrationDependencies {
  return { ...commandDependencies(), ...integrationCapabilities() };
}
