/** Successful writes and explicit refreshes share one coalesced, table-scoped signal. */
export type DataChange = { tableIds: string[]; all: boolean };
const listeners = new Set<(change: DataChange) => void>();
const pending = new Set<string>();
let all = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export function notifyDataChanged(tableId?: string | null) {
  if (typeof tableId === "string" && tableId) pending.add(tableId);
  else all = true;
  if (timer) return;
  timer = setTimeout(() => {
    const change = { tableIds: [...pending], all };
    pending.clear();
    all = false;
    timer = undefined;
    for (const listener of listeners) listener(change);
  }, 100);
}

export function subscribeDataChanges(listener: (change: DataChange) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const owners = new Map<string, string>();
function rememberOwners(value: unknown, tableId?: string) {
  if (Array.isArray(value)) { for (const item of value) rememberOwners(item, tableId); return; }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const owner = typeof record.tableId === "string" ? record.tableId : tableId;
  if (owner && typeof record.id === "string") {
    owners.delete(record.id);
    owners.set(record.id, owner);
    if (owners.size > 10_000) owners.delete(owners.keys().next().value!);
  }
  for (const key of ["rows", "columns", "result"]) if (record[key]) rememberOwners(record[key], owner);
}

const writeCommands = new Set([
  "setRelation", "addRelation", "removeRelation", "updateCell", "updateCells", "addRow", "deleteRow", "addColumn", "deleteColumn", "updateColumn",
  "reorderColumns", "createView", "updateView", "renameView", "setDefaultView", "updateBoardView", "createCalendarView", "updateCalendarView", "deleteView", "createFormView", "updateFormView",
  "setFormFields", "setFormSections", "reorderFormFields", "createGridView",
  "createBoardView", "setFormTheme", "setFormLayout", "setFormFieldSettings", "setFormChrome",
]);

/** POST queries are deliberately excluded. Missing ownership falls back to a full refresh. */
export function announceApiWrite(url: string, init: RequestInit | undefined, result: unknown) {
  const method = init?.method?.toUpperCase() ?? "GET";
  const data = result as { tableId?: string; id?: string; affectedTableIds?: string[]; result?: { tableId?: string; affectedTableIds?: string[] } };
  const tableId = url.match(/^\/api\/tables\/([^/?]+)/)?.[1];
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  rememberOwners(result, tableId ?? body.input?.tableId ?? (url === "/api/tables" && !Array.isArray(result) ? data.id : undefined));
  if (method === "GET") return;
  if (/^\/api\/sites(?:\/|$)/.test(url)) { if (!url.endsWith("/preview")) notifyDataChanged(); return; }
  if (url === "/api/commands") {
    if (!writeCommands.has(body.command)) return;
    if(data.result?.affectedTableIds){for(const id of data.result.affectedTableIds)notifyDataChanged(id);return;}
    notifyDataChanged(body.input?.tableId ?? data.result?.tableId ?? owners.get(body.input?.viewId));
    return;
  }
  if (/\/rows\/query(?:\?|$)/.test(url)) return;
  if (/^\/api\/reports(?:\/|$)/.test(url)) { if (!/^\/api\/reports\/preview(?:-page)?$/.test(url)) notifyDataChanged(data.tableId); return; }
  if (!/^\/api\/(tables|rows|columns|automations|automation-runs)(\/|$)/.test(url)) return;
  if(data.affectedTableIds){for(const id of data.affectedTableIds)notifyDataChanged(id);return;}
  const resourceId = url.match(/^\/api\/(?:rows|columns|automations|automation-runs)\/([^/?]+)/)?.[1];
  notifyDataChanged(tableId ?? data.tableId ?? (url === "/api/tables" ? data.id : undefined) ?? (resourceId ? owners.get(resourceId) : undefined));
}
