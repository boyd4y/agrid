import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Alert, AlertDescription } from "@tabdo/ui/components/alert";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@tabdo/ui/components/command";
import { ListPagination } from "@/components/controls/list-pagination";
import { useArrayPagination } from "@/hooks/useListPagination";
import { api } from "@/lib/api";
import { subscribeDataChanges } from "@/lib/data-changes";
import { workspaceCacheKey } from "@/lib/workspace-scope";
import { filterPreviewResources, loadPreviewResources, type PreviewResource } from "@/components/preview/preview-resources";
import type { PreviewTab } from "@/components/preview/preview-slot";

/** Shared by the centered step and the header popover; filtering precedes pagination. */
export function PreviewResourceList({ kind, selected, onSelect }: {
  kind: string; selected?: PreviewTab; onSelect: (tab: PreviewTab) => void;
}) {
  const { t } = useTranslation(["app", "common", "errors"]);
  const [items, setItems] = useState<PreviewResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const scope = workspaceCacheKey();
  const pagination = useArrayPagination(filterPreviewResources(items, search), 10);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => subscribeDataChanges(() => setReload(n => n + 1)), []);
  useEffect(() => {
    let current = true;
    const isCurrent = () => current && scope === workspaceCacheKey();
    setItems([]); setLoading(true); setError(null);
    void loadPreviewResources(kind, api, isCurrent).then(value => {
      if (isCurrent()) setItems(value);
    }).catch(cause => {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : t("errors:loadFailed"));
    }).finally(() => { if (isCurrent()) setLoading(false); });
    return () => { current = false; };
  }, [kind, reload, scope, t]);
  const id = selected?.siteId ?? selected?.reportId ?? selected?.tableId;
  return <div className="flex min-h-0 flex-col" data-testid="preview-resource-list">
    <Command shouldFilter={false} className="h-auto min-h-0">
      <CommandInput ref={input} value={search} onValueChange={value => { setSearch(value); pagination.resetPage(); }} placeholder={t("preview.searchResources")} aria-label={t("preview.searchResources")} />
      <CommandList ref={list} className="min-h-0 max-h-80" aria-busy={loading}>
        {loading ? <p role="status" className="p-4 text-sm text-muted-foreground">{t("common:loading")}</p> : error ? <Alert variant="destructive"><AlertDescription><span className="break-words">{error}</span><Button variant="outline" size="sm" onClick={() => setReload(n => n + 1)}>{t("common:retry")}</Button></AlertDescription></Alert> : <>
          <CommandEmpty>{t(items.length ? "preview.noMatches" : `preview.no${kind === "site" ? "Sites" : kind === "report" ? "Reports" : "Tables"}`)}</CommandEmpty>
          <CommandGroup>{pagination.items.map(item => {
            const name = item.duplicateIndex ? `${item.name} · ${t("preview.duplicateResource", { index: item.duplicateIndex })}` : item.name;
            return <CommandItem key={item.id} value={item.id} aria-label={name} title={name} data-resource-id={item.id} onSelect={() => onSelect({ kind, ...(kind === "site" ? { siteId: item.id } : kind === "report" ? { reportId: item.id } : { tableId: item.id }) })}><span className="min-w-0 flex-1 truncate">{name}</span>{id === item.id && <Check />}</CommandItem>;
          })}</CommandGroup>
        </>}
      </CommandList>
    </Command>
    {!loading && !error && pagination.total > 0 && <ListPagination compact className="mt-3 shrink-0 justify-center" page={pagination.page} hasNext={pagination.hasNext} totalPages={pagination.totalPages} onPageChange={page => { pagination.setPage(page); list.current?.scrollTo(0, 0); }} />}
  </div>;
}
