import { and, asc, eq, max } from "drizzle-orm";
import { db } from "../db/index.js";
import { columns, tableViews, type FormViewConfigJson, type FormFieldConfigJson } from "../db/schema.js";
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
} from "@table/shared";
import { FORM_LAYOUT_MODES, FORM_THEME_PRESETS } from "@table/shared";

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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireViewInOrg(viewId: string, organizationId?: string) {
  const orgId = requireOrgId(organizationId);
  const [view] = await db.select().from(tableViews).where(eq(tableViews.id, viewId));
  if (!view) throw new Error(`视图不存在: ${viewId}`);
  await requireTableInOrg(view.tableId, orgId);
  return view;
}

async function loadColumns(tableId: string) {
  return db
    .select()
    .from(columns)
    .where(eq(columns.tableId, tableId))
    .orderBy(asc(columns.sortOrder));
}

function defaultFieldsFromColumns(
  cols: Awaited<ReturnType<typeof loadColumns>>
): FormFieldConfig[] {
  return cols
    .filter((c) => c.type !== "formula" && !(c.config as { hidden?: boolean })?.hidden)
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

async function nextSortOrder(tableId: string) {
  const [agg] = await db
    .select({ m: max(tableViews.sortOrder) })
    .from(tableViews)
    .where(eq(tableViews.tableId, tableId));
  return (agg?.m ?? -1) + 1;
}

async function resolveFormView(
  view: typeof tableViews.$inferSelect
): Promise<ResolvedFormView> {
  const cols = await loadColumns(view.tableId);
  const byId = Object.fromEntries(cols.map((c) => [c.id, c]));
  const config = asFormConfig(view.config);
  let fields = config.fields ?? [];
  if (!fields.length) {
    fields = defaultFieldsFromColumns(cols);
  }
  const resolvedFields = fields
    .filter((f) => byId[f.columnId])
    .map((f) => {
      const col = byId[f.columnId];
      const isFormula = col.type === "formula";
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

export async function listViews({
  tableId,
  organizationId,
}: ListViewsInput & OrgScoped): Promise<TableView[]> {
  await requireTableInOrg(tableId, organizationId);
  const rows = await db
    .select()
    .from(tableViews)
    .where(eq(tableViews.tableId, tableId))
    .orderBy(asc(tableViews.sortOrder), asc(tableViews.createdAt));
  return rows.map(toTableView);
}

export async function getView({
  viewId,
  organizationId,
}: GetViewInput & OrgScoped): Promise<TableView | ResolvedFormView> {
  const view = await requireViewInOrg(viewId, organizationId);
  if (view.type === "form") return resolveFormView(view);
  return toTableView(view);
}

export async function createGridView({
  tableId,
  name,
  organizationId,
}: CreateGridViewInput & OrgScoped): Promise<TableView> {
  await requireTableInOrg(tableId, organizationId);
  const sortOrder = await nextSortOrder(tableId);
  const [row] = await db
    .insert(tableViews)
    .values({
      tableId,
      type: "grid",
      name: name?.trim() || "表格",
      config: {},
      sortOrder,
    })
    .returning();
  return toTableView(row);
}

export async function createBoardView({
  tableId,
  name,
  config,
  organizationId,
}: CreateBoardViewInput & OrgScoped): Promise<TableView> {
  await requireTableInOrg(tableId, organizationId);
  const sortOrder = await nextSortOrder(tableId);
  const [row] = await db
    .insert(tableViews)
    .values({
      tableId,
      type: "board",
      name: name?.trim() || "看板",
      config: config ?? {},
      sortOrder,
    })
    .returning();
  return toTableView(row);
}

export async function createFormView({
  tableId,
  name,
  config,
  fields,
  organizationId,
}: CreateFormViewInput & OrgScoped): Promise<ResolvedFormView> {
  await requireTableInOrg(tableId, organizationId);
  const cols = await loadColumns(tableId);
  const formFields = fields?.length ? fields : defaultFieldsFromColumns(cols);
  const colIds = new Set(cols.map((c) => c.id));
  for (const f of formFields) {
    if (!colIds.has(f.columnId)) {
      throw new Error(`列不属于该表: ${f.columnId}`);
    }
  }

  const sortOrder = await nextSortOrder(tableId);
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

  const [row] = await db
    .insert(tableViews)
    .values({
      tableId,
      type: "form",
      name: name?.trim() || formConfig.title || "表单",
      config: formConfig,
      sortOrder,
    })
    .returning();

  return resolveFormView(row);
}

export async function updateFormView({
  viewId,
  name,
  config,
  organizationId,
}: UpdateFormViewInput & OrgScoped): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(viewId, organizationId);
  if (view.type !== "form") throw new Error("仅支持更新表单视图");
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
  const [row] = await db
    .update(tableViews)
    .set({
      ...(name !== undefined ? { name: name.trim() || view.name } : {}),
      config: next,
      updatedAt: new Date(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(row);
}

export async function setFormFields({
  viewId,
  fields,
  organizationId,
}: SetFormFieldsInput & OrgScoped): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(viewId, organizationId);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const cols = await loadColumns(view.tableId);
  const colIds = new Set(cols.map((c) => c.id));
  for (const f of fields) {
    if (!colIds.has(f.columnId)) throw new Error(`列不属于该表: ${f.columnId}`);
  }
  const prev = asFormConfig(view.config);
  const [row] = await db
    .update(tableViews)
    .set({
      config: { ...prev, fields: fields as FormFieldConfigJson[] },
      updatedAt: new Date(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(row);
}

export async function addFormField({
  viewId,
  field,
  organizationId,
}: AddFormFieldInput & OrgScoped): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(viewId, organizationId);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const cols = await loadColumns(view.tableId);
  if (!cols.some((c) => c.id === field.columnId)) {
    throw new Error(`列不属于该表: ${field.columnId}`);
  }
  const prev = asFormConfig(view.config);
  const fields = [...(prev.fields ?? []).filter((f) => f.columnId !== field.columnId), field];
  const [row] = await db
    .update(tableViews)
    .set({
      config: { ...prev, fields: fields as FormFieldConfigJson[] },
      updatedAt: new Date(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(row);
}

export async function removeFormField({
  viewId,
  columnId,
  organizationId,
}: RemoveFormFieldInput & OrgScoped): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(viewId, organizationId);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const prev = asFormConfig(view.config);
  const fields = (prev.fields ?? []).filter((f) => f.columnId !== columnId);
  const [row] = await db
    .update(tableViews)
    .set({
      config: { ...prev, fields: fields as FormFieldConfigJson[] },
      updatedAt: new Date(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(row);
}

export async function reorderFormFields({
  viewId,
  columnIds,
  organizationId,
}: ReorderFormFieldsInput & OrgScoped): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(viewId, organizationId);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const prev = asFormConfig(view.config);
  const byId = Object.fromEntries((prev.fields ?? []).map((f) => [f.columnId, f]));
  const ordered: FormFieldConfig[] = [];
  for (const id of columnIds) {
    if (byId[id]) ordered.push(byId[id]);
  }
  for (const f of prev.fields ?? []) {
    if (!columnIds.includes(f.columnId)) ordered.push(f);
  }
  const [row] = await db
    .update(tableViews)
    .set({
      config: { ...prev, fields: ordered as FormFieldConfigJson[] },
      updatedAt: new Date(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(row);
}

export async function setFormSections({
  viewId,
  sections,
  organizationId,
}: SetFormSectionsInput & OrgScoped): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(viewId, organizationId);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const prev = asFormConfig(view.config);
  const [row] = await db
    .update(tableViews)
    .set({
      config: { ...prev, sections },
      updatedAt: new Date(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(row);
}

export async function setFormTheme({
  viewId,
  preset,
  overrides,
  organizationId,
}: SetFormThemeInput & OrgScoped): Promise<ResolvedFormView> {
  if (!(FORM_THEME_PRESETS as readonly string[]).includes(preset)) {
    throw new Error(`未知主题: ${preset}`);
  }
  const view = await requireViewInOrg(viewId, organizationId);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const prev = asFormConfig(view.config);
  const [row] = await db
    .update(tableViews)
    .set({
      config: {
        ...prev,
        theme: { preset, ...(overrides ? { overrides } : {}) },
      },
      updatedAt: new Date(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(row);
}

export async function setFormLayout({
  viewId,
  layout,
  organizationId,
}: SetFormLayoutInput & OrgScoped): Promise<ResolvedFormView> {
  if (!(FORM_LAYOUT_MODES as readonly string[]).includes(layout)) {
    throw new Error(`未知布局: ${layout}`);
  }
  const view = await requireViewInOrg(viewId, organizationId);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const prev = asFormConfig(view.config);
  const [row] = await db
    .update(tableViews)
    .set({
      config: { ...prev, layout },
      updatedAt: new Date(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(row);
}

export async function setFormFieldSettings({
  viewId,
  columnId,
  patch,
  organizationId,
}: SetFormFieldSettingsInput & OrgScoped): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(viewId, organizationId);
  if (view.type !== "form") throw new Error("仅支持表单视图");
  const prev = asFormConfig(view.config);
  const fields = (prev.fields ?? []).map((f) =>
    f.columnId === columnId ? { ...f, ...patch, columnId } : f
  );
  if (!fields.some((f) => f.columnId === columnId)) {
    throw new Error(`表单中没有该字段: ${columnId}`);
  }
  const [row] = await db
    .update(tableViews)
    .set({
      config: { ...prev, fields: fields as FormFieldConfigJson[] },
      updatedAt: new Date(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(row);
}

export async function setFormChrome({
  viewId,
  title,
  description,
  submitLabel,
  successMessage,
  welcome,
  ending,
  organizationId,
}: SetFormChromeInput & OrgScoped): Promise<ResolvedFormView> {
  const view = await requireViewInOrg(viewId, organizationId);
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
  const [row] = await db
    .update(tableViews)
    .set({
      config: next,
      updatedAt: new Date(),
    })
    .where(eq(tableViews.id, viewId))
    .returning();
  return resolveFormView(row);
}

/** Ensure demo form + grid views exist (idempotent). */
export async function ensureDemoFormView(
  tableId: string,
  organizationId: string
): Promise<ResolvedFormView | null> {
  await requireTableInOrg(tableId, organizationId);

  const existingViews = await db
    .select()
    .from(tableViews)
    .where(eq(tableViews.tableId, tableId));

  if (!existingViews.some((v) => v.type === "grid")) {
    await createGridView({ tableId, name: "表格", organizationId });
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
      const [row] = await db
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
          updatedAt: new Date(),
        })
        .where(eq(tableViews.id, existingForm.id))
        .returning();
      return resolveFormView(row);
    }
    return resolveFormView(existingForm);
  }

  return createFormView({
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
