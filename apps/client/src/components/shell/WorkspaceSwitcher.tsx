import { NiGrid, NiChevronRight } from "@/components/icons";
import { toast } from "sonner";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Plus } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from "@tabdo/ui/components/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@tabdo/ui/components/dialog";
import { Field, FieldLabel, FieldGroup } from "@tabdo/ui/components/field";
import { Input } from "@tabdo/ui/components/input";
import { useWorkspace } from "@/context/WorkspaceContext";
import { cn } from "@/lib/utils";

export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation("app");
  const { current, workspaces, switchWorkspace, createWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false), [name, setName] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  async function run(operation: () => Promise<void>) {
    setBusy(true); setError(undefined);
    try { await operation(); } catch { const message = t("workspaces.operationFailed"); setError(message); if (!open) toast.error(message); setBusy(false); }
  }
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" disabled={busy} aria-busy={busy} className={cn("w-full justify-between", collapsed && "px-0")} aria-label={t("workspaces.switch", { name: current.name })} title={current.name} data-testid="workspace-switcher">
        <NiGrid />{!collapsed && <><span className="flex-1 truncate text-left">{busy ? t("workspaces.switching") : current.name}</span><NiChevronRight className="rotate-90" /></>}
        {busy && <span role="status" className="sr-only">{t("workspaces.switching")}</span>}
      </Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-1rem)]">
        <DropdownMenuLabel>{t("workspaces.enterpriseWorkspaces")}</DropdownMenuLabel>
        <DropdownMenuGroup>{workspaces.map(item => <DropdownMenuItem key={item.id} onSelect={() => { if (item.id !== current.id) void run(() => switchWorkspace(item.id)); }}>
          <span className="flex-1 truncate">{item.name}</span>{item.id === current.id && <Check aria-label={t("workspaces.current")} />}
        </DropdownMenuItem>)}</DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup><DropdownMenuItem onSelect={() => { setName(""); setError(undefined); setOpen(true); }}><Plus />{t("workspaces.create")}</DropdownMenuItem></DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}><DialogContent>
      <DialogHeader><DialogTitle>{t("workspaces.create")}</DialogTitle><DialogDescription>{t("workspaces.createDescription")}</DialogDescription></DialogHeader>
      <form noValidate onSubmit={event => { event.preventDefault(); void run(() => createWorkspace(name.trim())); }} className="flex flex-col gap-4">
        <FieldGroup><Field data-invalid={Boolean(error)}><FieldLabel htmlFor="workspace-name">{t("workspaces.name")}</FieldLabel><Input id="workspace-name" autoFocus value={name} maxLength={100} required disabled={busy} aria-invalid={Boolean(error)} onChange={event => setName(event.target.value)} />{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</Field></FieldGroup>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>{t("workspaces.cancel")}</Button><Button type="submit" disabled={busy || !name.trim()}>{t(busy ? "workspaces.creating" : "workspaces.createAndEnter")}</Button></div>
      </form>
    </DialogContent></Dialog>
  </>;
}
