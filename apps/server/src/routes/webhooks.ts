import { createWebhookEndpointsRoute, createWebhooksRoute } from "../business/http/webhooks.js";
import { acquireRequestScope } from "../services/http-scope.js";
export const webhookEndpointsRoute = createWebhookEndpointsRoute(acquireRequestScope);
export const webhooksRoute = createWebhooksRoute(acquireRequestScope);
