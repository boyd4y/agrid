import { createIntegrationsRoute } from "../business/http/integrations.js";
import { acquireRequestScope } from "../services/http-scope.js";
export const integrationsRoute = createIntegrationsRoute(acquireRequestScope);
