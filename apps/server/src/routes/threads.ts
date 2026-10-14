import { createThreadsRoute } from "@tabdo/backend/http/threads";
import { acquireNodeBackendScope } from "../services/http-scope.js";
export const threadsRoute = createThreadsRoute(acquireNodeBackendScope);
