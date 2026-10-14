import { useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, AlignVerticalJustifyCenter, Rows3, Check, MoreHorizontal, Pencil, Save, Settings2, Star, Trash2, X } from "lucide-react";
import { BOARD_VIEW_CONFIG_SCHEMA, VIEW_NAME_SCHEMA, type BoardViewConfig, type TableView } from "@tabdo/shared";
import { Button } from "@tabdo/ui/components/button";
import { Checkbox } from "@tabdo/ui/components/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@tabdo/ui/components/toggle-group";
import { Input } from "@tabdo/ui/components/input";
import { Field, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { Popover, PopoverAnchor, PopoverContent } from "@tabdo/ui/components/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@tabdo/ui/components/dropdown-menu";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { ColumnTypeIcon } from "./ColumnTypeIcon";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { FullTable } from "@/types/table";
import { useTranslation } from "react-i18next";

export function ViewActions({ view, table, active, canDelete, menuOpen, onMenuOpenChange, onUpdated, onDeleted, settingsOnly = false, tableActions }: {
  tableActions?: ReactNode; settingsOnly?: boolean; view: TableView; table: FullTable; active: boolean; canDelete: boolean; menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void; onUpdated: (view: TableView) => void; onDeleted: () => void;
}) {
  const { t } = useTranslation(["table", "common"]);
  const [editor, setEditor] = useState<"rename" | "board" | null>(null);
  const [name, setName] = useState(view.name), [config, setConfig] = useState<BoardViewConfig>({});
  const baseline = useRef<BoardViewConfig>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  /* seed title column name (zh) */ const title = table.columns.find((column) => column.name === "标题") ?? table.columns.find((column) => column.type === "text");
  const properties = table.columns.filter((column) => column.id !== title?.id && !column.config.hidden);
  const selected = config.visibleColumnIds ?? properties.filter((column) => column.type === "person").map((column) => column.id);
  const ordered = [...selected.flatMap((id) => properties.find((column) => column.id === id) ?? []), ...properties.filter((column) => !selected.includes(column.id))];
  const open = (mode: "rename" | "board") => {
    setName(view.name); const initial = view.config as BoardViewConfig; baseline.current = { ...initial, density: initial.density ?? "comfortable", hideEmpty: initial.hideEmpty ?? true, statusColumnId: initial.statusColumnId ?? null, visibleColumnIds: initial.visibleColumnIds ?? properties.filter((column) => column.type === "person").map((column) => column.id) }; setConfig(baseline.current); setError(null); setEditor(mode); onMenuOpenChange(false);
  };
  const close = () => { if (!busy) { setEditor(null); setError(null); } };
  const save = async () => {
    if (busy) return;
    const validation = editor === "rename" ? VIEW_NAME_SCHEMA.safeParse(name) : BOARD_VIEW_CONFIG_SCHEMA.safeParse(config);
    if (!validation.success) { setError(validation.error.issues[0].message); return; }
    setBusy(true); setError(null);
    try { const updated = editor === "rename" ? await api.renameView(view.id, name.trim()) : await api.updateBoardView(view.id, Object.fromEntries(Object.entries(config).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(baseline.current[key as keyof BoardViewConfig]))) as BoardViewConfig); onUpdated(updated); setEditor(null); }
    catch (error) { setError(error instanceof Error ? error.message : t("saveFailed")); }
    finally { setBusy(false); }
  };
  const reorder = (id: string, delta: number) => {
    const next = [...selected], index = next.indexOf(id), target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setConfig({ ...config, visibleColumnIds: next });
  };
  return <Popover open={Boolean(editor)} onOpenChange={(open) => { if (!open) close(); }}>
    <PopoverAnchor asChild><span className="inline-flex">
      <>{settingsOnly ? <Button variant="outline" size="sm" data-testid="board-properties-trigger" onClick={() => open("board")}><Settings2 />{t("displaySettings")}</Button> : <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" data-testid={`view-menu-${view.id}`} aria-label={t("viewActionsNamed", { name: view.name })} title={t("viewActions")} className={cn("mr-0.5", !(active || menuOpen || editor) && "opacity-0 group-hover:opacity-100 focus:opacity-100")}><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" onCloseAutoFocus={(event) => { if (editor) event.preventDefault(); }}>
          <DropdownMenuLabel>{t("currentView", { name: view.name })}</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => open("rename")}><Pencil />{t("rename")}</DropdownMenuItem>
            <DropdownMenuItem disabled={view.isDefault || busy} onSelect={() => { setBusy(true); void api.setDefaultView(view.id).then(onUpdated).catch((error) => toast.error(error instanceof Error ? error.message : t("setDefaultViewFailed"))).finally(() => setBusy(false)); }}><Star />{view.isDefault ? t("defaultView") : t("setDefaultView")}{view.isDefault && <Check className="ml-auto" />}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" data-testid={`delete-view-${view.id}`} disabled={!canDelete || busy} title={canDelete ? t("deleteView") : t("keepOneView")} onSelect={onDeleted}><Trash2 />{t("deleteView")}</DropdownMenuItem>
          </DropdownMenuGroup>
          {tableActions && <><DropdownMenuSeparator /><DropdownMenuLabel>{t("tableDot", { name: table.name })}</DropdownMenuLabel>{tableActions}</>}
        </DropdownMenuContent>
      </DropdownMenu>}</>
    </span></PopoverAnchor>
    <PopoverContent align="end" className="w-80" data-testid={editor === "rename" ? "view-rename" : "board-properties"} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
      <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <FieldGroup>
          <p className="text-sm font-medium">{editor === "rename" ? t("renameView") : t("boardDisplaySettings")}</p>
          {editor === "rename" ? <Field data-invalid={Boolean(error)}><FieldLabel htmlFor={`view-name-${view.id}`}>{t("viewName")}</FieldLabel><Input id={`view-name-${view.id}`} autoFocus maxLength={80} value={name} aria-invalid={Boolean(error)} onChange={(event) => setName(event.target.value)} disabled={busy} /></Field> : <>
            <Field><FieldLabel>{t("density")}</FieldLabel><ToggleGroup type="single" variant="outline" className="justify-start" value={config.density ?? "comfortable"} disabled={busy} onValueChange={(density) => { if (density) setConfig({ ...config, density: density as BoardViewConfig["density"] }); }} aria-label={t("density")}><ToggleGroupItem value="comfortable" aria-label={t("densityComfortable")}><Rows3 className="size-4" />{t("densityComfortable")}</ToggleGroupItem><ToggleGroupItem value="compact" aria-label={t("densityCompact")}><AlignVerticalJustifyCenter className="size-4" />{t("densityCompact")}</ToggleGroupItem></ToggleGroup></Field>
            <Field><FieldLabel htmlFor={`board-group-${view.id}`}>{t("groupField")}</FieldLabel><Select value={config.statusColumnId ?? "auto"} onValueChange={(id) => setConfig({ ...config, statusColumnId: id === "auto" ? null : id })} disabled={busy}><SelectTrigger id={`board-group-${view.id}`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="auto">{t("autoSelectSelect")}</SelectItem>{table.columns.filter((column) => column.type === "select").map((column) => <SelectItem key={column.id} value={column.id}>{column.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field orientation="horizontal"><Checkbox id={`board-empty-${view.id}`} checked={config.hideEmpty ?? true} onCheckedChange={(checked) => setConfig({ ...config, hideEmpty: checked === true })} disabled={busy} /><FieldLabel htmlFor={`board-empty-${view.id}`}>{t("hideEmptyProps")}</FieldLabel></Field>
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {title && <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"><ColumnTypeIcon type={title.type} className="size-4 shrink-0" /><span className="flex-1 truncate">{title.name}</span><span className="text-xs text-muted-foreground">{t("alwaysShow")}</span></div>}
              {ordered.map((column) => <div key={column.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent" data-board-property={column.id}>
                <Checkbox id={`property-${view.id}-${column.id}`} aria-label={t("showProp", { name: column.name })} checked={selected.includes(column.id)} disabled={busy} onCheckedChange={(checked) => setConfig({ ...config, visibleColumnIds: checked ? [...selected, column.id] : selected.filter((id) => id !== column.id) })} />
                <ColumnTypeIcon type={column.type} className="size-3.5 shrink-0" /><label className="min-w-0 flex-1 truncate text-sm" htmlFor={`property-${view.id}-${column.id}`}>{column.name}</label>
                {selected.includes(column.id) && <><Button type="button" variant="ghost" size="icon" aria-label={t("moveUp", { name: column.name })} disabled={busy || selected.indexOf(column.id) === 0} onClick={() => reorder(column.id, -1)}><ArrowUp /></Button><Button type="button" variant="ghost" size="icon" aria-label={t("moveDown", { name: column.name })} disabled={busy || selected.indexOf(column.id) === selected.length - 1} onClick={() => reorder(column.id, 1)}><ArrowDown /></Button></>}
              </div>)}
            </div>
          </>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={close}><X />{t("cancel")}</Button><Button type="submit" disabled={busy}><Save />{busy ? t("saving") : t("save")}</Button></div>
        </FieldGroup>
      </form>
    </PopoverContent>
  </Popover>;
}

export function BoardViewSettings({ view, table, onUpdated }: { view: TableView; table: FullTable; onUpdated: (view: TableView) => void }) {
  return <ViewActions view={view} table={table} onUpdated={onUpdated} settingsOnly active={false} canDelete={false} menuOpen={false} onMenuOpenChange={() => {}} onDeleted={() => {}} />;
}
