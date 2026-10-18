import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@tabdo/ui/components/popover";
import { workspaceCacheKey } from "@/lib/workspace-scope";
import { PreviewResourceList } from "@/components/preview/PreviewResourceList";
import type { PreviewTab } from "./preview-slot";

export function PreviewResourcePicker({ open, onOpenChange, kind, selected, title, tables, onSelect }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  kind: string; selected?: PreviewTab; title?: string; tables: { id: string; name: string }[]; onSelect: (tab: PreviewTab) => void;
}) {
  const { t } = useTranslation("app");
  const label = title ?? tables.find(item => item.id === selected?.tableId)?.name ?? t("preview.chooseResource");
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild><Button variant="ghost" size="sm" className="min-w-0 max-w-48 basis-[36%] justify-start" title={label} aria-label={t("preview.selectResource", { name: label })} data-testid="preview-resource-picker"><span className="min-w-0 flex-1 truncate">{label}</span><ChevronDown data-icon="inline-end" /></Button></PopoverTrigger>
    <PopoverContent align="start" className="w-72 max-w-[calc(100vw-1rem)] p-2">
      <PreviewResourceList key={`${workspaceCacheKey()}:${kind}`} kind={kind} selected={selected} onSelect={tab => { onSelect(tab); onOpenChange(false); }} />
    </PopoverContent>
  </Popover>;
}
