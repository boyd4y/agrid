import { loadHarnessSkills,type SkillDependencies,type HarnessSkillDocument } from "./service.js";

/** A single assignment resolver serves the current chat and the native HarnessAgent. */
export async function resolveAgentSkills(deps: SkillDependencies, organizationId: string, selectedNames?: string[]) {
  const skills = await loadHarnessSkills(deps, organizationId, selectedNames);
  return { skills,instructions: buildAgentSkillInstructions(skills) };
}

export function buildAgentSkillInstructions(skills: readonly HarnessSkillDocument[], sdkUrl?: string) {
  return [
    "Skill 是包含操作方法、参考资料和脚本的技能包，tool 是可执行接口；两者不是同一概念。",
    "按目标选择技能，使用Harness原生技能目录按需阅读SKILL.md及引用文件。阅读脚本不等于执行，只有实际执行工具成功后才能报告运行结果。",
    "自定义站点使用Site Skill、save_site持久保存HTML/CSS/JS文件，通过open_preview(kind=site,siteId)打开真实预览。浏览器SDK从部署配置的外部URL导入，不复制SDK源码或生成本地tabdo.js。发布使用publish_site指定revisionId，保存与发布不同；仅在用户要求发布时执行，不能把原生工作区文件或本地监听地址当作已发布站点。",
    ...(sdkUrl ? [`当前部署固定的浏览器SDK地址：${JSON.stringify(sdkUrl)}。纯HTML页面用此完整URL进行ES module导入；此配置由平台提供，不需要用户选择来源。`] : []),
    skills.length ? `此智能体可用技能：\n${skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}` : "此智能体没有启用的技能。实际提供的业务工具仍可使用。",
  ].join("\n");
}
