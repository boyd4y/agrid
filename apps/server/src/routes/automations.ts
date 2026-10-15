import { createAutomationsRoute } from "../business/http/automations.js";
import { acquireRequestScope } from "../services/http-scope.js";
export const automationsRoute = createAutomationsRoute(acquireRequestScope);
