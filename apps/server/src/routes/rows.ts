import { createRowsRoute } from "../business/http/rows.js";
import { acquireRequestScope } from "../services/http-scope.js";
export const rowsRoute = createRowsRoute(acquireRequestScope);
