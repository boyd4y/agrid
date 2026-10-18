import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tabdo/ui/components/dialog";
import { registerWorkspaceLeaveGuard } from "@/lib/workspace-scope";

/** Normal navigation flushes first; only failed saves need a decision. Local drafts stay scoped. */
export function useSaveBeforeLeave(flush: () => Promise<boolean>) {
  const { t } = useTranslation("documents");
  const [leaving, setLeaving] = useState(false), [open, setOpen] = useState(false);
  const flight = useRef<Promise<boolean> | null>(null), pending = useRef<((answer: boolean) => void) | null>(null), flushRef = useRef(flush);
  flushRef.current = flush;
  const runRequest = async () => {
    setLeaving(true);
    try {
      let saved = false;
      try { saved = await flushRef.current(); } catch { /* The draft remains available for an explicit decision. */ }
      if (saved) return true;
      setLeaving(false); setOpen(true);
      return await new Promise<boolean>(resolve => { pending.current = resolve; });
    } finally { setLeaving(false); }
  };
  const request = () => {
    if (flight.current) return flight.current;
    const promise = runRequest().finally(() => { flight.current = null; });
    flight.current = promise; return promise;
  };
  useEffect(() => {
    const unregister = registerWorkspaceLeaveGuard(request);
    return () => { unregister(); pending.current?.(false); pending.current = null; };
  }, []);
  const decide = (answer: boolean) => { const resolve = pending.current; pending.current = null; setOpen(false); resolve?.(answer); };
  const leave = async (action: () => void) => { if (await request()) action(); };
  const dialog = <Dialog open={open} onOpenChange={value => { if (!value) decide(false); }}><DialogContent closeLabel={t("keepEditing")}><DialogHeader><DialogTitle>{t("leaveTitle")}</DialogTitle><DialogDescription>{t("leaveDraft")}</DialogDescription></DialogHeader><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => decide(false)}>{t("keepEditing")}</Button><Button onClick={() => decide(true)}>{t("leaveWithDraft")}</Button></div></DialogContent></Dialog>;
  return { leave, leaving, dialog };
}
