import { loadHarnessSkills,type SkillDependencies,type HarnessSkillDocument } from "./service.js";

/** A single assignment resolver serves the current chat and the native HarnessAgent. */
export async function resolveAgentSkills(deps: SkillDependencies, organizationId: string, selectedNames?: string[]) {
  const skills = await loadHarnessSkills(deps, organizationId, selectedNames);
  return { skills,instructions: buildAgentSkillInstructions(skills) };
}

export function buildAgentSkillInstructions(skills: readonly HarnessSkillDocument[]) {
  return [
    "Skill 是包含操作方法、参考资料和脚本的技能包，tool 是可执行接口；两者不是同一概念。",
    "按目标选择技能，使用Harness原生技能目录按需阅读SKILL.md及引用文件。阅读脚本不等于执行，只有实际执行工具成功后才能报告运行结果。",
    "平台内的表格、表单、自动化和报告使用现有组件。自定义 HTML/CSS/JS 可以用 Harness 原生文件工具生成，并通过真实可用的表格 API 或 SDK 联动；本平台尚无内置 HTML 站点托管、发布、下载入口或 kind=site 预览，不能把工作区文件或本地地址称为已发布网站。",
    skills.length ? `此智能体可用技能：\n${skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}` : "此智能体没有启用的技能。实际提供的业务工具仍可使用。",
  ].join("\n");
}
