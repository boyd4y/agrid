import { Link, useOutletContext } from "react-router-dom";
import { NiPlus, NiTable, NiZap } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyTable } from "@/components/illustrations";
import type { AppOutletContext } from "@/layouts/AppShell";

export function TablesPage() {
  const { tables, createTable, tablesLoading } =
    useOutletContext<AppOutletContext>();

  return (
    <div className="mx-auto h-full min-h-0 max-w-4xl overflow-auto px-6 py-10 md:px-10">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">表格</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            所有多维表 · 表格 / 看板视图 · 自动化设置
          </p>
        </div>
        <Button onClick={() => void createTable()}>
          <NiPlus className="h-4 w-4" />
          新建
        </Button>
      </div>

      {tablesLoading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : tables.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-muted px-6 py-12 text-center">
          <EmptyTable className="w-48" />
          <Button onClick={() => void createTable()}>
            <NiPlus className="h-4 w-4" />
            新建表格
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tables.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-border bg-background p-4 shadow-[0_8px_24px_rgba(55,53,47,0.04)] transition hover:bg-muted/40"
            >
              <Link
                to={`/app/tables/${t.id}`}
                className="flex items-start gap-3"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#D3E5EF]">
                  <NiTable className="h-4 w-4 text-primary" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t.description || "多维表格"}
                  </div>
                </div>
              </Link>
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                <Link
                  to={`/app/tables/${t.id}/automations`}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  data-testid={`table-automations-${t.id}`}
                >
                  <NiZap className="h-3.5 w-3.5 text-[#D9730D]" />
                  自动化
                </Link>
                <span className="text-[10px] text-muted-foreground">
                  表格设置
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
