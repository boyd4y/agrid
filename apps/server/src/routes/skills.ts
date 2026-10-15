import { createSkillsRoute } from "../business/http/skills.js";
import { acquireRequestScope } from "../services/http-scope.js";
export const skillsRoute = createSkillsRoute(acquireRequestScope);
