import * as service from "@tabdo/backend/integrations/agentmail";
import { integrationDependencies, integrationCapabilities } from "./dependencies.js";
import { decryptSecret } from "./secrets.js";
import { backendCall } from "../services/backend-facade.js";
type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;
export const agentMailRequest = (...args: Arguments<typeof service.agentMailRequest>) => backendCall(() => service.agentMailRequest(integrationCapabilities(), ...args));
export const agentMailInboxes = (...args: Arguments<typeof service.agentMailInboxes>) => backendCall(() => service.agentMailInboxes(integrationCapabilities(), ...args));
export const changeRemoteWebhook = (...args: Arguments<typeof service.changeRemoteWebhook>) => backendCall(() => service.changeRemoteWebhook(integrationCapabilities(), ...args));
export function connectionKey(connection: Parameters<typeof service.connectionKey>[1]) {
  return decryptSecret(connection.encryptedCredential, {organizationId:connection.organizationId,id:connection.id,purpose:"agentmail-key"});
}
export const hydrateAgentMailEvent = (...args: Arguments<typeof service.hydrateAgentMailEvent>) => backendCall(() => service.hydrateAgentMailEvent(integrationDependencies(), ...args));
export function normalizeAgentMailMessage(raw: unknown, fallback = new Date().toISOString()) { return service.normalizeAgentMailMessage(raw, fallback); }
