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
} from "drizzle-orm/pg-core";

export { COLUMN_TYPES } from "@tabdo/shared";
import type { ColumnConfig, CellValue } from "@tabdo/shared";
export type { ColumnType, ColumnConfig, CellValue, SelectOption, FormulaResultType } from "@tabdo/shared";

export const MEMBER_KINDS = ["human", "agent"] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export type AgentPersona = {
  systemPrompt?: string;
  defaultHarness?: "codex" | "claude" | "pi";
  defaultModel?: string;
  avatarColor?: string;
  skillNames?: string[];
  disabledTools?: string[];
  runtime?: "local" | "sandbox";
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

/* ───────────── Better Auth core ───────────── */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  /** human | agent — agents also get a user row so org membership is identical */
  kind: text("kind").default("human").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Personal API credentials are bound to one user/workspace; never store plaintext. */
export const userApiKeys = pgTable("user_api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  prefix: text("prefix").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [uniqueIndex("user_api_keys_hash_idx").on(t.keyHash), index("user_api_keys_owner_idx").on(t.userId, t.organizationId, t.createdAt)]);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
  },
  (t) => [index("session_user_id_idx").on(t.userId)]
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)]
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ───────────── Better Auth organization (workspace) ───────────── */

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  metadata: text("metadata"),
});

/** Org members — humans AND agents share this table (equal permissions) */
export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("member_org_idx").on(t.organizationId),
    index("member_user_idx").on(t.userId),
  ]
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("invitation_org_idx").on(t.organizationId)]
);

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

/* ───────────── App tables (scoped to organization) ───────────── */

export const tables = pgTable(
  "tables",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
  (t) => [index("tables_org_idx").on(t.organizationId), index("tables_org_name_lookup").on(t.organizationId, sql`public.tabdo_name_key(${t.name})`)]
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
  ]
);


/* ───────────── Table views (grid / board / form) ───────────── */

export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  tableId: uuid("table_id").references(() => tables.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  config: jsonb("config").$type<Omit<import("@tabdo/shared").ReportPageConfig, "name">>().notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("reports_org_created_idx").on(t.organizationId, t.createdAt)]);

export const VIEW_TYPES = ["grid", "board", "form"] as const;
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

export type ViewConfigJson = FormViewConfigJson | Record<string, unknown>;

export const tableViews = pgTable(
  "table_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    name: text("name").notNull(),
    config: jsonb("config").$type<ViewConfigJson>().default({}).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
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
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
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
    index("automations_table_idx").on(t.tableId),
    index("automations_table_enabled_idx").on(t.tableId, t.enabled),
  ]
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
  payload: jsonb("payload").$type<{ protocol: 1; eventId: string; generation: number }>().notNull(),
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
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  title: text("title"),
  status: text("status").$type<"regular">().default("regular").notNull(),
  custom: jsonb("custom").$type<Record<string, unknown>>().default({}).notNull(),
  headId: text("head_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
}, (t) => [uniqueIndex("chat_threads_client_idx").on(t.userId, t.organizationId, t.clientId),
  index("chat_threads_owner_idx").on(t.userId, t.organizationId, t.updatedAt, t.id)]);

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
  sessionId: uuid("session_id").defaultRandom().notNull(),
  sandboxId: text("sandbox_id").notNull(),
  resumeState: jsonb("resume_state").$type<{ specificationVersion: "harness-v1"; harnessId: string; type: "resume-session"; data: unknown; continueFrom?: unknown }>(),
  workspace: jsonb("workspace").$type<import("../harness/workspace.js").WorkspaceSnapshot>(),
  lastUserMessageId: text("last_user_message_id"),
  lastAssistantMessageId: text("last_assistant_message_id"),
  status: text("status").$type<"ready" | "interrupted" | "failed">().default("ready").notNull(),
  error: text("error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("agent_runtime_thread_profile_idx").on(t.threadId, t.agentProfileId)]);

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
