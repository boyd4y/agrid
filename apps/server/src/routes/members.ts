import { createMembersRoute } from "@tabdo/backend/http/members";
import { acquireNodeBackendScope } from "../services/http-scope.js";
export const membersRoute = createMembersRoute(acquireNodeBackendScope);
