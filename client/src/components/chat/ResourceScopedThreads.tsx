import { useEffect, useRef } from "react";
import { useAui, useAuiEvent, useAuiState } from "@assistant-ui/react";
import {
  type ChatResourceKey,
  getLastThreadId,
  readThreadResourceKey,
  setLastThreadId,
  setStoredThreadResource,
} from "@/lib/chat-resource";

type Props = {
  resourceKey: ChatResourceKey;
};

function mergeResourceCustom(
  custom: Record<string, unknown> | undefined,
  resourceKey: ChatResourceKey
): Record<string, unknown> {
  return { ...(custom ?? {}), resourceKey };
}

function isEmptyUnboundTitle(title: string | undefined): boolean {
  return !title || title === "新对话" || title === "New Chat";
}

/**
 * Keeps the open thread bound to `resourceKey`:
 * - stamps custom.resourceKey on the active thread
 * - on resource change: open last / most-recent scoped session, or new
 * - unbound threads stay hidden from scoped lists (not auto-attached to every table)
 */
export function ResourceScopedThreads({ resourceKey }: Props) {
  const aui = useAui();
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const isLoading = useAuiState((s) => s.threads.isLoading);
  const appliedKeyRef = useRef<string | null>(null);

  const stampThread = (threadId: string) => {
    if (!threadId) return;
    try {
      const methods = aui.threads.item({ id: threadId });
      const state = methods.getState();
      const existing = readThreadResourceKey(state);
      // Never overwrite a different resource binding
      if (existing && existing !== resourceKey) return;

      if (existing !== resourceKey) {
        methods.updateCustom(mergeResourceCustom(state.custom, resourceKey));
      }
      setStoredThreadResource(threadId, resourceKey);
      setLastThreadId(resourceKey, threadId);
    } catch (e) {
      console.warn("stamp thread resourceKey", e);
    }
  };

  // Switch pool when resourceKey changes (after thread list is ready)
  useEffect(() => {
    if (isLoading) return;
    if (appliedKeyRef.current === resourceKey) return;

    const scoped = threadItems.filter((t) => {
      if (t.status === "archived") return false;
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
    const byLast = lastId ? scoped.find((t) => t.id === lastId) : undefined;
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
  }, [resourceKey, isLoading, threadItems, mainThreadId, aui]);

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
    try {
      const item = aui.threads.item({ id: threadId }).getState();
      const key = readThreadResourceKey(item);
      if (key && key !== resourceKey) return;
      aui.threads
        .item({ id: threadId })
        .updateCustom(mergeResourceCustom(item.custom, resourceKey));
      setStoredThreadResource(threadId, resourceKey);
      setLastThreadId(resourceKey, threadId);
    } catch (e) {
      console.warn("selection stamp resourceKey", e);
    }
  });

  return null;
}
