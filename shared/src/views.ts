/** Table views (grid / board / form) — form config is view metadata over the same columns/rows. */

export const VIEW_TYPES = ["grid", "board", "form"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const FORM_LAYOUT_MODES = ["classic", "focus"] as const;
export type FormLayoutMode = (typeof FORM_LAYOUT_MODES)[number];

export const FORM_THEME_PRESETS = [
  "notion-light",
  "ink",
  "ocean",
  "sunset",
  "midnight",
] as const;
export type FormThemePresetId = (typeof FORM_THEME_PRESETS)[number];

export type FormThemeTokens = {
  background?: string;
  question?: string;
  answer?: string;
  button?: string;
  buttonText?: string;
  accent?: string;
  radius?: "sm" | "md" | "lg";
  font?: "sans" | "serif";
};

export type FormThemeConfig = {
  preset: FormThemePresetId;
  overrides?: FormThemeTokens;
};

export type FormQuestionSettings =
  | { kind: "text"; multiline?: boolean; maxLength?: number; inputMode?: "text" | "email" | "url" }
  | { kind: "number"; min?: number; max?: number; step?: number }
  | { kind: "select"; display?: "dropdown" | "buttons" }
  | { kind: "multi_select"; display?: "checkbox" | "buttons"; minItems?: number; maxItems?: number }
  | { kind: "date"; includeTime?: boolean }
  | { kind: "checkbox"; agreeLabel?: string }
  | { kind: "person"; multiple?: boolean }
  | { kind: "formula" };

export type FormFieldConfig = {
  columnId: string;
  label?: string;
  helpText?: string;
  placeholder?: string;
  required?: boolean;
  hidden?: boolean;
  readOnly?: boolean;
  defaultValue?: string | number | boolean | string[] | null;
  settings?: FormQuestionSettings;
};

export type FormSectionConfig = {
  id: string;
  title: string;
  fieldIds: string[];
};

export type FormChromeBlock = {
  title?: string;
  description?: string;
  ctaLabel?: string;
};

export type FormViewConfig = {
  title?: string;
  description?: string;
  submitLabel?: string;
  successMessage?: string;
  mode?: "create" | "edit";
  fields: FormFieldConfig[];
  sections?: FormSectionConfig[];
  /** Typeform-like layout; default classic */
  layout?: FormLayoutMode;
  theme?: FormThemeConfig;
  welcome?: FormChromeBlock;
  ending?: FormChromeBlock;
};

export type BoardViewConfig = {
  statusColumnId?: string;
};

export type GridViewConfig = Record<string, never>;

export type ViewConfig = FormViewConfig | BoardViewConfig | GridViewConfig | Record<string, unknown>;

export type TableView = {
  id: string;
  tableId: string;
  type: ViewType | string;
  name: string;
  config: ViewConfig;
  sortOrder: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type ResolvedFormField = FormFieldConfig & {
  columnName: string;
  columnType: string;
  columnConfig: Record<string, unknown>;
};

export type ResolvedFormView = TableView & {
  type: "form";
  config: FormViewConfig;
  resolvedFields: ResolvedFormField[];
};

export type ListViewsInput = { tableId: string };
export type GetViewInput = { viewId: string };
export type CreateFormViewInput = {
  tableId: string;
  name?: string;
  config?: Partial<FormViewConfig>;
  /** If omitted, all writable (non-formula, non-hidden) columns are included */
  fields?: FormFieldConfig[];
};
export type CreateBoardViewInput = {
  tableId: string;
  name?: string;
  config?: BoardViewConfig;
};
export type CreateGridViewInput = {
  tableId: string;
  name?: string;
};
export type UpdateFormViewInput = {
  viewId: string;
  name?: string;
  config?: Partial<FormViewConfig>;
};
export type SetFormFieldsInput = {
  viewId: string;
  fields: FormFieldConfig[];
};
export type AddFormFieldInput = {
  viewId: string;
  field: FormFieldConfig;
};
export type RemoveFormFieldInput = {
  viewId: string;
  columnId: string;
};
export type ReorderFormFieldsInput = {
  viewId: string;
  columnIds: string[];
};
export type SetFormSectionsInput = {
  viewId: string;
  sections: FormSectionConfig[];
};
export type SetFormThemeInput = {
  viewId: string;
  preset: FormThemePresetId;
  overrides?: FormThemeTokens;
};
export type SetFormLayoutInput = {
  viewId: string;
  layout: FormLayoutMode;
};
export type SetFormFieldSettingsInput = {
  viewId: string;
  columnId: string;
  patch: Partial<Omit<FormFieldConfig, "columnId">>;
};
export type SetFormChromeInput = {
  viewId: string;
  title?: string;
  description?: string;
  submitLabel?: string;
  successMessage?: string;
  welcome?: FormChromeBlock | null;
  ending?: FormChromeBlock | null;
};
