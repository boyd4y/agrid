import { createRowsRoute } from "@tabdo/backend/http/rows";
import { acquireNodeBackendScope } from "../services/http-scope.js";
export const rowsRoute = createRowsRoute(acquireNodeBackendScope);
