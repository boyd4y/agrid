import { workspaceHeaders, workspaceCacheKey } from "./workspace-scope";
import { useMemo } from "react";
import { useAui, type RemoteThreadListAdapter, type ThreadHistoryAdapter } from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import i18n from "@/i18n";

export type ChatPageContext = {
  page: "ai" | "tables" | "table" | "automations" | "reports" | "skills" | "agents" | "members" | "settings" | "schedules" | "sites";
  tableId: string | null;
  siteId?: string | null;
  reportId?: string | null;
  scheduledTaskId?: string | null;
};
type ThreadRow = { id: string; title: string | null; status: "regular"; custom: Record<string, unknown>; lastMessageAt: string | null };
type StoredMessage = { id: string; parentId: string | null; format: string; content: unknown };
async function request<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const scope = workspaceCacheKey();
  const response = await fetch(url, { method: body === undefined && method === "POST" ? "GET" : method, headers: { "Content-Type": "application/json", ...workspaceHeaders() }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (scope !== workspaceCacheKey()) throw new DOMException("Workspace changed", "AbortError");
  if (!response.ok) throw new Error(i18n.t("common:chatPersistFailed", { status: response.status, body: await response.text() }));
  return response.json();
}
const metadata = (thread: ThreadRow) => ({
  remoteId: thread.id, title: thread.title ?? undefined, status: thread.status, custom: thread.custom,
  lastMessageAt: thread.lastMessageAt ? new Date(thread.lastMessageAt) : undefined,
});

function useThreadAdapters() {
  const aui = useAui();
  const history = useMemo<ThreadHistoryAdapter>(() => ({
    load: async () => ({ messages: [] }),
    append: async () => {},
    withFormat: (format) => {
      let threadItem: ReturnType<typeof aui.threads.item> = aui.threadListItem;
      const pin = () => {
        threadItem = aui.threads.item({ id: aui.threadListItem.getState().id });
      };
      return {
        pin,
        load: async () => {
          pin();
          const { remoteId } = threadItem.getState();
          if (!remoteId) return { messages: [] };
          const result = await request<{ headId: string | null; messages: StoredMessage[] }>(`/api/threads/${remoteId}/messages`);
          return { headId: result.headId ?? undefined, messages: result.messages.filter((m) => m.format === format.format).map((m) => format.decode({ id: m.id, parent_id: m.parentId, format: m.format, content: m.content as Parameters<typeof format.decode>[0]["content"] })) };
        },
        // Native begin-run and checkpoints are the only message writers.
        // A rejected local submission must never advance persisted history.
        append: async () => {},
        update: async () => {},
      };
    },
  }), [aui]);
  return useMemo(() => ({ history }), [history]);
}

/** The adapter identity is stable; initialization snapshots the current page. */
export function createThreadAdapter(getContext: () => { context: ChatPageContext; agentId: string | null }, pinnedThreadId?: string): RemoteThreadListAdapter {
  return {
    list: async (params) => {
      if (pinnedThreadId) return { threads: [metadata(await request<ThreadRow>(`/api/threads/${pinnedThreadId}`))] };
      const result = await request<{ threads: ThreadRow[]; nextCursor?: string }>(`/api/threads${params?.after ? `?after=${encodeURIComponent(params.after)}` : ""}`);
      return { threads: result.threads.map(metadata), nextCursor: result.nextCursor };
    },
    initialize: async (clientId) => {
      if (pinnedThreadId) throw new Error(i18n.t("automation:scheduled.openRunFirst"));
      const row = await request<ThreadRow>("/api/threads", { clientId, ...getContext() });
      return { remoteId: row.id };
    },
    fetch: async (id) => metadata(await request<ThreadRow>(`/api/threads/${id}`)),
    rename: async (id, title) => { await request(`/api/threads/${id}`, { title }, "PATCH"); },
    updateCustom: async (id, custom) => { await request(`/api/threads/${id}`, { custom }, "PATCH"); },
    // Required by assistant-ui's adapter interface; the product only supports deletion.
    archive: async () => { throw new Error(i18n.t("common:archiveUnsupported")); },
    unarchive: async () => { throw new Error(i18n.t("common:archiveUnsupported")); },
    delete: async (id) => { await request(`/api/threads/${id}`, undefined, "DELETE"); },
    generateTitle: async (id, messages) => createAssistantStream(async (controller) => {
      const first = messages.find((m) => m.role === "user");
      const title = first?.content.filter((p) => p.type === "text").map((p) => p.type === "text" ? p.text : "").join(" ").replace(/\s+/g, " ").trim().slice(0, 32) || i18n.t("common:newChatTitle");
      const result = await request<{ title: string }>(`/api/threads/${id}/title`, { title });
      controller.appendText(result.title);
    }),
    unstable_useAdapters: useThreadAdapters,
  };
}
