import i18n from "@/i18n";
/** Resource-scoped chat sessions (table / workspace / etc.). */

const LAST_THREAD_KEY = "tabdo.chat.lastThreadByResource";
const LAST_THREAD_KEY_LEGACY = "agrid.chat.lastThreadByResource";
const THREAD_RESOURCE_KEY = "tabdo.chat.threadResourceMap";
const THREAD_RESOURCE_KEY_LEGACY = "agrid.chat.threadResourceMap";

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
  if (key.startsWith("report:")) return i18n.t("chat:resource.report");
  if (key.startsWith("table:")) return i18n.t("chat:resource.table");
  if (key === "workspace") return i18n.t("chat:resource.workspace");
  const keys = ["tables", "automations", "reports", "skills", "agents", "members", "settings"] as const;
  if ((keys as readonly string[]).includes(key)) return i18n.t(`chat:resource.${key}`);
  return i18n.t("chat:resource.generic");
}

function parseJsonMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
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

function readJsonMap(storageKey: string, legacyKey?: string): Record<string, string> {
  try {
    const next = parseJsonMap(localStorage.getItem(storageKey));
    if (Object.keys(next).length > 0 || localStorage.getItem(storageKey) !== null) {
      return next;
    }
    if (!legacyKey) return {};
    const prev = parseJsonMap(localStorage.getItem(legacyKey));
    if (Object.keys(prev).length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(prev));
      localStorage.removeItem(legacyKey);
    }
    return prev;
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
  return readJsonMap(LAST_THREAD_KEY, LAST_THREAD_KEY_LEGACY)[resourceKey] ?? null;
}

export function setLastThreadId(resourceKey: ChatResourceKey, threadId: string) {
  const map = readJsonMap(LAST_THREAD_KEY, LAST_THREAD_KEY_LEGACY);
  map[resourceKey] = threadId;
  writeJsonMap(LAST_THREAD_KEY, map);
}

/** Fallback map when assistant-ui custom metadata is missing (e.g. race before stamp). */
export function getStoredThreadResource(threadId: string): string | null {
  return readJsonMap(THREAD_RESOURCE_KEY, THREAD_RESOURCE_KEY_LEGACY)[threadId] ?? null;
}

export function setStoredThreadResource(threadId: string, resourceKey: ChatResourceKey) {
  const map = readJsonMap(THREAD_RESOURCE_KEY, THREAD_RESOURCE_KEY_LEGACY);
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
  if (diffMs < 60_000) return i18n.t("chat:relative.justNow");
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return i18n.t("chat:relative.minutesAgo", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return i18n.t("chat:relative.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return i18n.t("chat:relative.daysAgo", { n: days });
  const locale = i18n.language?.startsWith("en") ? "en" : "zh-CN";
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}
