import { BlogEditor } from "@/components/sites/BlogEditor";
import { BlogCreateDialog } from "@/components/sites/BlogCreateDialog";
import { CalendarViewSettings } from "@/components/table/CalendarViewSettings";
import { TableCalendarView } from "@/components/table/TableCalendarView";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Columns3,
  CalendarDays,
  FileInput,
  Globe,
  LayoutGrid,
  Loader2,
  Star,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { Input } from "@tabdo/ui/components/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@tabdo/ui/components/dropdown-menu";
import { DataTable } from "@/components/table/DataTable";
import { TableIconPicker } from "@/components/table/TableIcon";
import { TableActions } from "@/components/table/TableActions";
import { BoardViewSettings, ViewActions } from "@/components/table/ViewActions";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { FormDesigner } from "@/components/form/FormDesigner";
import { api } from "@/lib/api";
import type { FullTable } from "@/types/table";
import type { ResolvedFormView, TableView } from "@tabdo/shared";
import { Tabs, TabsList, TabsTrigger } from "@tabdo/ui/components/tabs";
import type { AppOutletContext } from "@/layouts/AppShell";
import { useAppShell } from "@/context/AppShellContext";
import { useTranslation } from "react-i18next";

function viewIcon(type: string) {
  if (type === "site") return Globe;
  if (type === "calendar") return CalendarDays;
  if (type === "board") return LayoutGrid;
  if (type === "form") return FileInput;
  return Columns3;
}

function viewLabel(type: string, name: string, t: (k: string) => string) {
  return name || (type === "calendar" ? t("calendarView.name") : type === "board" ? t("board") : type === "form" ? t("form") : t("grid"));
}

export function TableDetailPage() {
  const { t } = useTranslation("table");
  const { tableId } = useParams<{ tableId: string }>();
  const [viewParams] = useSearchParams();
  const { setTables, getTableRefreshToken, notifyTableMutated, updateTableMetadata } =
    useOutletContext<AppOutletContext>();
  const tableRefreshToken = getTableRefreshToken(tableId);
  const [deletingView, setDeletingView] = useState<TableView | null>(null);
  const { setActiveTableId } = useAppShell();
  const [table, setTable] = useState<FullTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [views, setViews] = useState<TableView[]>([]);
  const [siteCreate, setSiteCreate] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(viewParams.get("view"));
  const [formView, setFormView] = useState<ResolvedFormView | null>(null);
  const [viewsLoading, setViewsLoading] = useState(false);
  const [addingCalendar, setAddingCalendar] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [menuViewId, setMenuViewId] = useState<string | null>(null);
  const tableRequest = useRef(0);
  const viewsRequest = useRef(0);

  const activeView = useMemo(
    () => views.find((v) => v.id === activeViewId) ?? null,
    [views, activeViewId]
  );

  const load = useCallback(async () => {
    if (!tableId) return;
    const version = ++tableRequest.current;
    try {
      const full = await api.getTable(tableId);
      if (version !== tableRequest.current) return;
      setTable({ ...full, rows: full.rows ?? [], rowCount: full.rowCount ?? 0 });
      setError(null);
    } catch (e) {
      if (version === tableRequest.current) setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      if (version === tableRequest.current) setLoading(false);
    }
  }, [tableId]);

  const loadViews = useCallback(async () => {
    if (!tableId) return;
    const version = ++viewsRequest.current;
    setViewsLoading(true);
    try {
      let list = await api.listViews(tableId);
      if (version !== viewsRequest.current) return;
      // Create an initial view only after the current request confirms none exist.
      if (!list.length) {
        const grid = await api.createGridView(tableId, t("grid"));
        list = await api.listViews(tableId);
      }
      if (version !== viewsRequest.current) return;
      setViews(list);
      setActiveViewId((prev) => {
        if (prev && list.some((v) => v.id === prev)) return prev;
        return list.find((v) => v.isDefault)?.id ?? list[0]?.id ?? null;
      });
    } catch (e) {
      if (version === viewsRequest.current) setError(e instanceof Error ? e.message : t("loadViewsFailed"));
    } finally {
      if (version === viewsRequest.current) setViewsLoading(false);
    }
  }, [tableId]);

  useEffect(() => {
    setLoading(true);
    setActiveViewId(null);
    setViews([]);
    setMenuViewId(null);
    setActiveTableId(tableId ?? null);
    void load();
    void loadViews();
    return () => { tableRequest.current++; viewsRequest.current++; };
  }, [tableId, load, loadViews, setActiveTableId]);

  useEffect(() => {
    if (tableRefreshToken > 0) { void load(); void loadViews(); }
  }, [tableRefreshToken, load, loadViews]);

  useEffect(() => {
    if (!activeView || activeView.type !== "form") {
      setFormView(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const full = await api.getView(activeView.id);
        if (!cancelled) setFormView(full as ResolvedFormView);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : t("loadFormFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeView?.id, activeView?.type, tableRefreshToken]);

  const renameTable = async (name: string) => {
    if (!table || !name.trim() || name === table.name) return;
    try {
      const updated = await api.patchTable(table.id, { name: name.trim() });
      setTable({ ...table, ...updated });
      setTables((prev) =>
        prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("renameFailed"));
    }
  };

  const addView = async (type: "grid" | "board" | "form") => {
    if (!tableId) return;
    setAddOpen(false);
    try {
      let created: TableView;
      if (type === "grid") {
        created = await api.createGridView(tableId, t("gridN", { n: views.filter((v) => v.type === "grid").length + 1 }));
      } else if (type === "board") {
        created = await api.createBoardView(tableId, { name: t("board") });
      } else {
        created = await api.createFormView(tableId, {
          name: t("formDefaults.name"),
          title: t("formDefaults.title"),
          description: t("formDefaults.description"),
          submitLabel: t("formDefaults.submitLabel"),
          successMessage: t("formDefaults.successMessage"),
        });
        // Apply Typeform defaults after create
        await api.setFormTheme(created.id, "sunset");
        created = await api.setFormLayout(created.id, "focus");
        setFormView(created as ResolvedFormView);
      }
      setViews((prev) => [...prev, created]);
      setActiveViewId(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("createViewFailed"));
    }
  };


  const removeView = async (view: TableView) => {
    if (views.length <= 1) {
      throw new Error(t("keepOneView"));
    }
    await api.deleteView(view.id);
    const remaining = await api.listViews(view.tableId);
    setViews(remaining);
    setActiveViewId((current) => current && remaining.some((candidate) => candidate.id === current) ? current : remaining.find((candidate) => candidate.isDefault)?.id ?? remaining[0]?.id ?? null);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        {t("loadingTable")}
      </div>
    );
  }

  if (!table) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        {error || t("tableMissing")}
      </div>
    );
  }

  const isForm = activeView?.type === "form";
  const isBoard = activeView?.type === "board";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DeleteConfirmation
        open={deletingView !== null}
        onOpenChange={(open) => { if (!open) setDeletingView(null); }}
        title={t("deleteViewQ")}
        description={t("deleteViewDesc", { name: deletingView ? viewLabel(deletingView.type, deletingView.name, t) : "" })}
        onConfirm={async () => { if (deletingView) await removeView(deletingView); }}
      />
      <div className="@container shrink-0 border-b border-border bg-background/80 py-3 pl-4 pr-2 backdrop-blur md:pl-6 md:pr-2" data-testid="table-header">
        <div className="flex w-full flex-col gap-3 @3xl:flex-row @3xl:items-end @3xl:justify-between">
          <div className="min-w-0 @3xl:flex-1">
            <nav
              aria-label={t("breadcrumb")}
              className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"
              data-testid="table-breadcrumb"
            >
              <Link
                to="/app/tables"
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("tables")}
              </Link>
              <span className="shrink-0 text-border">/</span>
              <span className="min-w-0 truncate text-foreground" title={table.name}>{table.name}</span>
            </nav>
            <div className="flex min-w-0 items-center gap-1">
              <TableIconPicker value={table.icon} onChange={(icon) => updateTableMetadata(table.id, { icon })} />
            <Input
              className="h-auto min-w-0 border-0 bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
              title={table.name}
              defaultValue={table.name}
              key={table.id + table.name}
              onBlur={(e) => renameTable(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            </div>
            {table.description && (
              <p className="mt-0.5 break-words text-sm text-muted-foreground">
                {table.description}
              </p>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 @sm:flex-nowrap @3xl:ml-auto @3xl:max-w-[60%]" data-testid="table-toolbar">
            {activeView?.type === "board" && <BoardViewSettings key={`board-settings-${activeView.id}`} view={activeView} table={table} onUpdated={(updated) => setViews((previous) => previous.map((view) => view.id === updated.id ? updated : view))} />}
            <Tabs value={activeViewId ?? ""} onValueChange={setActiveViewId} className="order-first min-w-0 basis-full @sm:order-none @sm:basis-0 @sm:flex-1 @3xl:basis-auto @3xl:flex-initial" data-testid="view-switcher">
              <TabsList className="w-full min-w-0 justify-start overflow-x-auto">
                {views.map((view) => {
                  const Icon = viewIcon(view.type);
                  return <TabsTrigger className="shrink-0" key={view.id} value={view.id} id={`view-tab-${view.id}`} aria-controls={`view-panel-${table.id}`} data-testid={`view-${view.type}`} data-view-id={view.id} onContextMenu={(event) => { event.preventDefault(); setActiveViewId(view.id); setMenuViewId(view.id); }}>
                    <Icon />{viewLabel(view.type, view.name, t)}
                    {view.isDefault && <Star className="size-3 text-muted-foreground" aria-label={t("defaultView")} role="img"><title>{t("defaultView")}</title></Star>}
                  </TabsTrigger>;
                })}
              </TabsList>
            </Tabs>
            {activeView ? <TableActions table={table} onMenuClose={() => setMenuViewId(null)} renderMenu={(items) => <ViewActions tableActions={items} key={`view-actions-${activeView.id}`} view={activeView} table={table} active canDelete={views.length > 1} menuOpen={menuViewId === activeView.id} onMenuOpenChange={(open) => setMenuViewId(open ? activeView.id : null)} onDeleted={() => { setMenuViewId(null); setDeletingView(activeView); }} onUpdated={(updated) => setViews((previous) => previous.map((view) => view.id === updated.id ? updated : updated.isDefault ? { ...view, isDefault: false } : view))} />} /> : <TableActions table={table} />}
              <DropdownMenu open={addOpen} onOpenChange={setAddOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon"
                    type="button"
                    data-testid="add-view"
                    className="shrink-0"
                    title={t("addView")}
                  >
                    <Plus data-icon="inline-start" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-44" align="end" onCloseAutoFocus={event => { if (addingCalendar || siteCreate) event.preventDefault(); }}><DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => void addView("grid")}><Columns3 />{t("gridView")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void addView("board")}><LayoutGrid />{t("boardView")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setAddingCalendar(true)}><CalendarDays />{t("calendarView.name")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setSiteCreate(true)}><Globe />{t("siteView")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void addView("form")}><FileInput />{t("formViewMenu")}</DropdownMenuItem>
                </DropdownMenuGroup></DropdownMenuContent>
              </DropdownMenu>
            <BlogCreateDialog open={siteCreate} onOpenChange={setSiteCreate} tableId={table.id} onCreated={created => { setViews(previous => [...previous, created]); setActiveViewId(created.id); }} />
            {addingCalendar && <CalendarViewSettings table={table} initiallyOpen onClose={() => setAddingCalendar(false)} onSaved={created => { setViews(previous => [...previous, created]); setActiveViewId(created.id); }} />}
            <DataRefreshButton onRefresh={() => notifyTableMutated(table.id)} />
          </div>
        </div>
        {error && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>

      <div id={`view-panel-${table.id}`} role="tabpanel" aria-labelledby={activeViewId ? `view-tab-${activeViewId}` : undefined} className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:px-8 md:py-5">
        {viewsLoading && !activeView ? (
          <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t("loadingView")}
          </div>
        ) : isForm ? (
          formView ? (
            <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col">
                <FormDesigner
                  table={table}
                  view={formView}
                  onChange={setFormView}
                  onSubmitted={() => {
                    notifyTableMutated(table.id);
                    void load();
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t("loadingForm")}
            </div>
          )
        ) : activeView?.type === "site" ? (
          <BlogEditor key={activeView.id} viewId={activeView.id} />
        ) : activeView?.type === "calendar" ? (
          <TableCalendarView key={activeView.id} table={table} view={activeView} refreshToken={tableRefreshToken} onUpdated={updated => setViews(previous => previous.map(view => view.id === updated.id ? updated : view))} />
        ) : isBoard ? (
          <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">
              <KanbanBoard
                table={table}
                config={activeView?.config}
                refreshToken={tableRefreshToken}
                onChange={setTable}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">
              <DataTable table={table} onChange={setTable} refreshToken={tableRefreshToken} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
