import { useMemo } from "react";
import { useAui, type RemoteThreadListAdapter, type ThreadHistoryAdapter } from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";

export type ChatPageContext = {
  page: "ai" | "tables" | "table" | "automations" | "reports" | "skills" | "agents" | "members" | "settings";
  tableId: string | null;
  reportId?: string | null;
};
type ThreadRow = { id: string; title: string | null; status: "regular"; custom: Record<string, unknown>; lastMessageAt: string | null };
type StoredMessage = { id: string; parentId: string | null; format: string; content: unknown };
async function request<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(url, body === undefined && method === "POST" ? undefined : { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`无法保存或读取对话 (${response.status})：${await response.text()}`);
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
      const save = async (item: Parameters<typeof format.encode>[0]) => {
        const { remoteId } = await threadItem.initialize();
        await request(`/api/threads/${remoteId}/messages`, {
          id: format.getId(item.message), parentId: item.parentId, format: format.format, content: format.encode(item),
        });
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
        append: save,
        update: (item) => save(item),
      };
    },
  }), [aui]);
  return useMemo(() => ({ history }), [history]);
}

/** The adapter identity is stable; initialization snapshots the current page. */
export function createThreadAdapter(getContext: () => { context: ChatPageContext; agentId: string | null }): RemoteThreadListAdapter {
  return {
    list: async (params) => {
      const result = await request<{ threads: ThreadRow[]; nextCursor?: string }>(`/api/threads${params?.after ? `?after=${encodeURIComponent(params.after)}` : ""}`);
      return { threads: result.threads.map(metadata), nextCursor: result.nextCursor };
    },
    initialize: async (clientId) => {
      const row = await request<ThreadRow>("/api/threads", { clientId, ...getContext() });
      return { remoteId: row.id };
    },
    fetch: async (id) => metadata(await request<ThreadRow>(`/api/threads/${id}`)),
    rename: async (id, title) => { await request(`/api/threads/${id}`, { title }, "PATCH"); },
    updateCustom: async (id, custom) => { await request(`/api/threads/${id}`, { custom }, "PATCH"); },
    // Required by assistant-ui's adapter interface; the product only supports deletion.
    archive: async () => { throw new Error("不支持归档对话"); },
    unarchive: async () => { throw new Error("不支持归档对话"); },
    delete: async (id) => { await request(`/api/threads/${id}`, undefined, "DELETE"); },
    generateTitle: async (id, messages) => createAssistantStream(async (controller) => {
      const first = messages.find((m) => m.role === "user");
      const title = first?.content.filter((p) => p.type === "text").map((p) => p.type === "text" ? p.text : "").join(" ").replace(/\s+/g, " ").trim().slice(0, 32) || "新对话";
      const result = await request<{ title: string }>(`/api/threads/${id}/title`, { title });
      controller.appendText(result.title);
    }),
    unstable_useAdapters: useThreadAdapters,
  };
}
