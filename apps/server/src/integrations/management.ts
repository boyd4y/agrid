import * as service from "../business/integrations/management.js";
import { integrationDependencies, integrationCapabilities } from "./dependencies.js";
import { businessCall } from "../services/dependencies.js";
export { canManageIntegrations, connectionFields, endpointFields, publicConnection } from "../business/integrations/management.js";
export const receiveUrl = (endpoint: Parameters<typeof service.receiveUrl>[1]) => service.receiveUrl(integrationCapabilities(), endpoint);
export const publicEndpoint = (endpoint: Parameters<typeof service.publicEndpoint>[1]) => service.publicEndpoint(integrationCapabilities(), endpoint);
export const ownedConnection = (id: string, org: string) => businessCall(() => service.ownedConnection(integrationDependencies(), id, org));
export const ownedEndpoint = (id: string, org: string) => businessCall(() => service.ownedEndpoint(integrationDependencies(), id, org));
