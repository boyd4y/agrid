import { RelatedRecordPanel } from "@/components/table/RelatedRecordPanel";
import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useMatch, useNavigate } from "react-router-dom";
import type { Dispatch, SetStateAction } from "react";
import { AppShellProvider, useAppShell } from "@/context/AppShellContext";
import { AppSidebar } from "@/components/shell/AppSidebar";
import { AiDrawer } from "@/components/shell/AiDrawer";
import { AiToggle } from "@/components/shell/AiToggle";
import { notifyDataChanged, subscribeDataChanges } from "@/lib/data-changes";
import { api } from "@/lib/api";
import { toast } from "sonner";
import i18n from "@/i18n";
import type { TableMeta } from "@/types/table";

export type AppOutletContext = {
  tables: TableMeta[];
  setTables: Dispatch<SetStateAction<TableMeta[]>>;
  refreshTables: () => Promise<void>;
  createTable: () => Promise<void>;
  deleteTable: (tableId: string) => Promise<void>;
  updateTableMetadata: (tableId: string, patch: Parameters<typeof api.patchTable>[1]) => Promise<void>;
  tablesLoading: boolean;
  notifyTableMutated: (tableId?: string | null) => void;
  getTableRefreshToken: (tableId?: string | null) => number;
  tableRefreshToken: number;
};

function AppShellInner() {
  const { setActiveTableId } = useAppShell();
  const tableDetailMatch = useMatch("/app/tables/:tableId");
  const tableAutomationsMatch = useMatch(
    "/app/tables/:tableId/automations"
  );
  const tableMatch = tableAutomationsMatch ?? tableDetailMatch;
  const aiPageMatch = useMatch({ path: "/app", end: true });
  const navigate = useNavigate();
  const tableListRequest = useRef(0);
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [tableRefreshToken, setTableRefreshToken] = useState(0);
  const [scopedRefresh, setScopedRefresh] = useState<{ all: number; tables: Record<string, number> }>({ all: 0, tables: {} });

  const refreshTables = useCallback(async () => {
    const version = ++tableListRequest.current;
    try {
      const list = await api.listTables();
      if (version === tableListRequest.current) setTables(list);
    } catch (e) {
      if (version === tableListRequest.current) toast.error(e instanceof Error ? e.message : i18n.t("errors:tablesListToast"), { id: "table-list-load" });
    } finally {
      if (version === tableListRequest.current) setTablesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTables();
  }, [refreshTables]);

  // Sync active table id from nested route
  useEffect(() => {
    const tid = tableMatch?.params.tableId ?? null;
    setActiveTableId(tid);
  }, [tableMatch?.params.tableId, setActiveTableId]);

  const createTable = useCallback(async () => {
    const name = i18n.t("app:tables.newTableName", { n: tables.length + 1 });
    try {
      const t = await api.createTable(name);
      setTables((prev) => [...prev, t]);
      navigate(`/app/tables/${t.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : i18n.t("errors:createTableFailedRetry"));
    }
  }, [tables.length, navigate]);

  useEffect(() => subscribeDataChanges((change) => {
    setTableRefreshToken((n) => n + 1);
    setScopedRefresh((previous) => {
      if (change.all) return { ...previous, all: previous.all + 1 };
      const tables = { ...previous.tables };
      for (const id of change.tableIds) tables[id] = (tables[id] ?? 0) + 1;
      return { ...previous, tables };
    });
    void refreshTables();
  }), [refreshTables]);

  const notifyTableMutated = useCallback((tableId?: string | null) => notifyDataChanged(tableId), []);
  const getTableRefreshToken = useCallback((tableId?: string | null) =>
    scopedRefresh.all + (tableId ? scopedRefresh.tables[tableId] ?? 0 : 0), [scopedRefresh]);

  const deleteTable = useCallback(async (tableId: string) => {
    await api.deleteTable(tableId);
    setTables((prev) => prev.filter((t) => t.id !== tableId));
    notifyTableMutated();
    if (tableMatch?.params.tableId === tableId) navigate("/app/tables", { replace: true });
  }, [navigate, notifyTableMutated, tableMatch?.params.tableId]);

  const updateTableMetadata = useCallback(async (id: string, patch: Parameters<typeof api.patchTable>[1]) => {
    const updated = await api.patchTable(id, patch);
    setTables((previous) => previous.map((table) => table.id === id ? { ...table, ...updated } : table));
  }, []);

  const outletCtx: AppOutletContext = {
    tables,
    setTables,
    refreshTables,
    createTable,
    deleteTable,
    tablesLoading,
    notifyTableMutated,
    tableRefreshToken,
    getTableRefreshToken,
    updateTableMetadata,
  };

  return (
    <div className="flex h-full bg-background text-foreground">
      <AppSidebar
        tables={tables}
        onCreateTable={() => void createTable()}
        tablesLoading={tablesLoading}
        onTogglePin={(table) => updateTableMetadata(table.id, { pinned: !table.pinned })}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-full min-h-0 min-w-0 w-full flex-col"><Outlet context={outletCtx} /></div>
        </main>
        <AiToggle />
      </div>
      <RelatedRecordPanel/>
      {!aiPageMatch && <AiDrawer onMutated={notifyTableMutated} />}
    </div>
  );
}

export function AppShell() {
  return (
    <AppShellProvider>
      <AppShellInner />
    </AppShellProvider>
  );
}
