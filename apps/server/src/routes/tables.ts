import { createTablesRoute } from "@tabdo/backend/http/tables";
import { acquireNodeBackendScope } from "../services/http-scope.js";
export const tablesRoute = createTablesRoute(acquireNodeBackendScope);
