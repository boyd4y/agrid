import { createAutomationsRoute } from "@tabdo/backend/http/automations";
import { acquireNodeBackendScope } from "../services/http-scope.js";
export const automationsRoute = createAutomationsRoute(acquireNodeBackendScope);
