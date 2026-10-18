import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@tabdo/ui/components/dialog";
import { useSaveBeforeLeave } from "@/hooks/useSaveBeforeLeave";
import DocumentBody, { type DocumentHandle } from "@/components/documents/DocumentBody";
export default function DocumentEditor(scope: { tableId: string; rowId: string; title: string; onClose(): void }) {
  const { t } = useTranslation("documents");
  const bodyRef = useRef<DocumentHandle>(null);
  const { leave, leaving, dialog } = useSaveBeforeLeave(async () => await bodyRef.current?.flush() ?? true);
  return <><Dialog open onOpenChange={open => { if (!open) void leave(scope.onClose); }}><DialogContent closeLabel={t("close")} className="flex max-h-[90dvh] flex-col overflow-y-auto sm:max-w-5xl" onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (leaving) event.preventDefault(); }}><DialogHeader><DialogTitle>{scope.title}</DialogTitle><DialogDescription>{t("description")}</DialogDescription></DialogHeader><DocumentBody ref={bodyRef} tableId={scope.tableId} rowId={scope.rowId} /></DialogContent></Dialog>{dialog}</>;
}
