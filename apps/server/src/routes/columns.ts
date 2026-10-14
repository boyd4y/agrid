import { createColumnsRoute } from "@tabdo/backend/http/columns";
import { acquireNodeBackendScope } from "../services/http-scope.js";
export const columnsRoute = createColumnsRoute(acquireNodeBackendScope);
