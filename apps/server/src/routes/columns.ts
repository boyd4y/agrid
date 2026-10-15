import { createColumnsRoute } from "../business/http/columns.js";
import { acquireRequestScope } from "../services/http-scope.js";
export const columnsRoute = createColumnsRoute(acquireRequestScope);
