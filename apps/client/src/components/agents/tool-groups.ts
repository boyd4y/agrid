import type { AgentToolCatalogItem } from "@tabdo/shared";

export type AgentToolGroup = { id: string; source: AgentToolCatalogItem["source"]; category: string; tools: AgentToolCatalogItem[] };
const platformCategories: Record<string, string> = {
  "表格与记录": "tables", "关联记录": "tables", "视图": "tables",
  "表单": "forms", "报告": "reports", "自动化": "automations", "工作计划": "plans", Skills: "skills",
};
const nativeCategories: Record<string, string> = {
  read: "files", write: "files", edit: "files", apply_patch: "files", view_image: "files", NotebookEdit: "files", Artifact: "files", SendUserFile: "files",
  bash: "commands", PowerShell: "commands", EnterWorktree: "commands", ExitWorktree: "commands",
  grep: "search", glob: "search", ls: "search", webSearch: "search", WebFetch: "search", ToolSearch: "search", LSP: "search", ListMcpResources: "search", ListMcpResourcesTool: "search", ReadMcpResource: "search", ReadMcpResourceTool: "search", ReadMcpResourceDirTool: "search", RefreshMcpTools: "search", WaitForMcpServers: "search",
  askUserQuestions: "interaction", PushNotification: "interaction", ShareOnboardingGuide: "interaction",
  Agent: "coordination", TaskCreate: "coordination", TaskGet: "coordination", TaskUpdate: "coordination", TaskList: "coordination", TaskStop: "coordination", TaskOutput: "coordination", TodoWrite: "coordination", Monitor: "coordination", ListAgents: "coordination", SendMessage: "coordination", ReportFindings: "coordination", Workflow: "coordination", EnterPlanMode: "coordination", ExitPlanMode: "coordination",
  CronCreate: "scheduling", CronDelete: "scheduling", CronList: "scheduling", ScheduleWakeup: "scheduling", RemoteTrigger: "scheduling", Skill: "skills",
};

/** Only catalog entries actually available to the selected Harness become capabilities. */
export function groupAgentTools(catalog: AgentToolCatalogItem[]): AgentToolGroup[] {
  const groups = new Map<string, AgentToolGroup>();
  for (const tool of catalog) {
    const category = (tool.source === "platform" ? platformCategories[tool.group] : nativeCategories[tool.id]) ?? "other";
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
