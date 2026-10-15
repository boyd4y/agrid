import { createApiKeysRoute } from "../business/http/api-keys.js";
import { acquireRequestScope } from "../services/http-scope.js";
export const apiKeysRoute = createApiKeysRoute(acquireRequestScope);
