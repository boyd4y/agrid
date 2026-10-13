import { tool, zodSchema, type ToolSet } from "ai";
import { z } from "zod";
import { loadHarnessSkills } from "./service.js";

/** A single assignment resolver serves the current chat and the native HarnessAgent. */
export async function resolveAgentSkills(organizationId: string, selectedNames?: string[]) {
  const skills = await loadHarnessSkills(organizationId, selectedNames);
  const tools: ToolSet = {
    read_skill: tool({
      description: "读取此智能体已分配且工作区已启用的技能。省略 path 读取完整说明和文件清单；提供相对路径读取 scripts/references 等附件。读取文件不执行脚本。",
      inputSchema: zodSchema(z.strictObject({ name: z.string().min(1).max(64), path: z.string().max(240).optional() })),
      execute: async ({ name, path }) => {
        const skill = skills.find((item) => item.name === name);
        if (!skill) throw new Error("技能不存在、已停用或未分配给此智能体");
        if (!path || path === "SKILL.md") return { name: skill.name, description: skill.description, content: skill.content, files: skill.files?.map((file) => file.path) ?? [] };
        const file = skill.files?.find((item) => item.path === path);
        if (!file) throw new Error("技能文件不存在，请使用文件清单中的相对路径");
        return file;
      },
    }),
  };
  const instructions = [
    "Skill 是包含操作方法、参考资料和脚本的技能包，tool 是可执行接口；两者不是同一概念。",
    "按业务目标选择技能，先 read_skill 阅读说明，按需读取引用文件，再执行所需步骤。没有提供的脚本执行能力不得宣称已运行。",
    "标准模式优先使用产品现有组件；仅在用户需要定制 UI 时考虑 HTML 单页面。Site 独立包和 client 引用尚未提供，不得宣称已创建或发布 Site。",
    skills.length ? `此智能体可用技能：\n${skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}` : "此智能体没有启用的技能。实际提供的业务工具仍可使用。",
  ].join("\n");
  return { skills, tools, instructions };
}
