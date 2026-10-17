import type { CommandDependencies } from "../dependencies.js";
import { and, asc, eq } from "drizzle-orm";

import { inTransaction, type Transaction } from "../db/context.js";
import { columns, tables, tableViews, type FormViewConfigJson, type FormFieldConfigJson } from "../db/schema.js";
import { requireOrgId, requireTableInOrg } from "../tenant/scope.js";
import type {
  AddFormFieldInput,
  CreateBoardViewInput,
  CreateFormViewInput,
  CreateGridViewInput,
  FormFieldConfig,
  FormLayoutMode,
  FormThemePresetId,
  FormViewConfig,
  GetViewInput,
  DeleteViewInput,
  ListViewsInput,
  RemoveFormFieldInput,
  ReorderFormFieldsInput,
  ResolvedFormView,
  SetFormChromeInput,
  SetFormFieldSettingsInput,
  SetFormFieldsInput,
  SetFormLayoutInput,
  SetFormSectionsInput,
  SetFormThemeInput,
  TableView,
  UpdateFormViewInput,
  RenameViewInput,
  SetDefaultViewInput,
  UpdateBoardViewInput,
  BoardViewConfig,
} from "@tabdo/shared";
import { FORM_LAYOUT_MODES, FORM_THEME_PRESETS, BOARD_VIEW_CONFIG_SCHEMA, RENAME_VIEW_SCHEMA, SET_DEFAULT_VIEW_SCHEMA, UPDATE_BOARD_VIEW_SCHEMA, VIEW_NAME_SCHEMA } from "@tabdo/shared";

export type OrgScoped = { organizationId?: string };

function asFormConfig(raw: unknown): FormViewConfig {
  const c = (raw ?? {}) as FormViewConfigJson;
  const layout =
    c.layout && (FORM_LAYOUT_MODES as readonly string[]).includes(c.layout)
      ? (c.layout as FormLayoutMode)
      : "classic";
  const preset =
    c.theme?.preset && (FORM_THEME_PRESETS as readonly string[]).includes(c.theme.preset)
      ? (c.theme.preset as FormThemePresetId)
      : undefined;
  return {
    title: c.title,
    description: c.description,
    submitLabel: c.submitLabel,
    successMessage: c.successMessage,
    mode: c.mode === "edit" ? "edit" : "create",
    fields: Array.isArray(c.fields) ? (c.fields as FormFieldConfig[]) : [],
    sections: Array.isArray(c.sections) ? c.sections : undefined,
    layout,
    theme: preset
      ? {
          preset,
          ...(c.theme?.overrides
            ? { overrides: c.theme.overrides as NonNullable<FormViewConfig["theme"]>["overrides"] }
            : {}),
        }
      : undefined,
    welcome: c.welcome,
    ending: c.ending,
  };
}

function toTableView(row: typeof tableViews.$inferSelect): TableView {
  return {
    id: row.id,
    tableId: row.tableId,
    type: row.type,
    name: row.name,
    config: (row.config ?? {}) as TableView["config"],
    sortOrder: row.sortOrder,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireViewInOrg(deps: CommandDependencies, viewId: string, organizationId?: string, transaction?: Transaction) {
  const orgId = requireOrgId(organizationId);
  const [view] = await (transaction ?? deps.database).select().from(tableViews).where(eq(tableViews.id, viewId));
  if (!view) throw new Error(`视图不存在: ${viewId}`);
  await requireTableInOrg(deps, view.tableId, orgId, transaction);
  return view;
}

async function loadColumns(deps: CommandDependencies, tableId: string, query: CommandDependencies["database"] | Transaction = deps.database) {
  return query
    .select()
    .from(columns)
    .where(eq(columns.tableId, tableId))
    .orderBy(asc(columns.sortOrder));
}

function defaultFieldsFromColumns(
  cols: Awaited<ReturnType<typeof loadColumns>>
): FormFieldConfig[] {
  return cols
    .filter((c) => c.type !== "formula" && c.type !== "rollup" && !(c.config as { hidden?: boolean })?.hidden)
    .map((c) => ({
      columnId: c.id,
      required: c.type === "text" && c.name === "标题" ? true : false,
      settings:
        c.type === "select"
          ? { kind: "select" as const, display: "buttons" as const }
          : c.type === "multi_select"
            ? { kind: "multi_select" as const, display: "buttons" as const }
            : undefined,
    }));
}

async function lockTable(deps: CommandDependencies, tx: Transaction, tableId: string) {
  const [table] = await tx.select({ id: tables.id }).from(tables).where(eq(tables.id, tableId)).for("update");
  if (!table) throw new Error("表格不存在");
}

/** All operations that can change the default serialize on the same parent row. */
async function insertView(deps: CommandDependencies, tableId: string, values: Omit<typeof tableViews.$inferInsert, "tableId" | "sortOrder" | "isDefault">, transaction?: Transaction) {
  return inTransaction(deps, transaction, async (tx) => {
    await lockTable(deps, tx, tableId);
    const siblings = await tx.select({ sortOrder: tableViews.sortOrder, isDefault: tableViews.isDefault }).from(tableViews).where(eq(tableViews.tableId, tableId));
    const [row] = await tx.insert(tableViews).values({ ...values, tableId, sortOrder: Math.max(-1, ...siblings.map((view) => view.sortOrder)) + 1, isDefault: !siblings.some((view) => view.isDefault) }).returning();
    return row;
  });
}

async function validateBoardConfig(deps: CommandDependencies, tableId: string, config: BoardViewConfig, query: CommandDependencies["database"] | Transaction = deps.database) {
  const cols = await loadColumns(deps, tableId, query);
  const ids = new Set(cols.map((column) => column.id));
  for (const id of config.visibleColumnIds ?? []) if (!ids.has(id)) throw new Error(`显示属性不属于该表: ${id}`);
  if (config.statusColumnId && !cols.some((column) => column.id === config.statusColumnId && column.type === "select")) throw new Error("看板分组需要该表的单选字段");
}

export async function renameView(deps: CommandDependencies, { organizationId, ...input }: RenameViewInput & OrgScoped, transaction?: Transaction): Promise<TableView> {
  const { viewId, name } = RENAME_VIEW_SCHEMA.parse({ viewId: input.viewId, name: input.name });
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  const [row] = await (transaction ?? deps.database).update(tableViews).set({ name, updatedAt: deps.now() }).where(and(eq(tableViews.id, viewId), eq(tableViews.tableId, view.tableId))).returning();
  if (!row) throw new Error("视图已被删除");
  return toTableView(row);
}

export async function setDefaultView(deps: CommandDependencies, { organizationId, ...input }: SetDefaultViewInput & OrgScoped, transaction?: Transaction): Promise<TableView> {
  const { viewId } = SET_DEFAULT_VIEW_SCHEMA.parse({ viewId: input.viewId });
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  return inTransaction(deps, transaction, async (tx) => {
    await lockTable(deps, tx, view.tableId);
    const [current] = await tx.select().from(tableViews).where(eq(tableViews.id, viewId));
    if (!current) throw new Error("视图已被删除");
    await tx.update(tableViews).set({ isDefault: false }).where(and(eq(tableViews.tableId, view.tableId), eq(tableViews.isDefault, true)));
    const [row] = await tx.update(tableViews).set({ isDefault: true, updatedAt: deps.now() }).where(eq(tableViews.id, viewId)).returning();
    return toTableView(row);
  });
}

export async function updateBoardView(deps: CommandDependencies, { organizationId, ...input }: UpdateBoardViewInput & OrgScoped, transaction?: Transaction): Promise<TableView> {
  // API routes also pass actorId; keep it outside the public schema.
  const { viewId, config } = UPDATE_BOARD_VIEW_SCHEMA.parse({ viewId: input.viewId, config: input.config });
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  if (view.type !== "board") throw new Error("仅支持更新看板视图");
  return inTransaction(deps, transaction, async (tx) => {
    await lockTable(deps, tx, view.tableId);
    const [current] = await tx.select().from(tableViews).where(eq(tableViews.id, viewId)).for("update");
    if (!current) throw new Error("视图已被删除");
    const next = BOARD_VIEW_CONFIG_SCHEMA.parse({ ...current.config, ...config });
    await validateBoardConfig(deps, view.tableId, next, tx);
    const [row] = await tx.update(tableViews).set({ config: next, updatedAt: deps.now() }).where(eq(tableViews.id, viewId)).returning();
    return toTableView(row);
  });
}

async function resolveFormView(
  deps: CommandDependencies,
  view: typeof tableViews.$inferSelect,
  transaction?: Transaction
): Promise<ResolvedFormView> {
  const cols = await loadColumns(deps, view.tableId, transaction);
  const byId = new Map(cols.map((c) => [c.id, c]));
  const config = asFormConfig(view.config);
  let fields = config.fields ?? [];
  if (!fields.length) {
    fields = defaultFieldsFromColumns(cols);
  }
  const resolvedFields = fields
    .filter((f) => byId.has(f.columnId))
    .map((f) => {
      const col = byId.get(f.columnId)!;
      const isFormula = (col.type === "formula" || col.type === "rollup");
      return {
        ...f,
        readOnly: f.readOnly || isFormula,
        columnName: col.name,
        columnType: col.type,
        columnConfig: (col.config ?? {}) as Record<string, unknown>,
      };
    });
  return {
    ...toTableView(view),
    type: "form",
    config: { ...config, fields },
    resolvedFields,
  };
}

export async function listViews(deps: CommandDependencies, {
  tableId,
  organizationId,
}: ListViewsInput & OrgScoped, transaction?: Transaction): Promise<TableView[]> {
  await requireTableInOrg(deps, tableId, organizationId, transaction);
  const rows = await (transaction ?? deps.database)
    .select()
    .from(tableViews)
    .where(eq(tableViews.tableId, tableId))
    .orderBy(asc(tableViews.sortOrder), asc(tableViews.createdAt));
  return rows.map(toTableView);
}

export async function getView(deps: CommandDependencies, {
  viewId,
  organizationId,
}: GetViewInput & OrgScoped, transaction?: Transaction): Promise<TableView | ResolvedFormView> {
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  if (view.type === "form") return resolveFormView(deps, view, transaction);
  return toTableView(view);
}

export async function deleteView(deps: CommandDependencies, {
  viewId,
  organizationId,
}: DeleteViewInput & OrgScoped, transaction?: Transaction): Promise<{ ok: true }> {
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  return inTransaction(deps, transaction, async (tx) => {
    await lockTable(deps, tx, view.tableId);
    const siblings = await tx.select().from(tableViews).where(eq(tableViews.tableId, view.tableId)).orderBy(asc(tableViews.sortOrder), asc(tableViews.createdAt), asc(tableViews.id));
    const current = siblings.find((candidate) => candidate.id === viewId);
    if (!current) throw new Error("视图已被删除");
    if (siblings.length <= 1) throw new Error("至少保留一个视图");
    await tx.delete(tableViews).where(eq(tableViews.id, viewId));
    if (current.isDefault) await tx.update(tableViews).set({ isDefault: true, updatedAt: deps.now() }).where(eq(tableViews.id, siblings.find((candidate) => candidate.id !== viewId)!.id));
    return { ok: true };
  });
}

export async function createGridView(deps: CommandDependencies, {
  tableId,
  name,
  organizationId,
}: CreateGridViewInput & OrgScoped, transaction?: Transaction): Promise<TableView> {
  await requireTableInOrg(deps, tableId, organizationId, transaction);
  const row = await insertView(deps, tableId, { type: "grid", name: name === undefined ? "表格" : VIEW_NAME_SCHEMA.parse(name), config: {} }, transaction);
  return toTableView(row);
}

export async function createBoardView(deps: CommandDependencies, { tableId, name, config, organizationId }: CreateBoardViewInput & OrgScoped, transaction?: Transaction): Promise<TableView> {
  await requireTableInOrg(deps, tableId, organizationId, transaction);
  const settings = BOARD_VIEW_CONFIG_SCHEMA.parse(config ?? {});
  await validateBoardConfig(deps, tableId, settings, transaction);
  const row = await insertView(deps, tableId, { type: "board", name: name === undefined ? "看板" : VIEW_NAME_SCHEMA.parse(name), config: settings }, transaction);
  return toTableView(row);
}

export async function createFormView(deps: CommandDependencies, {
  tableId,
  name,
  config,
  fields,
  organizationId,
}: CreateFormViewInput & OrgScoped, transaction?: Transaction): Promise<ResolvedFormView> {
  await requireTableInOrg(deps, tableId, organizationId, transaction);
  const cols = await loadColumns(deps, tableId, transaction);
  const formFields = fields?.length ? fields : defaultFieldsFromColumns(cols);
  const colIds = new Set(cols.map((c) => c.id));
  for (const f of formFields) {
    if (!colIds.has(f.columnId)) {
      throw new Error(`列不属于该表: ${f.columnId}`);
    }
  }

  const layout = config?.layout ?? "classic";
  const theme = config?.theme ?? { preset: "notion-light" as FormThemePresetId };

  const formConfig: FormViewConfigJson = {
    title: config?.title ?? name ?? "表单",
    description: config?.description,
    submitLabel: config?.submitLabel ?? "提交",
    successMessage: config?.successMessage ?? "提交成功",
    mode: config?.mode === "edit" ? "edit" : "create",
    fields: formFields as FormFieldConfigJson[],
    sections: config?.sections,
    layout,
    theme,
    welcome: config?.welcome,
    ending: config?.ending,
  };

  const row = await insertView(deps, tableId, { type: "form", name: name === undefined ? VIEW_NAME_SCHEMA.parse(formConfig.title || "表单") : VIEW_NAME_SCHEMA.parse(name), config: formConfig }, transaction);

  return resolveFormView(deps, row, transaction);
}

export async function updateFormView(deps: CommandDependencies, {
  viewId,
  name,
  config,
  organizationId,
}: UpdateFormViewInput & OrgScoped, transaction?: Transaction): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  if (view.type !== "form") throw new Error("仅支持更新表单视图");
  if (config?.fields) {
    const colIds = new Set((await loadColumns(deps, view.tableId, transaction)).map(column => column.id));
    for (const field of config.fields) {
      if (!colIds.has(field.columnId)) throw new Error(`列不属于该表: ${field.columnId}`);
    }
  }
  const prev = asFormConfig(view.config);
  const next: FormViewConfigJson = {
    ...prev,
    ...(config?.title !== undefined ? { title: config.title } : {}),
    ...(config?.description !== undefined ? { description: config.description } : {}),
    ...(config?.submitLabel !== undefined ? { submitLabel: config.submitLabel } : {}),
    ...(config?.successMessage !== undefined
      ? { successMessage: config.successMessage }
      : {}),
    ...(config?.mode !== undefined ? { mode: config.mode } : {}),
    ...(config?.fields !== undefined ? { fields: config.fields as FormFieldConfigJson[] } : {}),
    ...(config?.sections !== undefined ? { sections: config.sections } : {}),
    ...(config?.layout !== undefined ? { layout: config.layout } : {}),
    ...(config?.theme !== undefined ? { theme: config.theme } : {}),
    ...(config?.welcome !== undefined ? { welcome: config.welcome } : {}),
    ...(config?.ending !== undefined ? { ending: config.ending } : {}),
    fields: (config?.fields ?? prev.fields) as FormFieldConfigJson[],
  };
  const [row] = await (transaction ?? deps.database)
    .update(tableViews)
    .set({
      ...(name !== undefined ? { name: VIEW_NAME_SCHEMA.parse(name) } : {}),
      config: next,
      updatedAt: deps.now(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(deps, row, transaction);
}

export async function setFormFields(deps: CommandDependencies, {
  viewId,
  fields,
  organizationId,
}: SetFormFieldsInput & OrgScoped, transaction?: Transaction): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const cols = await loadColumns(deps, view.tableId, transaction);
  const colIds = new Set(cols.map((c) => c.id));
  for (const f of fields) {
    if (!colIds.has(f.columnId)) throw new Error(`列不属于该表: ${f.columnId}`);
  }
  const prev = asFormConfig(view.config);
  const [row] = await (transaction ?? deps.database)
    .update(tableViews)
    .set({
      config: { ...prev, fields: fields as FormFieldConfigJson[] },
      updatedAt: deps.now(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(deps, row, transaction);
}

export async function addFormField(deps: CommandDependencies, {
  viewId,
  field,
  organizationId,
}: AddFormFieldInput & OrgScoped, transaction?: Transaction): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const cols = await loadColumns(deps, view.tableId, transaction);
  if (!cols.some((c) => c.id === field.columnId)) {
    throw new Error(`列不属于该表: ${field.columnId}`);
  }
  const prev = asFormConfig(view.config);
  const fields = [...(prev.fields ?? []).filter((f) => f.columnId !== field.columnId), field];
  const [row] = await (transaction ?? deps.database)
    .update(tableViews)
    .set({
      config: { ...prev, fields: fields as FormFieldConfigJson[] },
      updatedAt: deps.now(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(deps, row, transaction);
}

export async function removeFormField(deps: CommandDependencies, {
  viewId,
  columnId,
  organizationId,
}: RemoveFormFieldInput & OrgScoped, transaction?: Transaction): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const prev = asFormConfig(view.config);
  const fields = (prev.fields ?? []).filter((f) => f.columnId !== columnId);
  const [row] = await (transaction ?? deps.database)
    .update(tableViews)
    .set({
      config: { ...prev, fields: fields as FormFieldConfigJson[] },
      updatedAt: deps.now(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(deps, row, transaction);
}

export async function reorderFormFields(deps: CommandDependencies, {
  viewId,
  columnIds,
  organizationId,
}: ReorderFormFieldsInput & OrgScoped, transaction?: Transaction): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const prev = asFormConfig(view.config);
  const byId = new Map((prev.fields ?? []).map((f) => [f.columnId, f]));
  const ordered: FormFieldConfig[] = [];
  for (const id of columnIds) {
    const hit = byId.get(id);
    if (hit) ordered.push(hit);
  }
  for (const f of prev.fields ?? []) {
    if (!columnIds.includes(f.columnId)) ordered.push(f);
  }
  const [row] = await (transaction ?? deps.database)
    .update(tableViews)
    .set({
      config: { ...prev, fields: ordered as FormFieldConfigJson[] },
      updatedAt: deps.now(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(deps, row, transaction);
}

export async function setFormSections(deps: CommandDependencies, {
  viewId,
  sections,
  organizationId,
}: SetFormSectionsInput & OrgScoped, transaction?: Transaction): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const prev = asFormConfig(view.config);
  const [row] = await (transaction ?? deps.database)
    .update(tableViews)
    .set({
      config: { ...prev, sections },
      updatedAt: deps.now(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(deps, row, transaction);
}

export async function setFormTheme(deps: CommandDependencies, {
  viewId,
  preset,
  overrides,
  organizationId,
}: SetFormThemeInput & OrgScoped, transaction?: Transaction): Promise<ResolvedFormView> {
  if (!(FORM_THEME_PRESETS as readonly string[]).includes(preset)) {
    throw new Error(`未知主题: ${preset}`);
  }
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const prev = asFormConfig(view.config);
  const [row] = await (transaction ?? deps.database)
    .update(tableViews)
    .set({
      config: {
        ...prev,
        theme: { preset, ...(overrides ? { overrides } : {}) },
      },
      updatedAt: deps.now(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(deps, row, transaction);
}

export async function setFormLayout(deps: CommandDependencies, {
  viewId,
  layout,
  organizationId,
}: SetFormLayoutInput & OrgScoped, transaction?: Transaction): Promise<ResolvedFormView> {
  if (!(FORM_LAYOUT_MODES as readonly string[]).includes(layout)) {
    throw new Error(`未知布局: ${layout}`);
  }
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const prev = asFormConfig(view.config);
  const [row] = await (transaction ?? deps.database)
    .update(tableViews)
    .set({
      config: { ...prev, layout },
      updatedAt: deps.now(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(deps, row, transaction);
}

export async function setFormFieldSettings(deps: CommandDependencies, {
  viewId,
  columnId,
  patch,
  organizationId,
}: SetFormFieldSettingsInput & OrgScoped, transaction?: Transaction): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const prev = asFormConfig(view.config);
  const fields = (prev.fields ?? []).map((f) =>
    f.columnId === columnId ? { ...f, ...patch, columnId } : f
  );
  if (!fields.some((f) => f.columnId === columnId)) {
    throw new Error(`表单中没有该字段: ${columnId}`);
  }
  const [row] = await (transaction ?? deps.database)
    .update(tableViews)
    .set({
      config: { ...prev, fields: fields as FormFieldConfigJson[] },
      updatedAt: deps.now(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(deps, row, transaction);
}

export async function setFormChrome(deps: CommandDependencies, {
  viewId,
  title,
  description,
  submitLabel,
  successMessage,
  welcome,
  ending,
  organizationId,
}: SetFormChromeInput & OrgScoped, transaction?: Transaction): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(deps, viewId, organizationId, transaction);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const prev = asFormConfig(view.config);
  const next: FormViewConfigJson = {
    ...prev,
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(submitLabel !== undefined ? { submitLabel } : {}),
    ...(successMessage !== undefined ? { successMessage } : {}),
    ...(welcome !== undefined ? { welcome: welcome ?? undefined } : {}),
    ...(ending !== undefined ? { ending: ending ?? undefined } : {}),
  };
  const [row] = await (transaction ?? deps.database)
    .update(tableViews)
    .set({
      config: next,
      updatedAt: deps.now(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(deps, row, transaction);
}

/** Ensure demo form + grid views exist (idempotent). */
export async function ensureDemoFormView(
  deps: CommandDependencies,
  tableId: string,
  organizationId: string
): Promise<ResolvedFormView | null> {
  await requireTableInOrg(deps, tableId, organizationId);

  const existingViews = await deps.database
    .select()
    .from(tableViews)
    .where(eq(tableViews.tableId, tableId));

  if (!existingViews.some((v) => v.type === "grid")) {
    await createGridView(deps, { tableId, name: "表格", organizationId });
  }

  const existingForm = existingViews.find((v) => v.type === "form");
  if (existingForm) {
    // Upgrade legacy seed form name/title + Typeform v2 defaults if needed
    const cfg = asFormConfig(existingForm.config);
    const needsRename =
      existingForm.name === "需求收集表" || cfg.title === "需求收集表";
    const needsTheme =
      !cfg.theme || !existingForm.config || !(existingForm.config as FormViewConfigJson).theme;
    if (needsRename || needsTheme) {
      const [row] = await deps.database
        .update(tableViews)
        .set({
          name: needsRename ? "表单" : existingForm.name,
          config: {
            ...cfg,
            title: needsRename ? "表单" : cfg.title,
            layout: "focus",
            theme: cfg.theme ?? { preset: "sunset" },
            welcome: cfg.welcome ?? {
              title: "告诉我们你的需求",
              description: "大约 1 分钟 · 提交后写入同一数据集",
              ctaLabel: "开始",
            },
            ending: cfg.ending ?? {
              title: "收到了！",
              description: "已写入表格，可在表格视图查看",
            },
          },
          updatedAt: deps.now(),
        })
        .where(eq(tableViews.id, existingForm.id))
        .returning();
      return resolveFormView(deps, row);
    }
    return resolveFormView(deps, existingForm);
  }

  return createFormView(deps, {
    tableId,
    name: "表单",
    config: {
      title: "表单",
      description: "提交一条新记录到当前数据集",
      submitLabel: "提交",
      successMessage: "已写入表格，可在表格视图查看",
      mode: "create",
      layout: "focus",
      theme: { preset: "sunset" },
      welcome: {
        title: "告诉我们你的需求",
        description: "大约 1 分钟 · 提交后写入同一数据集",
        ctaLabel: "开始",
      },
      ending: {
        title: "收到了！",
        description: "已写入表格，可在表格视图查看",
      },
    },
    organizationId,
  });
}
