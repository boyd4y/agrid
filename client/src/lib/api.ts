import type {
  CellValue,
  ColumnDef,
  ColumnType,
  FullTable,
  RowData,
  TableMeta,
  ColumnConfig,
  QueryRowsPage,
} from "@/types/table";
import type {
  FilterCondition,
  FilterLogic,
  AutomationRule,
  AutomationRun,
  AutomationTrigger,
  AutomationAction,
  TableView,
  ResolvedFormView,
  FormFieldConfig,
  FormThemePresetId,
  FormLayoutMode,
  FormViewConfig,
  FormSectionConfig,
} from "@table/shared";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `请求失败 ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type AgentPersonaInfo = {
  systemPrompt?: string;
  defaultHarness?: "codex" | "claude" | "pi";
  defaultModel?: string;
  avatarColor?: string;
};

export type MemberOption = {
  id: string;
  userId: string;
  name: string;
  email: string;
  kind: "human" | "agent";
  role: string;
  agent?: {
    displayName?: string | null;
    persona?: AgentPersonaInfo;
    apiKeyPrefix?: string;
  } | null;
};

export const api = {
  listTables: () => request<TableMeta[]>("/api/tables"),
  deleteTable: (id: string) => request<{ ok: boolean }>(`/api/tables/${id}`, { method: "DELETE" }),
  getTable: (id: string) => request<FullTable>(`/api/tables/${id}`),
  createTable: (name: string, description?: string) =>
    request<TableMeta>("/api/tables", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  patchTable: (id: string, data: { name?: string; description?: string | null }) =>
    request<TableMeta>(`/api/tables/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  addRow: (tableId: string, cells?: Record<string, CellValue>) =>
    request<RowData>(`/api/tables/${tableId}/rows`, {
      method: "POST",
      body: JSON.stringify({ cells }),
    }),
  patchRow: (
    rowId: string,
    data: {
      cells?: Record<string, CellValue>;
      cell?: { columnId: string; value: CellValue };
      expectedVersion?: number;
    }
  ) =>
    request<RowData>(`/api/rows/${rowId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteRow: (rowId: string) =>
    request<{ ok: boolean }>(`/api/rows/${rowId}`, { method: "DELETE" }),
  addColumn: (
    tableId: string,
    data: {
      name: string;
      type: ColumnType;
      config?: ColumnConfig;
      width?: number;
    }
  ) =>
    request<ColumnDef>(`/api/tables/${tableId}/columns`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  patchColumn: (
    columnId: string,
    data: Partial<{
      name: string;
      type: ColumnType;
      config: ColumnConfig;
      width: number;
      sortOrder: number;
    }>
  ) =>
    request<ColumnDef>(`/api/columns/${columnId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteColumn: (columnId: string) =>
    request<{ ok: boolean }>(`/api/columns/${columnId}`, { method: "DELETE" }),
  reorderColumns: async (tableId: string, columnIds: string[]) => {
    const r = await request<{ ok: boolean; result: ColumnDef[] }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        command: "reorderColumns",
        input: { tableId, columnIds },
      }),
    });
    return r.result;
  },
  /** Windowed keyset query (preferred for 10w+) */
  queryRowsPage: (
    tableId: string,
    body: {
      cursor?: string | null;
      limit?: number;
      includeTotal?: boolean;
      filters?: FilterCondition[];
      filterLogic?: FilterLogic;
      sort?: { columnId: string; direction: "asc" | "desc" } | null;
      statusColumnId?: string;
      statusValue?: string | null;
    } = {}
  ) =>
    request<QueryRowsPage>(`/api/tables/${tableId}/rows/query`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  queryRows: async (input: {
    tableId: string;
    filters?: FilterCondition[];
    filterLogic?: FilterLogic;
    sort?: { columnId: string; direction: "asc" | "desc" } | null;
    cursor?: string | null;
    limit?: number;
    includeTotal?: boolean;
    statusColumnId?: string;
    statusValue?: string | null;
  }) => {
    return api.queryRowsPage(input.tableId, input);
  },
  listMembers: () =>
    request<{ members: MemberOption[] }>("/api/members").catch(() => ({
      members: [] as MemberOption[],
    })),
  inviteMember: (email: string, role: "admin" | "member" = "member") =>
    request<{ ok: boolean }>("/api/members/invite", {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),
  createAgent: (data: {
    name: string;
    role?: "admin" | "member";
    persona?: {
      systemPrompt?: string;
      defaultHarness?: "codex" | "claude" | "pi";
      defaultModel?: string;
      avatarColor?: string;
    };
  }) =>
    request<{
      ok: boolean;
      member: MemberOption;
      apiKey: string;
    }>("/api/members/agents", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  /** Update agent display/persona. Harness is immutable after create. */
  updateAgent: (
    memberId: string,
    data: {
      name?: string;
      persona?: {
        systemPrompt?: string;
        defaultModel?: string;
        avatarColor?: string;
      };
    }
  ) =>
    request<{ ok: boolean; member: MemberOption }>(
      `/api/members/agents/${memberId}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      }
    ),
  me: () =>
    request<{
      actor: unknown;
      organization: { id: string; name: string; slug: string } | null;
    }>("/api/members/me"),

  listAutomations: (tableId: string) =>
    request<AutomationRule[]>(`/api/tables/${tableId}/automations`),
  createAutomation: (
    tableId: string,
    data: {
      name: string;
      enabled?: boolean;
      trigger: AutomationTrigger;
      conditions?: FilterCondition[];
      conditionLogic?: FilterLogic;
      actions: AutomationAction[];
    }
  ) =>
    request<AutomationRule>(`/api/tables/${tableId}/automations`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateAutomation: (
    id: string,
    data: Partial<{
      name: string;
      enabled: boolean;
      trigger: AutomationTrigger;
      conditions: FilterCondition[];
      conditionLogic: FilterLogic;
      actions: AutomationAction[];
    }>
  ) =>
    request<AutomationRule>(`/api/automations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteAutomation: (id: string) =>
    request<{ ok: boolean }>(`/api/automations/${id}`, { method: "DELETE" }),
  listAutomationRuns: (tableId: string, opts?: { automationId?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (opts?.automationId) q.set("automationId", opts.automationId);
    if (opts?.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return request<AutomationRun[]>(
      `/api/tables/${tableId}/automation-runs${qs ? `?${qs}` : ""}`
    );
  },

  listViews: async (tableId: string) => {
    const r = await request<{ ok: boolean; result: TableView[] }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({ command: "listViews", input: { tableId } }),
    });
    return r.result;
  },
  getView: async (viewId: string) => {
    const r = await request<{ ok: boolean; result: TableView | ResolvedFormView }>(
      "/api/commands",
      {
        method: "POST",
        body: JSON.stringify({ command: "getView", input: { viewId } }),
      }
    );
    return r.result;
  },
  deleteView: async (viewId: string) => {
    const r = await request<{ ok: boolean; result: { ok: true } }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({ command: "deleteView", input: { viewId } }),
    });
    return r.result;
  },
  createFormView: async (
    tableId: string,
    data?: {
      name?: string;
      title?: string;
      description?: string;
      submitLabel?: string;
      successMessage?: string;
      fields?: FormFieldConfig[];
    }
  ) => {
    const r = await request<{ ok: boolean; result: ResolvedFormView }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        command: "createFormView",
        input: {
          tableId,
          name: data?.name ?? data?.title,
          fields: data?.fields,
          config: {
            title: data?.title,
            description: data?.description,
            submitLabel: data?.submitLabel,
            successMessage: data?.successMessage,
            mode: "create" as const,
          },
        },
      }),
    });
    return r.result;
  },
  updateFormView: async (
    viewId: string,
    data: { name?: string; config?: Partial<FormViewConfig> }
  ) => {
    const r = await request<{ ok: boolean; result: ResolvedFormView }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        command: "updateFormView",
        input: { viewId, ...data },
      }),
    });
    return r.result;
  },
  setFormFields: async (viewId: string, fields: FormFieldConfig[]) => {
    const r = await request<{ ok: boolean; result: ResolvedFormView }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        command: "setFormFields",
        input: { viewId, fields },
      }),
    });
    return r.result;
  },
  setFormSections: async (viewId: string, sections: FormSectionConfig[]) => {
    const r = await request<{ ok: boolean; result: ResolvedFormView }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        command: "setFormSections",
        input: { viewId, sections },
      }),
    });
    return r.result;
  },
reorderFormFields: async (viewId: string, columnIds: string[]) => {
    const r = await request<{ ok: boolean; result: ResolvedFormView }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        command: "reorderFormFields",
        input: { viewId, columnIds },
      }),
    });
    return r.result;
  },
  createGridView: async (tableId: string, name?: string) => {
    const r = await request<{ ok: boolean; result: TableView }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        command: "createGridView",
        input: { tableId, name },
      }),
    });
    return r.result;
  },
  createBoardView: async (
    tableId: string,
    data?: { name?: string; statusColumnId?: string }
  ) => {
    const r = await request<{ ok: boolean; result: TableView }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        command: "createBoardView",
        input: {
          tableId,
          name: data?.name,
          config: data?.statusColumnId
            ? { statusColumnId: data.statusColumnId }
            : {},
        },
      }),
    });
    return r.result;
  },
  setFormTheme: async (
    viewId: string,
    preset: FormThemePresetId,
    overrides?: Record<string, unknown>
  ) => {
    const r = await request<{ ok: boolean; result: ResolvedFormView }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        command: "setFormTheme",
        input: { viewId, preset, overrides },
      }),
    });
    return r.result;
  },
  setFormLayout: async (viewId: string, layout: FormLayoutMode) => {
    const r = await request<{ ok: boolean; result: ResolvedFormView }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        command: "setFormLayout",
        input: { viewId, layout },
      }),
    });
    return r.result;
  },
  setFormFieldSettings: async (
    viewId: string,
    columnId: string,
    patch: Partial<FormFieldConfig>
  ) => {
    const r = await request<{ ok: boolean; result: ResolvedFormView }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        command: "setFormFieldSettings",
        input: { viewId, columnId, patch },
      }),
    });
    return r.result;
  },
  setFormChrome: async (
    viewId: string,
    data: {
      title?: string;
      description?: string;
      submitLabel?: string;
      successMessage?: string;
      welcome?: { title?: string; description?: string; ctaLabel?: string } | null;
      ending?: { title?: string; description?: string } | null;
    }
  ) => {
    const r = await request<{ ok: boolean; result: ResolvedFormView }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        command: "setFormChrome",
        input: { viewId, ...data },
      }),
    });
    return r.result;
  },

};

