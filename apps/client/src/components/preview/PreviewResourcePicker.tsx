import { useEffect, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@tabdo/ui/components/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@tabdo/ui/components/command";
import { api } from "@/lib/api";
import { subscribeDataChanges } from "@/lib/data-changes";
import type { PreviewTab } from "./preview-slot";

type Resource = { id: string; name: string };
export function PreviewResourcePicker({ open, onOpenChange, kind, selected, title, tables, onSelect }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  kind: string; selected?: PreviewTab; title?: string; tables: Resource[]; onSelect: (tab: PreviewTab) => void;
}) {
  const { t } = useTranslation(["app", "common"]);
  const [items, setItems] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const remote = kind === "site" || kind === "report";
  useEffect(() => subscribeDataChanges(() => setReload(n => n + 1)), []);
  useEffect(() => {
    if (!remote) return;
    let current = true;
    setLoading(true); setError(null);
    const load = async () => {
      if (kind === "site") return api.listSites();
      const all: Resource[] = [];
      for (let offset = 0; current; offset += 100) {
        const page = await api.listReports(offset, 100);
        all.push(...page.reports);
        if (!page.hasMore) break;
      }
      return all;
    };
    void load().then(value => { if (current) setItems(value); }).catch(cause => { if (current) setError(cause.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [kind, reload, remote]);
  const resources = remote ? items : tables;
  const id = selected?.siteId ?? selected?.reportId ?? selected?.tableId;
  const label = title ?? resources.find(item => item.id === id)?.name ?? t("preview.chooseResource");
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild><Button variant="ghost" size="sm" className="min-w-0 max-w-48 basis-[36%] justify-start" title={label} aria-label={t("preview.selectResource", { name: label })} data-testid="preview-resource-picker"><span className="min-w-0 flex-1 truncate">{label}</span><ChevronDown className="size-3 shrink-0" /></Button></PopoverTrigger>
    <PopoverContent align="start" className="w-72 max-w-[calc(100vw-1rem)] p-0">
      <Command><CommandInput placeholder={t("preview.searchResources")} aria-label={t("preview.searchResources")} /><CommandList>
        {loading ? <p role="status" className="p-4 text-sm text-muted-foreground">{t("common:loading")}</p> : error ? <div role="alert" className="flex flex-col gap-2 p-3 text-sm"><span className="break-words text-destructive">{error}</span><Button variant="outline" size="sm" onClick={() => setReload(n => n + 1)}>{t("common:retry")}</Button></div> : <>
          <CommandEmpty>{t(resources.length ? "preview.noMatches" : `preview.no${kind === "site" ? "Sites" : kind === "report" ? "Reports" : "Tables"}`)}</CommandEmpty>
          <CommandGroup>{resources.map((item, index) => {
            const duplicates = resources.filter(resource => resource.name === item.name);
            const name = duplicates.length > 1 ? `${item.name} · ${t("preview.duplicateResource", { index: duplicates.findIndex(resource => resource.id === item.id) + 1 })}` : item.name;
            return <CommandItem key={item.id} value={`${item.name} ${index}`} aria-label={name} title={name} data-resource-id={item.id} onSelect={() => { onSelect({ kind, ...(kind === "site" ? { siteId: item.id } : kind === "report" ? { reportId: item.id } : { tableId: item.id }) }); onOpenChange(false); }}><span className="min-w-0 flex-1 truncate">{name}</span>{id === item.id && <Check />}</CommandItem>;
          })}</CommandGroup>
        </>}
      </CommandList></Command>
    </PopoverContent>
  </Popover>;
}
