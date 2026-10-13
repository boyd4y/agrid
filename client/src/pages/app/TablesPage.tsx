import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { DataRefreshButton } from "@/components/ui/data-refresh-button";
import { TableIcon } from "@/components/table/TableIcon";
import { TableActions } from "@/components/table/TableActions";
import { Link, useOutletContext } from "react-router-dom";
import { NiPlus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import type { AppOutletContext } from "@/layouts/AppShell";

export function TablesPage() {
  const { tables, createTable, tablesLoading, notifyTableMutated } =
    useOutletContext<AppOutletContext>();

  return (
    <AppPage header={
      <AppPageHeader page="tables" description="管理表格、字段与数据视图。">
        <DataRefreshButton onRefresh={notifyTableMutated} />
        <Button onClick={() => void createTable()}>
          <NiPlus className="h-4 w-4" />
          新建
        </Button>
      </AppPageHeader>
    }>

      {tablesLoading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : tables.length === 0 ? (
        <AppEmptyState
          className="flex-1"
          illustration={NOTIOLY.painting}
          title="还没有表格"
          description="创建第一张表格，开始整理你的数据。"
          action={<Button size="sm" onClick={() => void createTable()}>
            <NiPlus className="h-4 w-4" />
            新建表格
          </Button>}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3">
          {tables.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-border bg-background p-4 shadow-[0_8px_24px_rgba(55,53,47,0.04)] transition hover:bg-muted/40"
            >
              <div className="flex items-start gap-1">
              <Link
                to={`/app/tables/${t.id}`}
                className="flex min-w-0 flex-1 items-start gap-3"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <TableIcon name={t.icon} className="h-4 w-4 text-primary" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t.description || "多维表格"}
                  </div>
                </div>
              </Link>
              <TableActions table={t} />
              </div>
            </div>
          ))}
        </div>
      )}
    </AppPage>
  );
}
