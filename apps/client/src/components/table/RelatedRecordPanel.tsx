import { useEffect, useRef, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@tabdo/ui/components/sheet";
import { useAppShell } from "@/context/AppShellContext";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { workspaceCacheKey } from "@/lib/workspace-scope";
import { useSaveBeforeLeave } from "@/hooks/useSaveBeforeLeave";
import { RecordPage, type RecordPageHandle } from "@/components/table/RecordPage";
import type { RelatedRecord } from "@/types/table";

export function RelatedRecordPanel() {
  const { t } = useTranslation("table");
  const [stack, setStack] = useState<RelatedRecord[]>([]);
  const pageRef = useRef<RecordPageHandle>(null);
  const wide = useMediaQuery("(min-width: 1024px)"), { aiOpen, setAiOpen, setRecordSheetOpen } = useAppShell();
  const record = stack.at(-1), visible = !!record && (wide || !aiOpen), current = useRef(record?.id); current.current = record?.id;
  const { leave, leaving, dialog } = useSaveBeforeLeave(async () => await pageRef.current?.flush() ?? true);
  const close = () => void leave(() => { setStack([]); });
  useEffect(() => { setRecordSheetOpen(visible); return () => setRecordSheetOpen(false); }, [visible, setRecordSheetOpen]);
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<RelatedRecord>).detail;
      if (!next?.id || !next.tableId || next.id === current.current) return;
      void leave(() => { setStack(previous => [...previous, next]); if (!wide) setAiOpen(false); });
    };
    window.addEventListener("tabdo:open-record", open); return () => window.removeEventListener("tabdo:open-record", open);
  }, [wide, setAiOpen, t]);
  return <><Sheet open={visible} modal={false} onOpenChange={open => { if (!open) close(); }}><SheetContent className="w-full sm:w-[480px]" data-testid="related-record-panel" onPointerDownOutside={event => {
    const target = event.detail.originalEvent.target;
    if (leaving || target instanceof Element && target.closest("[data-record-trigger]")) event.preventDefault();
  }} onFocusOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (leaving) event.preventDefault(); }}>
    <SheetHeader><div className="flex items-center gap-2">{stack.length > 1 && <Button variant="ghost" size="icon" aria-label={t("backToPrevRecord")} disabled={leaving} onClick={() => { void leave(() => { setStack(previous => previous.slice(0, -1)); }); }}><ArrowLeft /></Button>}<SheetTitle className="min-w-0 flex-1">{t("record")}</SheetTitle><Button variant="ghost" size="icon" aria-label={t("closeRecord")} disabled={leaving} onClick={close}><X /></Button></div><SheetDescription>{t("recordSheetDesc")}</SheetDescription></SheetHeader>
    <div className="min-h-0 flex-1 overflow-y-auto p-4">{record && <RecordPage ref={pageRef} key={`${workspaceCacheKey()}:${record.tableId}:${record.id}`} tableId={record.tableId} rowId={record.id} />}</div>
  </SheetContent></Sheet>{dialog}</>;
}
