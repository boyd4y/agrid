import { loadHarnessSkills } from "./service.js";
import { buildAgentSkillInstructions } from "@tabdo/backend/skills/runtime";
export async function resolveAgentSkills(organizationId: string, selectedNames?: string[]) {
  const skills = await loadHarnessSkills(organizationId, selectedNames);
  return { skills,instructions: buildAgentSkillInstructions(skills) };
}
