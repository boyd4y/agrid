/** Resource-scoped chat sessions (table / workspace / etc.). */

const LAST_THREAD_KEY = "agrid.chat.lastThreadByResource";
const THREAD_RESOURCE_KEY = "agrid.chat.threadResourceMap";

export type ChatResourceKey = string;

export function chatResourceKey(opts: {
  tableId?: string | null;
  /** Explicit override, e.g. "automations" or "workspace" */
  resourceKey?: string | null;
}): ChatResourceKey {
  if (opts.resourceKey && opts.resourceKey.trim()) {
    return opts.resourceKey.trim();
  }
  if (opts.tableId) return `table:${opts.tableId}`;
  return "workspace";
}

export function resourceKeyLabel(key: ChatResourceKey): string {
  if (key.startsWith("table:")) return "与当前表格的对话";
  if (key === "workspace") return "工作区对话";
  return "当前资源的对话";
}

function readJsonMap(storageKey: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeJsonMap(storageKey: string, map: Record<string, string>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}

export function getLastThreadId(resourceKey: ChatResourceKey): string | null {
  return readJsonMap(LAST_THREAD_KEY)[resourceKey] ?? null;
}

export function setLastThreadId(resourceKey: ChatResourceKey, threadId: string) {
  const map = readJsonMap(LAST_THREAD_KEY);
  map[resourceKey] = threadId;
  writeJsonMap(LAST_THREAD_KEY, map);
}

/** Fallback map when assistant-ui custom metadata is missing (e.g. race before stamp). */
export function getStoredThreadResource(threadId: string): string | null {
  return readJsonMap(THREAD_RESOURCE_KEY)[threadId] ?? null;
}

export function setStoredThreadResource(threadId: string, resourceKey: ChatResourceKey) {
  const map = readJsonMap(THREAD_RESOURCE_KEY);
  map[threadId] = resourceKey;
  writeJsonMap(THREAD_RESOURCE_KEY, map);
}

export function readThreadResourceKey(thread: {
  id: string;
  custom?: Record<string, unknown> | undefined;
}): string | null {
  const fromCustom = thread.custom?.resourceKey;
  if (typeof fromCustom === "string" && fromCustom) return fromCustom;
  return getStoredThreadResource(thread.id);
}

/** Drafts cannot update assistant-ui metadata; initialized threads may backfill it. */
export function threadResourceCustomUpdate(thread: {
  id: string;
  status: string;
  custom?: Record<string, unknown>;
}, resourceKey: ChatResourceKey): Record<string, unknown> | null {
  if (thread.status === "new") return null;
  const existing = readThreadResourceKey(thread);
  if (existing && existing !== resourceKey) return null;
  if (thread.custom?.resourceKey === resourceKey) return null;
  return { ...(thread.custom ?? {}), resourceKey };
}

export function formatRelativeTime(date: Date | undefined, now = Date.now()): string {
  if (!date) return "";
  const diffMs = now - date.getTime();
  if (!Number.isFinite(diffMs)) return "";
  if (diffMs < 60_000) return "刚刚";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}
