import { createMembersRoute } from "../business/http/members.js";
import { acquireRequestScope } from "../services/http-scope.js";
export const membersRoute = createMembersRoute(acquireRequestScope);
