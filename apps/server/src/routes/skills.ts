import { createSkillsRoute } from "@tabdo/backend/http/skills";
import { acquireNodeBackendScope } from "../services/http-scope.js";
export const skillsRoute = createSkillsRoute(acquireNodeBackendScope);
