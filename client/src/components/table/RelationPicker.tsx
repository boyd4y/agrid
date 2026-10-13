import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Link2, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ColumnDef, RelatedRecord, RowData } from "@/types/table";
import type { RelationQueryResult } from "@tabdo/shared";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

export function openRelatedRecord(record: RelatedRecord) {
  window.dispatchEvent(
    new CustomEvent("tabdo:open-record", { detail: record }),
  );
}
export function RelationTags({
  records,
  total = records.length,
}: {
  records: RelatedRecord[];
  total?: number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
      {records.length ? (
        records.map((record) => (
          <button
            key={record.id}
            type="button"
            className="inline-flex max-w-40 shrink-0 items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            title={i18n.t("table:openRelated", { title: record.title })}
            onClick={(e) => {
              e.stopPropagation();
              openRelatedRecord(record);
            }}
          >
            <Link2 className="size-3 shrink-0" />
            <span className="truncate">{record.title}</span>
          </button>
        ))
      ) : (
        <span className="text-muted-foreground/50">{i18n.t("table:empty")}</span>
      )}
      {total > records.length && (
        <span className="shrink-0 text-xs text-muted-foreground">
          +{total - records.length}
        </span>
      )}
    </div>
  );
}
export function RelationPicker({
  column,
  value,
  onChange,
  rowId,
  rowVersion,
  records = [],
  onUpdated,
  embedded = false,
  onClose,
}: {
  column: ColumnDef;
  value: string[];
  onChange?: (ids: string[]) => void;
  rowId?: string;
  rowVersion?: number;
  records?: RelatedRecord[];
  onUpdated?: (row: RowData) => void;
  embedded?: boolean;
  onClose?: () => void;
}) {
  const { t } = useTranslation("table");
  const [open, setOpen] = useState(embedded),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState<RelationQueryResult | null>(null),
    [selectedPage, setSelectedPage] = useState<RelationQueryResult | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const [titles, setTitles] = useState<Record<string, RelatedRecord>>(() =>
    Object.fromEntries(records.map((r) => [r.id, r])),
  );
  const version = useRef(rowVersion);
  version.current = rowVersion;
  const requestVersion = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 180);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!open) return;
    const request = ++requestVersion.current;
    setLoading(true);
    setError(null);
    api
      .queryRelationRecords({ columnId: column.id, rowId, search: query })
      .then((result) => {
        if (request !== requestVersion.current) return;
        setPage(result);
        setTitles((prev) => ({
          ...prev,
          ...Object.fromEntries(result.records.map((r) => [r.id, r])),
        }));
      })
      .catch((e) => {
        if (request === requestVersion.current) setError(e.message);
      })
      .finally(() => {
        if (request === requestVersion.current) setLoading(false);
      });
    return () => {
      requestVersion.current++;
    };
  }, [column.id, rowId, query, open, revision]);
  const valueKey = JSON.stringify(value.slice(0, 100));
  useEffect(() => {
    let cancelled = false;
    if (rowId && !open) return;
    api
      .queryRelationRecords({
        columnId: column.id,
        rowId,
        mode: rowId ? "related" : "candidates",
        ...(!rowId ? { recordIds: JSON.parse(valueKey) } : {}),
      })
      .then((result) => {
        if (cancelled) return;
        setSelectedPage(result);
        setTitles((prev) => ({
          ...prev,
          ...Object.fromEntries(result.records.map((r) => [r.id, r])),
        }));
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [column.id, rowId, valueKey, open, revision]);
  const choose = async (id: string, selected: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (rowId) {
        const input = { rowId, columnId: column.id, recordIds: [id] };
        const result = selected
          ? await api.removeRelation(input)
          : column.config.relation?.limit === "one"
            ? await api.setRelation({
                ...input,
                expectedVersion: version.current,
              })
            : await api.addRelation(input);
        version.current = result.version;
        onUpdated?.(result);
        setRevision((n) => n + 1);
      } else
        onChange?.(
          selected
            ? value.filter((v) => v !== id)
            : column.config.relation?.limit === "one"
              ? [id]
              : [...value, id],
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("relationSaveFailed"));
    } finally {
      setBusy(false);
    }
  };
  const loadMore = async (related: boolean) => {
    const current = related ? selectedPage : page;
    if (!current?.nextCursor || busy) return;
    const request = requestVersion.current;
    setBusy(true);
    try {
      const next = await api.queryRelationRecords({
        columnId: column.id,
        rowId,
        mode: related ? "related" : "candidates",
        search: related ? undefined : query,
        cursor: current.nextCursor,
      });
      if (request !== requestVersion.current) return;
      const setter = related ? setSelectedPage : setPage;
      setter({ ...next, records: [...current.records, ...next.records] });
      setTitles((prev) => ({
        ...prev,
        ...Object.fromEntries(next.records.map((r) => [r.id, r])),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setBusy(false);
    }
  };
  const selectedRecords = rowId
    ? (selectedPage?.records ?? records)
    : value.slice(0, 20).map(
        (id) =>
          titles[id] ?? {
            id,
            tableId: column.config.relation?.targetTableId ?? "",
            title: t("loading"),
          },
      );
  const anchor = (
    <div className="flex h-full min-h-8 w-full items-center">
      <RelationTags records={selectedRecords} />
    </div>
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onClose?.();
      }}
    >
      {embedded ? (
        <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-10 w-full justify-between font-normal"
          >
            <span className="min-w-0 truncate">
              {selectedRecords.length
                ? selectedRecords.map((r) => r.title).join("、")
                : t("pickRelated")}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
      )}
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-80 max-w-[calc(100vw-2rem)] p-1"
        aria-label={t("pickRelatedNamed", { name: column.name })}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 border-b border-border p-2">
          <Search className="size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchRecords")}
            aria-label={t("searchRelatedAria")}
            className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        {error && (
          <p role="alert" className="px-2 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {selectedRecords.length > 0 && (
          <div className="max-h-36 overflow-auto border-b border-border p-2">
            <p className="mb-1 text-xs text-muted-foreground">{t("alreadyLinked")}</p>
            {selectedRecords.map((record) => (
              <div key={record.id} className="flex items-center gap-1 py-0.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left text-sm hover:bg-accent"
                  onClick={() => openRelatedRecord(record)}
                >
                  <Link2 className="size-3 shrink-0" />
                  <span className="truncate">{record.title}</span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={busy}
                  aria-label={t("unlinkNamed", { title: record.title })}
                  onClick={() => void choose(record.id, true)}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
            {rowId && selectedPage?.hasMore && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void loadMore(true)}
              >
                {t("moreLinked")}
              </Button>
            )}
          </div>
        )}
        <div className="max-h-56 overflow-auto p-1">
          {loading ? (
            <p className="p-2 text-xs text-muted-foreground">{t("loading")}</p>
          ) : page?.records.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">{t("noMatchingRecords")}</p>
          ) : (
            page?.records.map((record) => {
              const selected = rowId
                ? record.selected
                : value.includes(record.id);
              return (
                <button
                  type="button"
                  key={record.id}
                  disabled={busy}
                  aria-pressed={selected}
                  className={cn(
                    "flex min-h-8 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50",
                    selected && "bg-accent",
                  )}
                  onClick={() => void choose(record.id, selected)}
                >
                  <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {record.title}
                  </span>
                  {selected && <Check className="size-4 shrink-0" />}
                </button>
              );
            })
          )}
          {page?.hasMore && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={busy}
              onClick={() => void loadMore(false)}
            >
              {t("loadMore")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
