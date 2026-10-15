import { createThreadsRoute } from "../business/http/threads.js";
import { acquireRequestScope } from "../services/http-scope.js";
export const threadsRoute = createThreadsRoute(acquireRequestScope);
