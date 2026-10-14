import { createIntegrationsRoute } from "@tabdo/backend/http/integrations";
import { acquireNodeBackendScope } from "../services/http-scope.js";
export const integrationsRoute = createIntegrationsRoute(acquireNodeBackendScope);
