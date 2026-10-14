import * as service from "@tabdo/backend/integrations/management";
import { integrationDependencies, integrationCapabilities } from "./dependencies.js";
import { backendCall } from "../services/backend-facade.js";
export { canManageIntegrations, connectionFields, endpointFields, publicConnection } from "@tabdo/backend/integrations/management";
export const receiveUrl = (endpoint: Parameters<typeof service.receiveUrl>[1]) => service.receiveUrl(integrationCapabilities(), endpoint);
export const publicEndpoint = (endpoint: Parameters<typeof service.publicEndpoint>[1]) => service.publicEndpoint(integrationCapabilities(), endpoint);
export const ownedConnection = (id: string, org: string) => backendCall(() => service.ownedConnection(integrationDependencies(), id, org));
export const ownedEndpoint = (id: string, org: string) => backendCall(() => service.ownedEndpoint(integrationDependencies(), id, org));
