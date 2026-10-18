import * as service from "../business/integrations/agentmail.js";
import { integrationDependencies, integrationCapabilities } from "./dependencies.js";
import { businessCall } from "../services/dependencies.js";
type Arguments<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;
export const agentMailRequest = (...args: Arguments<typeof service.agentMailRequest>) => businessCall(() => service.agentMailRequest(integrationCapabilities(), ...args));
export const agentMailInboxes = (...args: Arguments<typeof service.agentMailInboxes>) => businessCall(() => service.agentMailInboxes(integrationCapabilities(), ...args));
export const changeRemoteWebhook = (...args: Arguments<typeof service.changeRemoteWebhook>) => businessCall(() => service.changeRemoteWebhook(integrationCapabilities(), ...args));
export function connectionKey(connection: Parameters<typeof service.connectionKey>[1]) {
  return businessCall(() => service.connectionKey(integrationCapabilities(), connection));
}
export const hydrateAgentMailEvent = (...args: Arguments<typeof service.hydrateAgentMailEvent>) => businessCall(() => service.hydrateAgentMailEvent(integrationDependencies(), ...args));
export function normalizeAgentMailMessage(raw: unknown, fallback = new Date().toISOString()) { return service.normalizeAgentMailMessage(raw, fallback); }

export const sendAgentMailMessage = (...args: Arguments<typeof service.sendAgentMailMessage>) => businessCall(() => service.sendAgentMailMessage(integrationDependencies(), ...args));
export const replyAgentMailMessage = (...args: Arguments<typeof service.replyAgentMailMessage>) => businessCall(() => service.replyAgentMailMessage(integrationDependencies(), ...args));
