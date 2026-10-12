import { useCallback, useEffect, useState } from "react";
import { Outlet, useMatch, useNavigate } from "react-router-dom";
import type { Dispatch, SetStateAction } from "react";
import { AppShellProvider, useAppShell } from "@/context/AppShellContext";
import { AppSidebar } from "@/components/shell/AppSidebar";
import { AiDrawer } from "@/components/shell/AiDrawer";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type { TableMeta } from "@/types/table";

export type AppOutletContext = {
  tables: TableMeta[];
  setTables: Dispatch<SetStateAction<TableMeta[]>>;
  refreshTables: () => Promise<void>;
  createTable: () => Promise<void>;
  tablesLoading: boolean;
  notifyTableMutated: () => void;
  tableRefreshToken: number;
};

function AppShellInner() {
  const { ensureOrganization } = useAuth();
  const { setActiveTableId } = useAppShell();
  const tableDetailMatch = useMatch("/app/tables/:tableId");
  const tableAutomationsMatch = useMatch(
    "/app/tables/:tableId/automations"
  );
  const tableMatch = tableAutomationsMatch ?? tableDetailMatch;
  const navigate = useNavigate();
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [tableRefreshToken, setTableRefreshToken] = useState(0);

  useEffect(() => {
    void ensureOrganization();
  }, [ensureOrganization]);

  const refreshTables = useCallback(async () => {
    try {
      const list = await api.listTables();
      setTables(list);
    } catch (e) {
      console.warn("listTables", e);
    } finally {
      setTablesLoading(false);
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
    const name = `新表格 ${tables.length + 1}`;
    try {
      const t = await api.createTable(name);
      setTables((prev) => [...prev, t]);
      navigate(`/app/tables/${t.id}`);
    } catch (e) {
      console.error(e);
    }
  }, [tables.length, navigate]);

  const notifyTableMutated = useCallback(() => {
    setTableRefreshToken((n) => n + 1);
  }, []);

  const outletCtx: AppOutletContext = {
    tables,
    setTables,
    refreshTables,
    createTable,
    tablesLoading,
    notifyTableMutated,
    tableRefreshToken,
  };

  return (
    <div className="flex h-full bg-background text-foreground">
      <AppSidebar
        tables={tables}
        onCreateTable={() => void createTable()}
        tablesLoading={tablesLoading}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet context={outletCtx} />
        </main>
      </div>
      <AiDrawer onMutated={notifyTableMutated} />
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
