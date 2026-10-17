import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import type { Workspace } from "@tabdo/shared";
import { setWorkspaceScope } from "@/lib/workspace-scope";
import { Button } from "@tabdo/ui/components/button";

type Workspaces = { current: Workspace; workspaces: Workspace[]; switchWorkspace(id: string): Promise<void>; createWorkspace(name: string): Promise<void> };
const WorkspaceContext = createContext<Workspaces | null>(null);
export function useWorkspace() { const context = useContext(WorkspaceContext); if (!context) throw new Error("Workspace provider missing"); return context; }
async function command<T>(name: string, input: unknown = {}, workspaceId?: string): Promise<T> {
  const response = await fetch("/api/commands", { method: "POST", credentials: "include", headers: {
    "Content-Type": "application/json", ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
  }, body: JSON.stringify({ command: name, input }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error);
  return value.result;
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, session } = useAuth();
  const { t } = useTranslation("app");
  const location = useLocation(), navigate = useNavigate();
  const owner = `${user?.id}:${session?.activeOrganizationId}`;
  const [state, setState] = useState<{ owner: string; current: Workspace; workspaces: Workspace[] }>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [recovering, setRecovering] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    if (!user?.id || !session?.activeOrganizationId) return;
    const key = `tabdo.workspace.${owner}`;
    void command<Workspace[]>("listWorkspaces").then(workspaces => {
      if (cancelled) return;
      const explicit = new URLSearchParams(window.location.search).get("workspace");
      let remembered: string | null = null;
      try { remembered = sessionStorage.getItem(key) ?? localStorage.getItem(key); } catch { /* Storage may be disabled. */ }
      const current = workspaces.find(item => item.id === (explicit ?? remembered)) ?? (!explicit ? workspaces.find(item => item.isDefault) : undefined);
      if (!current) throw new Error(t("workspaces.unavailable"));
      setWorkspaceScope(current.id, owner);
      try { sessionStorage.setItem(key, current.id); localStorage.setItem(key, current.id); } catch { /* Selection still lives in the URL. */ }
      setState({ owner, current, workspaces });
    }).catch(() => { if (!cancelled) setError(t("workspaces.unavailable")); });
    return () => { cancelled = true; };
  }, [owner, retry, user?.id, session?.activeOrganizationId, t]);
  const explicit = new URLSearchParams(location.search).get("workspace");
  const ready = state?.owner === owner && (!explicit || explicit === state.current.id);
  useEffect(() => {
    if (!state || state.owner !== owner) return;
    if (explicit && explicit !== state.current.id) { window.location.reload(); return; }
    if (!explicit) {
      const params = new URLSearchParams(location.search); params.set("workspace", state.current.id);
      navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true });
    }
  }, [state, owner, explicit, location.pathname, location.search, location.hash, navigate]);
  async function openDefaultWorkspace() {
    setRecovering(true);
    try {
      // Omitting the selector resolves the enterprise default on the server,
      // independently of this tab's URL and remembered selection.
      const { workspace } = await command<{ workspace: Workspace }>("getWorkspace");
      window.location.assign(`/app?workspace=${encodeURIComponent(workspace.id)}`);
    } catch {
      setError(t("workspaces.unavailable"));
      setRecovering(false);
    }
  }
  if (error) return <div className="flex h-full flex-col items-center justify-center gap-4" role="alert" aria-busy={recovering}><p>{error}</p><Button disabled={recovering} onClick={() => setRetry(value => value + 1)}>{t("workspaces.retry")}</Button><Button variant="ghost" disabled={recovering} onClick={() => void openDefaultWorkspace()}>{t(recovering ? "workspaces.loading" : "workspaces.openDefault")}</Button></div>;
  if (!ready || !state) return <div className="flex h-full items-center justify-center text-muted-foreground" role="status">{t("workspaces.loading")}</div>;
  async function switchWorkspace(id: string) {
    await command("getWorkspace", {}, id);
    // A new document removes stale responses, streams, caches and unsaved drafts together.
    // Accepted server runs continue independently of the browser stream.
    window.location.assign(`/app?workspace=${encodeURIComponent(id)}`);
  }
  return <WorkspaceContext.Provider value={{ current: state.current, workspaces: state.workspaces, switchWorkspace,
    async createWorkspace(name) { const created = await command<Workspace>("createWorkspace", { name }, state.current.id); await switchWorkspace(created.id); },
  }}>{children}</WorkspaceContext.Provider>;
}
