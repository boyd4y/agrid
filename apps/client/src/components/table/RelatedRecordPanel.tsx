import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@tabdo/ui/components/dialog";
import { useAppShell } from "@/context/AppShellContext";
import { workspaceCacheKey } from "@/lib/workspace-scope";
import { useSaveBeforeLeave } from "@/hooks/useSaveBeforeLeave";
import { RecordPage, type RecordPageHandle } from "@/components/table/RecordPage";
import type { RelatedRecord } from "@/types/table";

export function RelatedRecordPanel() {
  const { t } = useTranslation("table");
  const [stack, setStack] = useState<RelatedRecord[]>([]);
  const pageRef = useRef<RecordPageHandle>(null);
  const { setAiOpen, setRecordSheetOpen } = useAppShell();
  const record = stack.at(-1), visible = !!record, current = useRef(record?.id); current.current = record?.id;
  const { leave, leaving, dialog } = useSaveBeforeLeave(async () => await pageRef.current?.flush() ?? true);
  const close = () => void leave(() => { setStack([]); });
  useEffect(() => { setRecordSheetOpen(visible); return () => setRecordSheetOpen(false); }, [visible, setRecordSheetOpen]);
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<RelatedRecord>).detail;
      if (!next?.id || !next.tableId || next.id === current.current) return;
      void leave(() => { setStack(previous => [...previous, next]); setAiOpen(false); });
    };
    window.addEventListener("tabdo:open-record", open); return () => window.removeEventListener("tabdo:open-record", open);
  }, [setAiOpen, t]);
  return <><Dialog open={visible} onOpenChange={open => { if (!open) close(); }}><DialogContent closeLabel={t("closeRecord")} aria-modal="true" aria-describedby={undefined} className="flex h-dvh w-full max-w-[1120px] flex-col gap-0 rounded-none p-0 sm:h-[90dvh] sm:w-[calc(100%-3rem)] sm:rounded-lg" data-testid="related-record-panel" onPointerDownOutside={event => {
    if (leaving) event.preventDefault();
  }} onEscapeKeyDown={event => { if (leaving) event.preventDefault(); }}>
    <DialogTitle className="sr-only">{t("record")}</DialogTitle>
    <div className="flex min-h-12 shrink-0 items-center px-4 pr-14">{stack.length > 1 && <Button variant="ghost" size="sm" aria-label={t("backToPrevRecord")} disabled={leaving} onClick={() => { void leave(() => { setStack(previous => previous.slice(0, -1)); }); }}><ArrowLeft />{t("backToPrevRecord")}</Button>}</div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-12 sm:px-12">{record && <RecordPage ref={pageRef} key={`${workspaceCacheKey()}:${record.tableId}:${record.id}`} tableId={record.tableId} rowId={record.id} />}</div>
  </DialogContent></Dialog>{dialog}</>;
}
