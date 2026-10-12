import { Link, useOutletContext } from "react-router-dom";
import { NiTable, NiZap } from "@/components/icons";
import type { AppOutletContext } from "@/layouts/AppShell";

/**
 * Workspace-level automations hub. Per-table rules stay at
 * /app/tables/:tableId/automations.
 */
export function AutomationsPage() {
  const { tables, tablesLoading } = useOutletContext<AppOutletContext>();

  return (
    <div
      className="mx-auto h-full min-h-0 max-w-4xl overflow-auto px-6 py-10 md:px-10"
      data-testid="automations-hub"
    >
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <NiZap className="h-5 w-5 text-[#D9730D]" />
          <h1 className="text-2xl font-semibold tracking-tight">自动化</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          按表格管理当 / 如果 / 就规则 · 选择一张表进入设置
        </p>
      </div>

      {tablesLoading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : tables.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            还没有表格。先在「表格」新建，再配置自动化。
          </p>
          <Link
            to="/app/tables"
            className="mt-4 inline-flex text-sm font-medium text-primary hover:underline"
          >
            去表格
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tables.map((t) => (
            <Link
              key={t.id}
              to={`/app/tables/${t.id}/automations`}
              className="flex items-start gap-3 rounded-xl border border-border bg-background p-4 shadow-[0_8px_24px_rgba(55,53,47,0.04)] transition hover:bg-muted/40"
              data-testid={`automations-hub-${t.id}`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#FADEC9]">
                <NiZap className="h-4 w-4 text-[#D9730D]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{t.name}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <NiTable className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {t.description || "打开该表的自动化规则"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
