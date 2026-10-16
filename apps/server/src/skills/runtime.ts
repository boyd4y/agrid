import { loadHarnessSkills } from "./service.js";
import { buildAgentSkillInstructions } from "../business/skills/runtime.js";
import { siteSdkUrl } from "../sites/capabilities.js";
export async function resolveAgentSkills(organizationId: string, selectedNames?: string[], sdkUrl = siteSdkUrl()) {
  const skills = await loadHarnessSkills(organizationId, selectedNames);
  return { skills,instructions: buildAgentSkillInstructions(skills, sdkUrl) };
}
