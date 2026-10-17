import { z } from "zod";

/** Configurable platform wire IDs. Native tool availability belongs to the Harness. */
export const PLATFORM_TOOL_IDS = [
  "list_calendar_subscriptions", "get_calendar_subscription", "create_calendar_subscription", "update_calendar_subscription", "revoke_calendar_subscription", "rotate_calendar_subscription_secret", "list_calendar_deliveries", "get_calendar_delivery", "retry_calendar_delivery",
  "get_blog_sources", "get_blog", "save_blog", "build_blog", "publish_blog", "withdraw_blog_article", "unpublish_blog", "restore_blog_revision", "create_blog_preview", "revoke_blog_previews",
  "query_scheduled_occurrences", "set_booking_reminders", "list_booking_reminders",
  "get_document", "create_document", "replace_document", "list_document_revisions", "get_document_revision", "restore_document_revision", "render_document", "upload_document_image", "get_document_image",
  "list_calendars", "get_calendar", "create_calendar", "update_calendar", "archive_calendar", "list_calendar_people", "get_calendar_person", "create_calendar_person", "update_calendar_person", "archive_calendar_person", "get_working_hours", "set_working_hours", "list_availability_exceptions", "set_availability_exception", "remove_availability_exception", "query_bookings", "get_booking", "create_booking", "reschedule_booking", "cancel_booking", "query_availability", "check_booking_conflicts", "batch_bookings",
  "list_sites", "get_site", "save_site", "publish_site", "unpublish_site",
  "batch_add_rows", "batch_update_rows", "batch_delete_rows",
  "batch_add_columns", "batch_update_columns", "batch_delete_columns",
  "batch_set_relations", "batch_add_relations", "batch_remove_relations",
  "list_reports",
  "get_report",
  "create_report",
  "update_report",
  "add_report_widget",
  "update_report_widget",
  "delete_report_widget",
  "reorder_report_widgets",
  "set_report_layout",
  "get_report_data",
  "delete_report",
  "get_row",
  "query_relation_records",
  "set_relation",
  "add_relation",
  "remove_relation",
  "get_workspace",
  "list_members",
  "list_tables",
  "create_table",
  "list_automations",
  "create_automation",
  "update_automation",
  "delete_automation",
  "list_automation_runs",
  "get_table",
  "update_cell",
  "update_cells",
  "add_row",
  "delete_row",
  "add_column",
  "delete_column",
  "set_status",
  "move_card",
  "query_rows",
  "update_column",
  "reorder_columns",
  "open_preview",
  "list_views",
  "get_view",
  "create_form_view",
  "update_form_view",
  "set_form_fields",
  "add_form_field",
  "remove_form_field",
  "reorder_form_fields",
  "set_form_sections",
  "set_form_theme",
  "set_form_layout",
  "set_form_field_settings",
  "rename_view",
  "set_default_view",
  "update_board_view",
  "create_calendar_view", "update_calendar_view", "query_calendar_view",
  "delete_view",
  "create_grid_view",
  "create_board_view"
] as const;
// Accepted only to normalize previously saved configurations, never selectable.
const legacyBuiltinToolIds = [
  "Agent",
  "Artifact",
  "CronCreate",
  "CronDelete",
  "CronList",
  "DesignSync",
  "EnterPlanMode",
  "EnterWorktree",
  "ExitPlanMode",
  "ExitWorktree",
  "LSP",
  "ListAgents",
  "ListMcpResources",
  "ListMcpResourcesTool",
  "Monitor",
  "NotebookEdit",
  "PowerShell",
  "PushNotification",
  "ReadMcpResource",
  "ReadMcpResourceDirTool",
  "ReadMcpResourceTool",
  "RefreshMcpTools",
  "RemoteTrigger",
  "ReportFindings",
  "ScheduleWakeup",
  "SendMessage",
  "SendUserFile",
  "ShareOnboardingGuide",
  "Skill",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskUpdate",
  "TodoWrite",
  "ToolSearch",
  "WaitForMcpServers",
  "WebFetch",
  "Workflow",
  "apply_patch",
  "askUserQuestions",
  "bash",
  "edit",
  "glob",
  "grep",
  "ls",
  "read",
  "view_image",
  "webSearch",
  "write"
] as const;
const retiredToolIds = ["read_skill", "get_task_state", "create_goal", "update_goal", "update_plan"] as const;
const platformToolIds = new Set<string>(PLATFORM_TOOL_IDS);
export const DISABLED_TOOLS_SCHEMA = z.array(z.enum([...PLATFORM_TOOL_IDS, ...legacyBuiltinToolIds, ...retiredToolIds]))
  .max(160).refine(ids => new Set(ids).size === ids.length, "工具名称不能重复")
  .transform(ids => ids.filter((id): id is (typeof PLATFORM_TOOL_IDS)[number] => platformToolIds.has(id)));
export type AgentToolCatalogItem = {
  id: string;
  name: string;
  description: string;
  group: string;
  source: "platform" | "builtin";
  supportedHarnesses: ("pi" | "codex" | "claude")[];
  alwaysEnabled?: boolean;
};
export type AgentToolCatalog = {
  harness: "pi" | "codex" | "claude";
  supportsFiltering: boolean;
  tools: AgentToolCatalogItem[];
};

/** Read current workspace identities without exposing cross-workspace selectors. */
export const MEMBER_LIST_SCHEMA = z.strictObject({
  kind: z.enum(["human", "agent"]).optional(),
  search: z.string().trim().max(200).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50),
});
