import { createFilesRoute } from "@tabdo/backend/http/files";
import { acquireNodeBackendScope } from "../services/http-scope.js";
export const filesRoute = createFilesRoute(acquireNodeBackendScope);
