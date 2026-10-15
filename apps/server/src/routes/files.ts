import { createFilesRoute } from "../business/http/files.js";
import { acquireRequestScope } from "../services/http-scope.js";
export const filesRoute = createFilesRoute(acquireRequestScope);
