import { createApiKeysRoute } from "@tabdo/backend/http/api-keys";
import { acquireNodeBackendScope } from "../services/http-scope.js";
export const apiKeysRoute = createApiKeysRoute(acquireNodeBackendScope);
