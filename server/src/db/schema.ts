import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";

/** Column type enum as string union stored in text */
export const COLUMN_TYPES = [
  "text",
  "number",
  "select",
  "multi_select",
  "date",
  "checkbox",
  "person",
  "formula",
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

export type SelectOption = { id: string; label: string; color?: string };

export type FormulaResultType = "number" | "text" | "checkbox" | "date" | "auto";

export type ColumnConfig = {
  options?: SelectOption[];
  hidden?: boolean;
  formula?: string;
  formulaResultType?: FormulaResultType;
};

export type CellValue = string | number | boolean | string[] | null;

export const MEMBER_KINDS = ["human", "agent"] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export type AgentPersona = {
  systemPrompt?: string;
  defaultHarness?: "codex" | "claude" | "pi";
  defaultModel?: string;
  avatarColor?: string;
};

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
  /** sha256 of full key; prefix stored for display */
  apiKeyHash: text("api_key_hash").notNull(),
  apiKeyPrefix: text("api_key_prefix").notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("tables_org_idx").on(t.organizationId)]
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
  (t) => [index("columns_table_sort_idx").on(t.tableId, t.sortOrder)]
);

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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
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
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    trigger: jsonb("trigger").$type<AutomationTriggerJson>().notNull(),
    conditions: jsonb("conditions").$type<AutomationConditionJson[]>().default([]).notNull(),
    conditionLogic: text("condition_logic").default("and").notNull(),
    actions: jsonb("actions").$type<AutomationActionJson[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("automations_table_idx").on(t.tableId),
    index("automations_table_enabled_idx").on(t.tableId, t.enabled),
  ]
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    rowId: uuid("row_id")
      .notNull()
      .references(() => rows.id, { onDelete: "cascade" }),
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
  ]
);

export type Automation = typeof automations.$inferSelect;
export type AutomationRunRow = typeof automationRuns.$inferSelect;
