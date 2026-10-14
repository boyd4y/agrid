import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { useAui, useAuiEvent, useAuiState } from "@assistant-ui/react";
import {
  type ChatResourceKey,
  getLastThreadId,
  readThreadResourceKey,
  setLastThreadId,
  setStoredThreadResource,
  threadResourceCustomUpdate,
} from "@/lib/chat-resource";
import i18n from "@/i18n";

type Props = {
  resourceKey: ChatResourceKey;
  remoteThreadId?: string | null;
};

function isEmptyUnboundTitle(title: string | undefined): boolean {
  if (!title) return true;
  const zh = i18n.t("chat:newChat", { lng: "zh-CN" });
  const en = i18n.t("chat:newChat", { lng: "en" });
  return title === zh || title === en || title === "新对话" || title === "New Chat";
}

/**
 * Keeps the open thread bound to `resourceKey`:
 * - stamps custom.resourceKey on the active thread
 * - on resource change: open last / most-recent scoped session, or new
 * - unbound threads stay hidden from scoped lists (not auto-attached to every table)
 */
export function ResourceScopedThreads({ resourceKey, remoteThreadId }: Props) {
  const aui = useAui();
  const navigate = useNavigate();
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const isLoading = useAuiState((s) => s.threads.isLoading);
  const appliedKeyRef = useRef<string | null>(null);
  const openedRemoteRef = useRef<string | null>(null);
  const switchQueue = useRef(Promise.resolve());
  const [linkRevision, setLinkRevision] = useState(0);

  const stampThread = (threadId: string) => {
    if (!threadId) return;
    try {
      const methods = aui.threads.item({ id: threadId });
      const state = methods.getState();
      const existing = readThreadResourceKey(state);
      // An unsaved draft can be reused by switchToNewThread across resources.
      // Persisted conversations retain their original binding.
      if (state.status !== "new" && existing && existing !== resourceKey) return;

      const custom = threadResourceCustomUpdate(state, resourceKey);
      if (custom) methods.updateCustom(custom);
      setStoredThreadResource(threadId, resourceKey);
      setLastThreadId(resourceKey, state.remoteId ?? threadId);
    } catch (e) {
      console.warn("stamp thread resourceKey", e);
    }
  };

  useEffect(() => {
    if (!remoteThreadId || openedRemoteRef.current === remoteThreadId) return;
    let cancelled = false;
    // Serialize SDK switches so rapid navigation cannot apply an older selection last.
    const open = switchQueue.current.then(async () => {
      if (cancelled) return;
      const thread = await api.getChatThread(remoteThreadId);
      if (cancelled) return;
      if (thread.kind === "scheduled_task" && thread.scheduledTaskId && resourceKey !== `schedule:${thread.scheduledTaskId}`) {
        navigate(`/app/schedules/${thread.scheduledTaskId}/runs/${thread.id}`, { replace: true }); return;
      }
      await aui.threads.switchToThread(remoteThreadId);
      if (cancelled) return;
      openedRemoteRef.current = remoteThreadId;
      appliedKeyRef.current = resourceKey;
      setLastThreadId(resourceKey, remoteThreadId);
      setLinkRevision(value => value + 1);
    }).catch(error => {
      if (cancelled) return;
      openedRemoteRef.current = remoteThreadId;
      appliedKeyRef.current = null;
      setLinkRevision(value => value + 1);
      toast.error(error instanceof Error ? error.message : i18n.t("errors:loadFailed"));
    });
    switchQueue.current = open;
    return () => { cancelled = true; };
  }, [remoteThreadId, resourceKey, aui, navigate]);

  // Switch pool when resourceKey changes (after thread list is ready)
  useEffect(() => {
    if (isLoading) return;
    if (remoteThreadId && openedRemoteRef.current !== remoteThreadId) return;
    if (appliedKeyRef.current === resourceKey) return;

    const scoped = threadItems.filter((t) => {
      return readThreadResourceKey(t) === resourceKey;
    });

    const main = threadItems.find((t) => t.id === mainThreadId);
    const currentKey = main ? readThreadResourceKey(main) : null;

    if (currentKey === resourceKey) {
      appliedKeyRef.current = resourceKey;
      setLastThreadId(resourceKey, mainThreadId);
      return;
    }

    const lastId = getLastThreadId(resourceKey);
    const byLast = lastId ? scoped.find((t) => t.id === lastId || t.remoteId === lastId) : undefined;
    const sorted = [...scoped].sort((a, b) => {
      const ta = a.lastMessageAt?.getTime() ?? 0;
      const tb = b.lastMessageAt?.getTime() ?? 0;
      return tb - ta;
    });
    const target = byLast ?? sorted[0];

    if (target) {
      appliedKeyRef.current = resourceKey;
      if (target.id !== mainThreadId) {
        aui.threads.switchToThread(target.id);
      }
      setLastThreadId(resourceKey, target.id);
      return;
    }

    // No scoped session: reuse empty unbound main, else create new
    const mainUnbound = main && !readThreadResourceKey(main);
    const mainLooksEmpty =
      !!mainUnbound && !main.lastMessageAt && isEmptyUnboundTitle(main.title);

    appliedKeyRef.current = resourceKey;
    if (mainLooksEmpty && main) {
      stampThread(main.id);
    } else {
      aui.threads.switchToNewThread();
    }
    // stamp of new thread happens via mainThreadId / selection effects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceKey, remoteThreadId, linkRevision, isLoading, threadItems, mainThreadId, aui]);

  // Stamp + remember whenever main thread belongs (or can belong) to this pool
  useEffect(() => {
    if (isLoading || !mainThreadId) return;
    if (appliedKeyRef.current !== resourceKey) return;

    const main = threadItems.find((t) => t.id === mainThreadId);
    const key = main ? readThreadResourceKey(main) : null;
    if (key && key !== resourceKey) return;
    stampThread(mainThreadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainThreadId, resourceKey, isLoading, threadItems]);

  useAuiEvent("threads.selectionChanged", ({ threadId }) => {
    if (appliedKeyRef.current !== resourceKey) return;
    if (!threadId) return;
    stampThread(threadId);
  });

  return null;
}
