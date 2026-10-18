/** One immutable scope per document. Switching navigates after server validation. */
let workspaceId: string | undefined;
let identity = "";
export function setWorkspaceScope(id: string, owner: string) { workspaceId = id; identity = owner; }
export function workspaceHeaders(): Record<string, string> { return workspaceId ? { "X-Workspace-Id": workspaceId } : {}; }
export function workspaceCacheKey() { return `${identity}:${workspaceId ?? ""}`; }
export function workspaceUrl(path: string) {
  const url = new URL(path, window.location.origin);
  if (workspaceId) url.searchParams.set("workspace", workspaceId);
  return url.pathname + url.search;
}

const leaveGuards = new Set<() => Promise<boolean>>();
let unloadApproved = false;
export function registerWorkspaceLeaveGuard(guard: () => Promise<boolean>) {
  leaveGuards.add(guard); return () => { leaveGuards.delete(guard); };
}
export async function prepareWorkspaceLeave() {
  for (const guard of leaveGuards) if (!await guard()) return false;
  unloadApproved = true; return true;
}
export function workspaceUnloadApproved() { return unloadApproved; }
