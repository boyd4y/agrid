import { createTablesRoute } from "../business/http/tables.js";
import { acquireRequestScope } from "../services/http-scope.js";
export const tablesRoute = createTablesRoute(acquireRequestScope);
