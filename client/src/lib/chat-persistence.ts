import { useMemo } from "react";
import { useAui, type RemoteThreadListAdapter, type ThreadHistoryAdapter } from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import i18n from "@/i18n";
import type { HttpChatTransportInitOptions, UIMessage } from "ai";

export type ChatPageContext = {
  page: "ai" | "tables" | "table" | "automations" | "reports" | "skills" | "agents" | "members" | "settings";
  tableId: string | null;
  reportId?: string | null;
};
type ThreadRow = { id: string; title: string | null; status: "regular"; custom: Record<string, unknown>; lastMessageAt: string | null };
type StoredMessage = { id: string; parentId: string | null; format: string; content: unknown };
async function request<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(url, body === undefined && method === "POST" ? undefined : { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
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

/** Native session history stays on the server; the UI history remains intact. */
export const prepareNativeChatRequest: NonNullable<HttpChatTransportInitOptions<UIMessage>["prepareSendMessagesRequest"]> = ({ id, messages, body, trigger, messageId, requestMetadata }) => {
  const latestUser = [...messages].reverse().find(message => message.role === "user");
  return { body: { ...body, id, messages: latestUser ? [latestUser] : [], trigger, messageId, metadata: requestMetadata } };
};

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
