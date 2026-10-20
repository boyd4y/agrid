import { sites } from "./sites-schema.js";
import { workspaces, workspaceColumn } from "./workspaces-schema.js";
export { workspaces };
import { user, session, account, verification, organization, member, invitation, userApiKeys } from "@tabdo/auth/schema";
export { user, session, account, verification, organization, member, invitation, userApiKeys, MEMBER_KINDS, MEMBER_ROLES, type MemberKind, type MemberRole } from "@tabdo/auth/schema";

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";

export { COLUMN_TYPES } from "@tabdo/shared";
import type { ColumnConfig, CellValue, SandboxProvider, RuntimeProvider } from "@tabdo/shared";
export type { ColumnType, ColumnConfig, CellValue, SelectOption, FormulaResultType } from "@tabdo/shared";

export type AgentPersona = {
  systemPrompt?: string;
  defaultHarness?: "codex" | "claude" | "pi";
  defaultModel?: string;
  avatarColor?: string;
  skillNames?: string[];
  disabledTools?: string[];
  runtime?: "local" | "sandbox";
  sandboxProvider?: SandboxProvider;
};

export const skills = pgTable("skills", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  document: text("document").notNull(),
  files: jsonb("files").$type<import("@tabdo/shared").SkillFile[]>().default([]).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  version: integer("version").default(1).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("skills_org_name_idx").on(t.organizationId, t.name)]);

/** Built-in contents ship with the app; only their enabled state is per workspace. */
export const skillSettings = pgTable("skill_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull(),
}, (t) => [uniqueIndex("skill_settings_org_name_idx").on(t.organizationId, t.name)]);

/* ───────────── Agent profile + API key (same member surface as humans) ───────────── */

export const agentProfile = pgTable("agent_profile", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  memberId: text("member_id")
    .notNull()
    .references(() => member.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  persona: jsonb("persona").$type<AgentPersona>().default({}).notNull(),
  /** Optional legacy external credential; new in-app agents have no key. */
  apiKeyHash: text("api_key_hash"),
  apiKeyPrefix: text("api_key_prefix"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** A scope lock serializes index/topic mutations across API and worker processes. */
export const agentMemoryScopes = pgTable("agent_memory_scopes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull(),
  agentProfileId: uuid("agent_profile_id").notNull().references(() => agentProfile.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, t => [
  uniqueIndex("agent_memory_scope_key").on(t.organizationId, t.workspaceId, t.agentProfileId, t.userId),
  foreignKey({ columns: [t.workspaceId, t.organizationId], foreignColumns: [workspaces.id, workspaces.organizationId] }).onDelete("cascade"),
]);

export const agentMemoryTopics = pgTable("agent_memory_topics", {
  scopeId: uuid("scope_id").notNull().references(() => agentMemoryScopes.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  revision: uuid("revision").notNull().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  type: text("type").$type<import("@tabdo/shared").MemoryDocument["type"]>().notNull(),
  body: text("body").notNull(),
}, t => [uniqueIndex("agent_memory_topic_key").on(t.scopeId, t.topic),
  check("agent_memory_type_check", sql`${t.type} in ('user', 'feedback', 'project', 'reference')`),
]);

/* ───────────── App tables (scoped to organization) ───────────── */

export const tables = pgTable(
  "tables",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceColumn(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    pinned: boolean("pinned").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("tables_scope_key").on(t.id, t.workspaceId, t.organizationId), index("tables_org_idx").on(t.organizationId), index("tables_workspace_idx").on(t.workspaceId, t.createdAt), index("tables_org_name_lookup").on(t.workspaceId, sql`public.tabdo_name_key(${t.name})`)]
);

export const columns = pgTable(
  "columns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    config: jsonb("config").$type<ColumnConfig>().default({}).notNull(),
    width: integer("width").default(180).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("columns_table_sort_idx").on(t.tableId, t.sortOrder), index("columns_table_name_lookup").on(t.tableId, sql`public.tabdo_name_key(${t.name})`)]
);

/** Uploaded blobs are retained independently of cell references and editor drafts. */
export const fileObjects = pgTable("file_objects", {
  id: uuid("id").primaryKey(),
    workspaceId: workspaceColumn(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  tableId: uuid("table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
  columnId: uuid("column_id").notNull().references(() => columns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  mimeType: text("mime_type").notNull(),
  storageDriver: text("storage_driver").$type<"local" | "s3">().notNull(),
  storageKey: text("storage_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("file_objects_org_idx").on(t.organizationId), index("file_objects_column_idx").on(t.columnId), uniqueIndex("file_objects_storage_idx").on(t.storageDriver, t.storageKey)]);

export const rows = pgTable(
  "rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    cells: jsonb("cells").$type<Record<string, CellValue>>().default({}).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    /** optimistic concurrency token; bumped on every cell write */
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("rows_table_sort_id_idx").on(t.tableId, t.sortOrder, t.id),
    uniqueIndex("rows_scope_key").on(t.id, t.tableId),
  ]
);


/* ───────────── Table views (grid / board / form / calendar) ───────────── */

export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceColumn(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  tableId: uuid("table_id").references(() => tables.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  config: jsonb("config").$type<Omit<import("@tabdo/shared").ReportPageConfig, "name">>().notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("reports_org_created_idx").on(t.organizationId, t.createdAt), index("reports_workspace_created_idx").on(t.workspaceId, t.createdAt)]);

export const VIEW_TYPES = ["grid", "board", "form", "calendar", "site"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export type FormFieldConfigJson = {
  columnId: string;
  label?: string;
  helpText?: string;
  placeholder?: string;
  required?: boolean;
  hidden?: boolean;
  readOnly?: boolean;
  defaultValue?: CellValue;
  settings?: Record<string, unknown>;
};

export type FormViewConfigJson = {
  title?: string;
  description?: string;
  submitLabel?: string;
  successMessage?: string;
  mode?: "create" | "edit";
  fields?: FormFieldConfigJson[];
  sections?: { id: string; title: string; fieldIds: string[] }[];
  layout?: "classic" | "focus";
  theme?: {
    preset: string;
    overrides?: Record<string, unknown>;
  };
  welcome?: { title?: string; description?: string; ctaLabel?: string };
  ending?: { title?: string; description?: string; ctaLabel?: string };
};

export type ViewConfigJson = FormViewConfigJson | import("@tabdo/shared").CalendarViewConfig | Record<string, unknown>;

export const tableViews = pgTable(
  "table_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    name: text("name").notNull(),
    config: jsonb("config").$type<ViewConfigJson>().default({}).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("table_views_site_idx").on(t.siteId),
    uniqueIndex("table_views_one_default_idx").on(t.tableId).where(sql`${t.isDefault} = true`),
    index("table_views_table_idx").on(t.tableId, t.sortOrder),
    index("table_views_table_type_idx").on(t.tableId, t.type),
  ]
);

export type Table = typeof tables.$inferSelect;
export type Column = typeof columns.$inferSelect;
export type Row = typeof rows.$inferSelect;
export type TableViewRow = typeof tableViews.$inferSelect;


/* ───────────── Automations (Feishu when/if/then) ───────────── */

export type AutomationTriggerJson = Record<string, unknown>;
export type AutomationActionJson = Record<string, unknown>;
export type AutomationConditionJson = Record<string, unknown>;

export const automations = pgTable(
  "automations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceColumn(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    // Keep the binding after key deletion: a missing key must stop execution, never inherit the owner.
    executionKeyId: uuid("execution_key_id"),
    source: jsonb("source").$type<import("@tabdo/shared").AutomationSource>().notNull(),
    eventConditions: jsonb("event_conditions").$type<import("@tabdo/shared").AutomationEventCondition[]>().default([]).notNull(),
    tableId: uuid("table_id")
      .references(() => tables.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    version: integer("version").default(1).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    trigger: jsonb("trigger").$type<AutomationTriggerJson>().notNull(),
    conditions: jsonb("conditions").$type<AutomationConditionJson[]>().default([]).notNull(),
    conditionLogic: text("condition_logic").default("and").notNull(),
    actions: jsonb("actions").$type<AutomationActionJson[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("automations_org_created_idx").on(t.organizationId, t.createdAt),
    index("automations_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("automations_table_idx").on(t.tableId),
    index("automations_table_enabled_idx").on(t.tableId, t.enabled),
  ]
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceColumn(),
    automationId: uuid("automation_id")
      .notNull(),
    tableId: uuid("table_id"),
    rowId: uuid("row_id"),
    eventId: uuid("event_id"),
    ruleVersion: integer("rule_version").default(1).notNull(),
    ruleSnapshot: jsonb("rule_snapshot").$type<Record<string, unknown>>(),
    nextStep: integer("next_step").default(0).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    status: text("status").default("queued").notNull(),
    triggerType: text("trigger_type").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("automation_runs_table_idx").on(t.tableId, t.createdAt),
    index("automation_runs_auto_idx").on(t.automationId, t.createdAt),
    uniqueIndex("automation_runs_event_rule_idx").on(t.eventId, t.automationId, t.ruleVersion),
  ]
);

export type Automation = typeof automations.$inferSelect;
export type AutomationRunRow = typeof automationRuns.$inferSelect;

/** Durable event journal. Workers are scheduled exclusively by Redis/BullMQ. */
export const automationEvents = pgTable("automation_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull(),
  tableId: uuid("table_id"),
  rowId: uuid("row_id"),
  rowVersion: integer("row_version"),
  expectedVersion: integer("expected_version"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  status: text("status").default("matched").notNull(),
  generation: integer("generation").default(0).notNull(),
  fence: integer("fence").default(0).notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("automation_events_org_status_idx").on(t.organizationId, t.status),
  index("automation_events_row_idx").on(t.rowId, t.rowVersion)]);

/** Atomically claimed delivery records; Redis schedules actual execution. */
export const automationOutbox = pgTable("automation_outbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").notNull().references(() => automationEvents.id, { onDelete: "cascade" }),
  queue: text("queue").notNull(),
  payload: jsonb("payload").$type<import("@tabdo/shared").AutomationDelivery>().notNull(),
  status: text("status").default("pending").notNull(),
  generation: integer("generation").default(0).notNull(),
  claimToken: uuid("claim_token"),
  claimUntil: timestamp("claim_until", { withTimezone: true }),
  availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
  attempts: integer("attempts").default(0).notNull(),
  lastError: text("last_error"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("automation_outbox_event_queue_idx").on(t.eventId, t.queue),
  index("automation_outbox_pending_idx").on(t.availableAt, t.id).where(sql`${t.status} = 'pending'`),
  index("automation_outbox_claim_idx").on(t.claimUntil, t.id).where(sql`${t.status} = 'publishing'`)]);

export const automationStepReceipts = pgTable("automation_step_receipts", {
  runId: uuid("run_id").notNull().references(() => automationRuns.id, { onDelete: "cascade" }),
  step: integer("step").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("automation_step_receipts_key").on(t.runId, t.step)]);

/** Private conversations: scoped to both the signed-in account and workspace. */
export const chatThreads = pgTable("chat_threads", {
  id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceColumn(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  kind: text("kind").$type<"chat" | "scheduled_task">().default("chat").notNull(),
  scheduledTaskId: uuid("scheduled_task_id").references(() => automations.id, { onDelete: "cascade" }),
  title: text("title"),
  status: text("status").$type<"regular">().default("regular").notNull(),
  custom: jsonb("custom").$type<Record<string, unknown>>().default({}).notNull(),
  headId: text("head_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
}, (t) => [uniqueIndex("chat_threads_client_idx").on(t.userId, t.workspaceId, t.clientId),
  index("chat_threads_owner_idx").on(t.userId, t.workspaceId, t.updatedAt, t.id),
  index("chat_threads_kind_owner_idx").on(t.userId, t.workspaceId, t.kind, t.createdAt, t.id),
  index("chat_threads_scheduled_task_idx").on(t.scheduledTaskId, t.userId, t.createdAt, t.id),
  check("chat_threads_kind_check", sql`(${t.kind}='chat' AND ${t.scheduledTaskId} IS NULL) OR (${t.kind}='scheduled_task' AND ${t.scheduledTaskId} IS NOT NULL)`)]);

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  threadId: uuid("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull(),
  parentId: text("parent_id"),
  format: text("format").default("ai-sdk/v6").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  /** Finished server responses cannot be replaced by a stale client snapshot. */
  serverFinal: boolean("server_final").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("chat_messages_thread_message_idx").on(t.threadId, t.messageId),
  index("chat_messages_thread_idx").on(t.threadId, t.createdAt, t.id)]);

/** Native runtime state is private to its parent conversation, never a client payload. */
export const agentRuntimeSessions = pgTable("agent_runtime_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  threadId: uuid("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  agentProfileId: uuid("agent_profile_id").notNull().references(() => agentProfile.id, { onDelete: "cascade" }),
  harness: text("harness").notNull(),
  mode: text("mode").$type<"local" | "sandbox">().notNull(),
  provider: text("provider").$type<RuntimeProvider>().notNull(),
  sandboxCreated: boolean("sandbox_created").default(false).notNull(),
  sessionId: uuid("session_id").defaultRandom().notNull(),
  sandboxId: text("sandbox_id").notNull(),
  resumeState: jsonb("resume_state").$type<{ specificationVersion: "harness-v1"; harnessId: string; type: "resume-session"; data: unknown; continueFrom?: unknown }>(),
  workspace: jsonb("workspace").$type<import("../agent/checkpoints.js").WorkspaceSnapshot>(),
  lastUserMessageId: text("last_user_message_id"),
  lastAssistantMessageId: text("last_assistant_message_id"),
  status: text("status").$type<"ready" | "interrupted" | "failed">().default("ready").notNull(),
  error: text("error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("agent_runtime_thread_profile_idx").on(t.threadId, t.agentProfileId),
  check("agent_runtime_provider_mode_check", sql`(${t.mode} = 'local' AND ${t.provider} = 'local') OR (${t.mode} = 'sandbox' AND ${t.provider} IN ('vercel', 'e2b', 'railway'))`),
]);

/** One lease per conversation also serializes runs when the selected agent changes. */
export const agentThreadLeases = pgTable("agent_thread_leases", {
  threadId: uuid("thread_id").primaryKey().references(() => chatThreads.id, { onDelete: "cascade" }),
  token: uuid("token"),
  fence: integer("fence").default(0).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const agentWorkspaceSettings = pgTable("agent_workspace_settings", {
  organizationId: text("organization_id").primaryKey().references(() => organization.id, { onDelete: "cascade" }),
  instructions: text("instructions").default("").notNull(),
  version: integer("version").default(1).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** One durable run per user input; the native session owns conversation history. */
export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  threadId: uuid("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  runtimeSessionId: uuid("runtime_session_id").notNull().references(() => agentRuntimeSessions.id, { onDelete: "cascade" }),
  userMessageId: text("user_message_id").notNull(),
  assistantMessageId: text("assistant_message_id").notNull(),
  fence: integer("fence").notNull(),
  status: text("status").$type<import("@tabdo/shared").AgentRunStatus>().default("starting").notNull(),
  activity: jsonb("activity").$type<import("@tabdo/shared").ChatActivity>(),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
}, (t) => [uniqueIndex("agent_runs_input_idx").on(t.threadId, t.userMessageId), index("agent_runs_thread_idx").on(t.threadId, t.startedAt, t.id)]);

export const agentRunEvents = pgTable("agent_run_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  activity: jsonb("activity").$type<import("@tabdo/shared").ChatActivity>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("agent_run_events_run_idx").on(t.runId, t.createdAt, t.id)]);

/** Canonical relation edges: the inverse column reads the same edge. */
export const tableRelations = pgTable("table_relations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  sourceTableId: uuid("source_table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
  targetTableId: uuid("target_table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
  sourceColumnId: uuid("source_column_id").notNull().references(() => columns.id, { onDelete: "cascade" }),
  inverseColumnId: uuid("inverse_column_id").references(() => columns.id, { onDelete: "cascade" }),
  sourceSingle: boolean("source_single").default(false).notNull(),
  targetSingle: boolean("target_single").default(false).notNull(),
}, (t) => [index("relation_source_table_idx").on(t.sourceTableId), index("relation_target_table_idx").on(t.targetTableId)]);
export const rowRelations = pgTable("row_relations", {
  relationId: uuid("relation_id").notNull().references(() => tableRelations.id, { onDelete: "cascade" }),
  sourceRowId: uuid("source_row_id").notNull().references(() => rows.id, { onDelete: "cascade" }),
  targetRowId: uuid("target_row_id").notNull().references(() => rows.id, { onDelete: "cascade" }),
  sourceSingle: boolean("source_single").notNull(), targetSingle: boolean("target_single").notNull(),
}, (t) => [uniqueIndex("relation_edge_unique").on(t.relationId, t.sourceRowId, t.targetRowId),
  index("relation_target_row_idx").on(t.relationId, t.targetRowId, t.sourceRowId),
  uniqueIndex("relation_source_single").on(t.relationId, t.sourceRowId).where(sql`${t.sourceSingle}`),
  uniqueIndex("relation_target_single").on(t.relationId, t.targetRowId).where(sql`${t.targetSingle}`)]);

/** Service credentials are encrypted; public projections never select these fields. */
export const integrationConnections = pgTable("integration_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider").$type<"agentmail">().notNull(),
  name: text("name").notNull(),
  encryptedCredential: jsonb("encrypted_credential").$type<Record<string, string>>().notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  state: text("state").default("unverified").notNull(),
  lastError: text("last_error"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("integration_connections_org_idx").on(t.organizationId)]);
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").$type<"webhook" | "agentmail">().notNull(),
  connectionId: uuid("connection_id").references(() => integrationConnections.id, { onDelete: "cascade" }),
  inboxIds: jsonb("inbox_ids").$type<string[]>().default([]).notNull(),
  tokenHash: text("token_hash"),
  encryptedSigningSecret: jsonb("encrypted_signing_secret").$type<Record<string, string>>(),
  remoteWebhookId: text("remote_webhook_id"),
  enabled: boolean("enabled").default(true).notNull(),
  state: text("state").default("active").notNull(),
  lastError: text("last_error"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("webhook_endpoints_org_idx").on(t.organizationId)]);
export const integrationDeliveries = pgTable("integration_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  logicalKey: text("logical_key"),
  connectionId: uuid("connection_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").default("received").notNull(),
  eventId: uuid("event_id"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex("integration_deliveries_transport_idx").on(t.endpointId, t.dedupeKey),
  uniqueIndex("integration_deliveries_logical_idx").on(t.connectionId, t.logicalKey)]);
export const automationSchedules = pgTable("automation_schedules", {
  automationId: uuid("automation_id").primaryKey().references(() => automations.id, { onDelete: "cascade" }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  ruleVersion: integer("rule_version").notNull(),
}, t => [index("automation_schedules_due_idx").on(t.nextRunAt)]);
export const automationOccurrences = pgTable("automation_occurrences", {
  automationId: uuid("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
  ruleVersion: integer("rule_version").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  eventId: uuid("event_id").notNull(),
}, t => [uniqueIndex("automation_occurrences_key").on(t.automationId, t.ruleVersion, t.scheduledFor)]);
/** One native conversation per automation action, stable across worker delivery retries. */
export const automationAgentActions = pgTable("automation_agent_actions", {
  runId: uuid("run_id").notNull().references(() => automationRuns.id, { onDelete: "cascade" }),
  step: integer("step").notNull(),
  threadId: uuid("thread_id").notNull(),
  userMessageId: text("user_message_id").notNull(),
  agentRunId: uuid("agent_run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex("automation_agent_actions_key").on(t.runId, t.step)]);

// Durable execution attempts and replayable projection are platform-owned.
export { agentExecutions, agentExecutionChunks } from "./execution-schema.js";

// Retired gateway tables are retained for migration compatibility; no runtime uses them.
export { agentExecutionGateways, agentExecutionToolCalls } from "./gateway-schema.js";

/** Table CRUD capabilities belong to the application, credentials to auth. */
export const apiKeyTables = pgTable("api_key_tables", {
  keyId: uuid("key_id").notNull().references(() => userApiKeys.id, { onDelete: "cascade" }),
  tableId: uuid("table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
  canRead: boolean("can_read").notNull().default(false),
  canCreate: boolean("can_create").notNull().default(false),
  canUpdate: boolean("can_update").notNull().default(false),
  canDelete: boolean("can_delete").notNull().default(false),
}, t => [uniqueIndex("api_key_tables_key_table_idx").on(t.keyId, t.tableId), index("api_key_tables_table_idx").on(t.tableId),
  check("api_key_tables_capability", sql`${t.canRead} OR ${t.canCreate} OR ${t.canUpdate} OR ${t.canDelete}`)]);

export { sites, siteRevisions, sitePreviews } from "./sites-schema.js";

export { calendars, calendarPeople, availabilityExceptions, bookings, calendarReceipts, apiKeyCalendars, bookingReminders, bookingReminderIntents } from "./calendar-schema.js";

export const apiKeySchedules = pgTable("api_key_schedules", {
  keyId: uuid("key_id").notNull().references(() => userApiKeys.id, { onDelete: "cascade" }),
  automationId: uuid("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
  grantVersion: integer("grant_version").$type<1 | 2>().notNull().default(1),
  canRead: boolean("can_read").notNull().default(false), canUpdate: boolean("can_update").notNull().default(false), canDelete: boolean("can_delete").notNull().default(false),
}, t => [uniqueIndex("api_key_schedules_key_rule_idx").on(t.keyId, t.automationId), check("api_key_schedules_grant_version", sql`${t.grantVersion} IN (1, 2)`), check("api_key_schedules_capability", sql`${t.canRead} OR ${t.canUpdate} OR ${t.canDelete}`)]);

export { recordDocuments, recordDocumentLinks, documentRevisions, documentReceipts, documentImages, apiKeyDocuments } from "./documents-schema.js";

export { calendarEvents, calendarSubscriptions, calendarDeliveries, calendarDeliveryAttempts } from "./calendar-subscriptions-schema.js";
export * from "./blogs-schema.js";

export const apiKeyAutomations = pgTable("api_key_automations", {
  keyId: uuid("key_id").notNull().references(() => userApiKeys.id, { onDelete: "cascade" }),
  automationId: uuid("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
  canRead: boolean("can_read").notNull().default(false), canUpdate: boolean("can_update").notNull().default(false), canDelete: boolean("can_delete").notNull().default(false),
}, t => [uniqueIndex("api_key_automations_key_rule_idx").on(t.keyId, t.automationId), check("api_key_automations_capability", sql`${t.canRead} OR ${t.canUpdate} OR ${t.canDelete}`)]);
export const apiKeyWorkspaces = pgTable("api_key_workspaces", {
  keyId: uuid("key_id").notNull().references(() => userApiKeys.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  canCreateAutomations: boolean("can_create_automations").notNull().default(false), canCreateSchedules: boolean("can_create_schedules").notNull().default(false),
}, t => [uniqueIndex("api_key_workspaces_key_workspace_idx").on(t.keyId, t.workspaceId), check("api_key_workspaces_capability", sql`${t.canCreateAutomations} OR ${t.canCreateSchedules}`)]);
