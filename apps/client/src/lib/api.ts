import { workspaceHeaders, workspaceUrl, workspaceCacheKey } from "./workspace-scope";
import { toast } from "sonner";
import i18n from "@/i18n";
import { announceApiWrite } from "./data-changes";
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
  BoardViewConfig,
  ResolvedFormView,
  FormFieldConfig,
  FormThemePresetId,
  FormLayoutMode,
  FormViewConfig,
  FormSectionConfig,
} from "@tabdo/shared";

function announceAgentChange<T>(result: T): T {
  window.dispatchEvent(new Event("tabdo:agents-changed"));
  return result;
}

export type ApiRequestInit = RequestInit & {
  /** When true, toast 5xx. Default: toast only for non-GET (mutations). List pages use ListErrorState instead. */
  errorToast?: boolean;
};

async function request<T>(url: string, init?: ApiRequestInit): Promise<T> {
  const scope = workspaceCacheKey();
  const checkScope = () => { if (scope !== workspaceCacheKey()) throw new DOMException("Workspace changed", "AbortError"); };
  const { errorToast, ...fetchInit } = init ?? {};
  const method = (fetchInit.method ?? "GET").toUpperCase();
  const shouldToast =
    errorToast ?? (method !== "GET" && method !== "HEAD");
  const res = await fetch(url, {
    ...fetchInit,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...workspaceHeaders(),
      ...(fetchInit.headers ?? {}),
    },
  }).catch((error: unknown) => {
    checkScope();
    if (error instanceof Error && error.name === "AbortError") throw error;
    const message = i18n.t("errors:network");
    toast.error(message, { id: "api-network-error" });
    throw new Error(message, { cause: error });
  });
  checkScope();
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const message =
      res.status >= 500
        ? i18n.t("errors:systemUnavailable")
        : err.error || i18n.t("errors:requestFailed", { status: res.status });
    if (res.status >= 500 && shouldToast) toast.error(message, { id: "api-system-error" });
    throw new Error(message);
  }
  const result = await res.json() as T;
  checkScope();
  announceApiWrite(url, fetchInit, result);
  return result;
}

export type AgentPersonaInfo = {
  runtime?: "local" | "sandbox";
  sandboxProvider?: import("@tabdo/shared").SandboxProvider;
  systemPrompt?: string;
  defaultHarness?: "codex" | "claude" | "pi";
  defaultModel?: string;
  avatarColor?: string;
  skillNames?: string[];
  disabledTools?: string[];
};

export type MemberOption = {
  id: string;
  userId: string;
  name: string;
  email: string;
  kind: "human" | "agent";
  role: string;
  image?: string | null;
  agent?: {
    displayName?: string | null;
    persona?: AgentPersonaInfo;
  } | null;
};

async function relationCommand<T>(command:string,input:unknown){
 const result=await request<{result:T}>("/api/commands",{method:"POST",body:JSON.stringify({command,input})});return result.result;
}
/** Multipart must leave Content-Type to the browser so its boundary stays intact. */
function uploadFiles(tableId: string, columnId: string, files: File[], onProgress?: (percent: number) => void): Promise<{ files: import("@tabdo/shared").StoredFile[] }> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    for (const file of files) body.append("files", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/tables/${encodeURIComponent(tableId)}/columns/${encodeURIComponent(columnId)}/files`);
    xhr.withCredentials = true;
    for (const [key, value] of Object.entries(workspaceHeaders())) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new Error(i18n.t("errors:network")));
    xhr.onabort = () => reject(new Error(i18n.t("errors:network")));
    xhr.onload = () => {
      let response: { files: import("@tabdo/shared").StoredFile[]; error?: string };
      try { response = JSON.parse(xhr.responseText); }
      catch { reject(new Error(i18n.t("errors:requestFailed", { status: xhr.status }))); return; }
      if (xhr.status < 200 || xhr.status >= 300) { reject(new Error(response.error || i18n.t("errors:requestFailed", { status: xhr.status }))); return; }
      resolve(response);
    };
    xhr.send(body);
  });
}
export type UserApiKeyInfo = import("@tabdo/shared").ApiKeyInfo;

export const api = {
  listApiKeys: (signal?: AbortSignal) => request<{ keys: UserApiKeyInfo[]; tables: (TableMeta & { workspaceName: string })[]; calendars: { id: string; name: string; workspaceName: string; workspaceId: string }[] }>("/api/user/api-keys", { signal }),
  createApiKey: (input: import("@tabdo/shared").ApiKeyInput) => request<{ key: UserApiKeyInfo; secret: string }>("/api/user/api-keys", { method: "POST", body: JSON.stringify(input), errorToast: false }),
  updateApiKey: (id: string, input: import("@tabdo/shared").ApiKeyInput) => request<{ key: UserApiKeyInfo }>(`/api/user/api-keys/${id}`, { method: "PATCH", body: JSON.stringify(input), errorToast: false }),
  deleteApiKey: (id: string) => request<{ id: string }>(`/api/user/api-keys/${id}`, { method: "DELETE", errorToast: false }),
  uploadFiles,
  getFiles: (ids: string[]) => request<{ files: import("@tabdo/shared").StoredFile[] }>(`/api/files?ids=${encodeURIComponent(ids.join(","))}`),
  fileDownloadUrl: (id: string) => workspaceUrl(`/api/files/${encodeURIComponent(id)}/download`),
  getAgentTools: (harness: "pi" | "codex" | "claude", signal?: AbortSignal) => request<{ harness: string; supportsFiltering: boolean; tools: import("@tabdo/shared").AgentToolCatalogItem[] }>(`/api/members/agents/tools?harness=${harness}`, { signal }),
  listAgentRuns: (threadId: string, signal?: AbortSignal) => request<{ runs: import("@tabdo/shared").AgentRunSummary[] }>(`/api/threads/${threadId}/runs`, { signal }),
  listAgentRunEvents: (threadId: string, runId: string, signal?: AbortSignal) => request<{ events: import("@tabdo/shared").AgentRunEvent[] }>(`/api/threads/${threadId}/runs/${runId}/events`, { signal }),
  cancelAgentRun: (threadId: string, runId: string) => request<{ ok: boolean }>(`/api/threads/${threadId}/runs/${runId}/cancel`, { method: "POST", body: "{}" }),
  getChatMessages: (threadId: string, signal?: AbortSignal) => request<{ headId: string | null; messages: Array<{ id: string; parentId: string | null; format: string; content: Record<string, unknown> }> }>(`/api/threads/${threadId}/messages`, { signal }),
  getSiteConfig: () => request<import("@tabdo/shared").SiteConfig>("/api/sites/config"),
  listSites: () => request<import("@tabdo/shared").SiteSummary[]>("/api/sites"),
  getSite: (id: string, revisionId?: string) => request<import("@tabdo/shared").SiteDetail>(`/api/sites/${id}${revisionId ? `?revisionId=${revisionId}` : ""}`),
  saveSite: (input: import("@tabdo/shared").SaveSiteInput) => request<import("@tabdo/shared").SiteDetail>("/api/sites", { method: "POST", body: JSON.stringify(input) }),
  deleteSite: (id: string) => request<{ id: string }>(`/api/sites/${id}`, { method: "DELETE" }),
  previewSite: (id: string, files: import("@tabdo/shared").SiteSourceFile[], token: string | undefined, generation: number, signal?: AbortSignal) => request<{ token: string; url: string }>(`/api/sites/${id}/preview`, { method: "POST", body: JSON.stringify({ files, token, generation }), signal, errorToast: false }),
  restoreSite: (id: string, revisionId: string, expectedVersion: number) => request<import("@tabdo/shared").SiteDetail>(`/api/sites/${id}/restore`, { method: "POST", body: JSON.stringify({ revisionId, expectedVersion }) }),
  publishSite: (id: string, revisionId: string) => request<import("@tabdo/shared").SiteDetail>(`/api/sites/${id}/publish`, { method: "POST", body: JSON.stringify({ revisionId }) }),
  unpublishSite: (id: string) => request<import("@tabdo/shared").SiteDetail>(`/api/sites/${id}/unpublish`, { method: "POST", body: "{}" }),
  listSkills: () => request<import("@tabdo/shared").SkillLibrary>("/api/skills"),
  getSkill: (id: string) => request<import("@tabdo/shared").SkillDocument>(`/api/skills/${encodeURIComponent(id)}`),
  updateSkill: (id: string, document: string, expectedVersion: number, files?: import("@tabdo/shared").SkillFile[]) => request<import("@tabdo/shared").SkillDocument>(`/api/skills/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ document, expectedVersion, files }) }),
  setSkillEnabled: (id: string, enabled: boolean) => request<{ ok: boolean }>(`/api/skills/${encodeURIComponent(id)}/enabled`, { method: "PUT", body: JSON.stringify({ enabled }) }),
  deleteSkill: (id: string) => request<{ ok: boolean }>(`/api/skills/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getRow:(rowId:string)=>relationCommand<RowData & {columns:ColumnDef[]}>("getRow",{rowId}),
  queryRelationRecords:(input:import("@tabdo/shared").RelationQueryInput)=>relationCommand<import("@tabdo/shared").RelationQueryResult>("queryRelationRecords",input),
  setRelation:(input:import("@tabdo/shared").RelationWriteInput)=>relationCommand<RowData>("setRelation",input),
  addRelation:(input:import("@tabdo/shared").RelationWriteInput)=>relationCommand<RowData>("addRelation",input),
  removeRelation:(input:import("@tabdo/shared").RelationWriteInput)=>relationCommand<RowData>("removeRelation",input),
  listTables: () => request<TableMeta[]>("/api/tables"),
  deleteTable: (id: string) => request<{ ok: boolean }>(`/api/tables/${id}`, { method: "DELETE" }),
  getColumn: (id: string) => request<ColumnDef>(`/api/columns/${encodeURIComponent(id)}`),
  getTable: (id: string) => request<FullTable>(`/api/tables/${id}`),
  createTable: (name: string, description?: string) =>
    request<TableMeta>("/api/tables", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  patchTable: (id: string, data: { name?: string; description?: string | null; icon?: string | null; pinned?: boolean }) =>
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
    request<{ members: MemberOption[]; actor: { userId: string; role: string } | null }>("/api/members"),
  updateMemberAvatar: (memberId: string, image: string | null) =>
    request<{ ok: boolean; image: string | null }>(`/api/members/${memberId}/avatar`, { method: "PATCH", body: JSON.stringify({ image }) }).then(announceAgentChange),
  inviteMember: (email: string, role: "admin" | "member" = "member") =>
    request<{ ok: boolean }>("/api/members/invite", {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),
  createAgent: (data: {
    name: string;
    image?: string | null;
    role?: "admin" | "member";
    persona?: {
      runtime?: "local" | "sandbox";
      sandboxProvider?: import("@tabdo/shared").SandboxProvider;
      systemPrompt?: string;
      defaultHarness?: "codex" | "claude" | "pi";
      defaultModel?: string;
      avatarColor?: string;
      skillNames?: string[];
      disabledTools?: string[];
    };
  }) =>
    request<{
      ok: boolean;
      member: MemberOption;
    }>("/api/members/agents", {
      method: "POST",
      body: JSON.stringify(data),
    }).then(announceAgentChange),
  /** Update agent display/persona. Harness is immutable after create. */
  updateAgent: (
    memberId: string,
    data: {
      name?: string;
      image?: string | null;
      persona?: {
        runtime?: "local" | "sandbox";
        sandboxProvider?: import("@tabdo/shared").SandboxProvider;
        systemPrompt?: string;
        defaultModel?: string;
        avatarColor?: string;
        skillNames?: string[];
        disabledTools?: string[];
      };
    }
  ) =>
    request<{ ok: boolean; member: MemberOption }>(
      `/api/members/agents/${memberId}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      }
    ).then(announceAgentChange),
  me: () =>
    request<{
      actor: unknown;
      organization: { id: string; name: string; slug: string } | null;
    }>("/api/members/me"),

  getChatThread: (id: string) => request<{ id: string; kind: "chat" | "scheduled_task"; scheduledTaskId: string | null }>(`/api/threads/${encodeURIComponent(id)}`),

  listAutomations: (tableId: string) =>
    request<AutomationRule[]>(`/api/tables/${tableId}/automations`),
  listWorkspaceAutomations: (offset = 0, limit = 100, signal?: AbortSignal, kind?: "event" | "schedule") => request<{ rules: (AutomationRule & { sourceName: string | null })[]; hasMore: boolean }>(`/api/automations?offset=${offset}&limit=${limit}${kind ? `&kind=${kind}` : ""}`, { signal }),
  getAutomation: (id: string) => request<AutomationRule & { sourceName: string | null }>(`/api/automations/${id}`),
  listReports: (offset = 0, limit = 100, signal?: AbortSignal) => request<{ reports: import("@tabdo/shared").Report[]; hasMore: boolean }>(`/api/reports?offset=${offset}&limit=${limit}`, { signal }),
  getReport: (id: string) => request<import("@tabdo/shared").Report>(`/api/reports/${id}`),
  saveReport: (config: import("@tabdo/shared").ReportPageConfig, id?: string, expectedVersion?: number) => request<import("@tabdo/shared").Report>(id ? `/api/reports/${id}` : "/api/reports", { method: id ? "PATCH" : "POST", body: JSON.stringify(id ? { ...config, expectedVersion } : config) }),
  previewReportPage: (config: import("@tabdo/shared").ReportPageConfig) => request<import("@tabdo/shared").ReportPageData>("/api/reports/preview-page", { method: "POST", body: JSON.stringify(config) }),
  previewReport: (config: import("@tabdo/shared").ReportConfig) => request<import("@tabdo/shared").ReportData>("/api/reports/preview", { method: "POST", body: JSON.stringify(config) }),
  deleteReport: (id: string) => request(`/api/reports/${id}`, { method: "DELETE" }),
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
  createSourceAutomation: (data: import("@tabdo/shared").CreateAutomationInput) =>
    request<AutomationRule>("/api/automations", { method: "POST", body: JSON.stringify(data) }),
  updateAutomation: (id: string, data: Omit<import("@tabdo/shared").UpdateAutomationInput, "automationId">) =>
    request<AutomationRule>(`/api/automations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  listScheduledRuns: (id: string, offset: number, limit: number, signal?: AbortSignal) => request<{ runs: import("@tabdo/shared").ScheduledTaskRun[]; hasMore: boolean }>(`/api/schedules/${id}/runs?offset=${offset}&limit=${limit}`, { signal }),
  getScheduledRunThread: (taskId: string, threadId: string) => request<{ id: string; title: string | null; custom: Record<string, unknown> }>(`/api/schedules/${taskId}/runs/${threadId}`),
  listRuleRuns: (id: string) => request<AutomationRun[]>(`/api/automations/${id}/runs`),
  listIntegrations: () => request<{ connections: import("@tabdo/shared").IntegrationConnection[]; canManage: boolean }>("/api/integrations"),
  createIntegration: (data: { provider: "agentmail"; name: string; apiKey: string }) => request<{ connection: import("@tabdo/shared").IntegrationConnection }>("/api/integrations", { method: "POST", body: JSON.stringify(data) }),
  updateIntegration: (id: string, data: { name?: string; apiKey?: string; enabled?: boolean }) => request<{ connection: import("@tabdo/shared").IntegrationConnection }>(`/api/integrations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteIntegration: (id: string) => request(`/api/integrations/${id}`, { method: "DELETE" }),
  testIntegration: (id: string) => request<{ connection: import("@tabdo/shared").IntegrationConnection; ok: boolean }>(`/api/integrations/${id}/test`, { method: "POST" }),
  listIntegrationInboxes: (id: string) => request<{ inboxes: import("@tabdo/shared").IntegrationInbox[] }>(`/api/integrations/${id}/inboxes`),
  registerIntegrationWebhook: (id: string, inboxIds: string[]) => request<{ endpoint: import("@tabdo/shared").WebhookEndpoint }>(`/api/integrations/${id}/webhooks`, { method: "POST", body: JSON.stringify({ inboxIds }) }),
  listWebhookEndpoints: () => request<{ endpoints: import("@tabdo/shared").WebhookEndpoint[]; canManage: boolean }>("/api/webhook-endpoints"),
  createWebhookEndpoint: (name: string) => request<{ endpoint: import("@tabdo/shared").WebhookEndpoint; token: string }>("/api/webhook-endpoints", { method: "POST", body: JSON.stringify({ name }) }),
  updateWebhookEndpoint: (id: string, data: { name?: string; enabled?: boolean }) => request<{ endpoint: import("@tabdo/shared").WebhookEndpoint }>(`/api/webhook-endpoints/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteWebhookEndpoint: (id: string) => request(`/api/webhook-endpoints/${id}`, { method: "DELETE" }),
  deleteAutomation: (id: string) =>
    request<{ ok: boolean }>(`/api/automations/${id}`, { method: "DELETE" }),
  replayAutomationRun: (id: string) =>
    request<{ ok: boolean }>(`/api/automation-runs/${id}/replay`, { method: "POST" }),
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
  renameView: async (viewId: string, name: string) => (await request<{ result: TableView }>("/api/commands", { method: "POST", body: JSON.stringify({ command: "renameView", input: { viewId, name } }) })).result,
  setDefaultView: async (viewId: string) => (await request<{ result: TableView }>("/api/commands", { method: "POST", body: JSON.stringify({ command: "setDefaultView", input: { viewId } }) })).result,
  updateBoardView: async (viewId: string, config: BoardViewConfig) => (await request<{ result: TableView }>("/api/commands", { method: "POST", body: JSON.stringify({ command: "updateBoardView", input: { viewId, config } }) })).result,
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

