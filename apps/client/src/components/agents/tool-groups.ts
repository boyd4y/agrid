import { PLATFORM_TOOL_IDS, type AgentToolCatalogItem } from "@tabdo/shared";

export type AgentToolGroup = { id: string; source: AgentToolCatalogItem["source"]; category: string; tools: AgentToolCatalogItem[] };
const platformToolIds = new Set<string>(PLATFORM_TOOL_IDS);
const platformCategories: Record<string, string> = {
  "表格与记录": "tables", "关联记录": "tables", "视图": "tables",
  "记录正文": "documents", "日历与预约": "calendar", "站点": "sites", "表单": "forms", "报告": "reports", "自动化": "automations",
};
/** Platform capabilities only; native tools remain owned by the Harness. */
export function groupAgentTools(catalog: AgentToolCatalogItem[]): AgentToolGroup[] {
  const groups = new Map<string, AgentToolGroup>();
  for (const tool of catalog) {
    if (tool.source !== "platform" || !platformToolIds.has(tool.id)) continue;
    const category = platformCategories[tool.group] ?? "other";
    const id = `${tool.source}-${category}`;
    const group = groups.get(id) ?? { id, source: tool.source, category, tools: [] };
    group.tools.push(tool);
    groups.set(id, group);
  }
  return [...groups.values()];
}

export function setAgentToolGroup(disabledTools: string[], tools: AgentToolCatalogItem[], enabled: boolean): string[] {
  const mutableIds = new Set(tools.filter(tool => !tool.alwaysEnabled).map(tool => tool.id));
  return enabled ? disabledTools.filter(id => !mutableIds.has(id)) : [...new Set([...disabledTools, ...mutableIds])].sort();
}
