import { createWebhookEndpointsRoute, createWebhooksRoute } from "@tabdo/backend/http/webhooks";
import { acquireNodeBackendScope } from "../services/http-scope.js";
export const webhookEndpointsRoute = createWebhookEndpointsRoute(acquireNodeBackendScope);
export const webhooksRoute = createWebhooksRoute(acquireNodeBackendScope);
