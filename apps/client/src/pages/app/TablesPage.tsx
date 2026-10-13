import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@tabdo/ui/components/input";
import { useArrayPagination } from "@/hooks/useListPagination";
import { ListPagination } from "@/components/controls/list-pagination";
import { ListItemLink } from "@/components/controls/list-item-link";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { TableIcon } from "@/components/table/TableIcon";
import { TableActions } from "@/components/table/TableActions";
import { useOutletContext } from "react-router-dom";
import { NiPlus } from "@/components/icons";
import { Button } from "@tabdo/ui/components/button";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import type { AppOutletContext } from "@/layouts/AppShell";
import { useTranslation } from "react-i18next";

export function TablesPage() {
  const { t } = useTranslation(["app", "common"]);
  const { tables, createTable, tablesLoading, notifyTableMutated } =
    useOutletContext<AppOutletContext>();

  const [query, setQuery] = useState("");
  const visible = tables.filter(table => `${table.name} ${table.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pagination = useArrayPagination(visible);
  useEffect(() => pagination.resetPage(), [query, pagination.resetPage]);

  return (
    <AppPage contentWidth="standard" className="gap-5" data-testid="tables-page" header={
      <AppPageHeader page="tables" description={t("tables.description")}>
        <DataRefreshButton onRefresh={notifyTableMutated} />
        <Button onClick={() => void createTable()}>
          <NiPlus className="h-4 w-4" />
          {t("tables.new")}
        </Button>
      </AppPageHeader>
    }>

      <div className="relative w-full max-w-sm"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label={t("directory.searchAria", { label: t("nav.tables") })} placeholder={t("directory.searchPlaceholder", { label: t("nav.tables") })} className="pl-9" value={query} disabled={tablesLoading && tables.length === 0} onChange={event => setQuery(event.target.value)} /></div>
      {tablesLoading ? (
        <p className="text-sm text-muted-foreground">{t("common:loading")}</p>
      ) : tables.length === 0 ? (
        <AppEmptyState
          className="flex-1"
          illustration={NOTIOLY.painting}
          title={t("tables.emptyTitle")}
          description={t("tables.emptyDescription")}
          action={<Button size="sm" onClick={() => void createTable()}>
            <NiPlus className="h-4 w-4" />
            {t("tables.newTable")}
          </Button>}
        />
      ) : visible.length === 0 ? <p className="text-sm text-muted-foreground">{t("common:pagination.noResults")}</p> : (
        <>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3">
          {pagination.items.map((table) => (
            <div
              key={table.id}
              data-testid="table-list-item"
              className="relative rounded-xl border border-border bg-background p-4 shadow-[0_8px_24px_rgba(55,53,47,0.04)] transition hover:bg-muted/40"
            >
              <ListItemLink to={`/app/tables/${table.id}`} label={table.name} />
              <div className="flex items-start gap-1">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <TableIcon name={table.icon} className="h-4 w-4 text-primary" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{table.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {table.description || t("tables.defaultDescription")}
                  </div>
                </div>
              </div>
              <div className="relative z-10 shrink-0"><TableActions table={table} /></div>
              </div>
            </div>
          ))}
        </div>
        <ListPagination page={pagination.page} hasNext={pagination.hasNext} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
        </>
      )}
    </AppPage>
  );
}
