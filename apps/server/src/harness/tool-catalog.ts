import { CALENDAR_TOOLS } from "@tabdo/shared";
import { type AgentToolCatalog, type AgentToolCatalogItem } from "@tabdo/shared";
import type { ToolSet } from "ai";
import type { HarnessId } from "../ai/model.js";
import { createTableTools } from "../ai/tools.js";

const harnesses: HarnessId[] = ["pi", "codex", "claude"];
// Definitions only: no runtime, credentials, or tool execution during catalog reads.
const platformTools: ToolSet = createTableTools();
function group(id: string) {
  if (Object.hasOwn(CALENDAR_TOOLS, id)) return "日历与预约";
  if (["list_mail_inboxes", "send_email", "reply_email", "get_message"].includes(id)) return "邮件";
  if (id.includes("site")) return "站点";
  if (id.includes("report")) return "报告";
  if (id.includes("automation")) return "自动化";
  if (id.includes("form")) return "表单";
  if (id.includes("view") || id === "open_preview") return "视图";
  if (id.includes("relation")) return "关联记录";
  return "表格与记录";
}

export function getAgentToolCatalog(harness: HarnessId): AgentToolCatalog {
  // Official inactiveTools supports host tools without filtering native tools.
  const supportsFiltering = true;
  const tools: AgentToolCatalogItem[] = Object.entries(platformTools).map(([id, definition]) => ({
    id, name: id, description: typeof definition.description === "string" ? definition.description : id, group: group(id), source: "platform", supportedHarnesses: harnesses,
  }));
  return { harness, supportsFiltering, tools };
}

export { validateDisabledTools } from "./tool-settings.js";
