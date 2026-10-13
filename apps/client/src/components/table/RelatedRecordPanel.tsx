import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, RefreshCw, Save, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Field, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@tabdo/ui/components/sheet";
import { api } from "@/lib/api";
import { subscribeDataChanges } from "@/lib/data-changes";
import { useMemberOptions } from "@/hooks/useMemberOptions";
import { useAppShell } from "@/context/AppShellContext";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { FormFieldControl } from "@/components/form/FormFieldControls";
import { RelationPicker } from "./RelationPicker";
import { CellDisplay } from "./CellEditors";
import { ColumnTypeIcon } from "./ColumnTypeIcon";
import type { RelatedRecord, RowData, ColumnDef, CellValue } from "@/types/table";
import { useTranslation } from "react-i18next";

type RecordData = RowData & { columns: ColumnDef[] };
/** Board and relation navigation use one private, tenant-checked record editor. */
export function RelatedRecordPanel() {
  const { t } = useTranslation("table");
  const [stack, setStack] = useState<RelatedRecord[]>([]), [row, setRow] = useState<RecordData | null>(null);
  const [draft, setDraft] = useState<Record<string, CellValue>>({}), [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [stale, setStale] = useState(false), [revision, setRevision] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<Set<string>>(new Set());
  const members = useMemberOptions(), wide = useMediaQuery("(min-width: 1024px)");
  const { aiOpen, setAiOpen, setRecordSheetOpen } = useAppShell();
  const record = stack.at(-1), visible = Boolean(record) && (wide || !aiOpen);
  const current = useRef(record?.id), request = useRef(0), draftRef = useRef(draft), savingRef = useRef(saving);
  current.current = record?.id; draftRef.current = draft; savingRef.current = saving;
  const reset = () => { request.current++; setDraft({}); setError(null); setStale(false); setRow(null); };
  const close = () => { if (!savingRef.current) { reset(); setStack([]); } };
  useEffect(() => { setRecordSheetOpen(visible); return () => setRecordSheetOpen(false); }, [visible, setRecordSheetOpen]);
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<RelatedRecord>).detail;
      if (!next?.id || !next.tableId || savingRef.current) return;
      if (next.id !== current.current) { reset(); setStack((previous) => [...previous, next]); }
      if (!wide) setAiOpen(false);
    };
    window.addEventListener("tabdo:open-record", open);
    return () => window.removeEventListener("tabdo:open-record", open);
  }, [wide, setAiOpen]);
  useEffect(() => subscribeDataChanges((change) => {
    if (!record || !(change.all || change.tableIds.includes(record.tableId))) return;
    if (Object.keys(draftRef.current).length || savingRef.current) setStale(true);
    else setRevision((value) => value + 1);
  }), [record?.id, record?.tableId]);
  useEffect(() => {
    const version = ++request.current;
    if (!record) return;
    setLoading(true); setError(null);
    void api.getRow(record.id).then((result) => {
      if (version !== request.current || Object.keys(draftRef.current).length || savingRef.current) return;
      if (result.tableId !== record.tableId) throw new Error(t("recordWrongTable"));
      setRow(result); setStale(false);
    }).catch((error) => { if (version === request.current) setError(error.message); }).finally(() => { if (version === request.current) setLoading(false); });
    return () => { request.current++; };
  }, [record?.id, revision]);
  const stage = (column: ColumnDef, value: CellValue) => {
    setDraft((previous) => { const next = { ...previous }; if (JSON.stringify(value) === JSON.stringify(row?.cells[column.id] ?? null)) delete next[column.id]; else next[column.id] = value; return next; });
  };
  const save = async () => {
    if (!row || savingRef.current || pendingFiles.size || !Object.keys(draft).length) return;
    const cells = { ...draft };
    for (const column of row.columns.filter((column) => column.type === "number" && Object.hasOwn(cells, column.id))) {
      const raw = String(cells[column.id] ?? "").trim();
      if (raw && (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw) || !Number.isFinite(Number(raw)))) { setError(t("needsNumber", { name: column.name })); return; }
      cells[column.id] = raw ? Number(raw) : null;
    }
    const id = row.id; savingRef.current = true; setSaving(true); setError(null);
    try {
      const updated = await api.patchRow(id, { cells, expectedVersion: row.version });
      if (current.current !== id) return;
      setRow({ ...updated, columns: row.columns }); setDraft({}); draftRef.current = {}; setStale(false);
      // The PATCH is committed; a later refresh failure must not turn it into a failed save.
      setRevision((value) => value + 1);
    } catch (error) { if (current.current === id) setError(error instanceof Error ? error.message : t("saveFailed")); }
    finally { savingRef.current = false; if (current.current === id) setSaving(false); }
  };
  const titleColumn = row?.columns.find((column) => column.name === "标题" /* seed */) ?? row?.columns.find((column) => column.type === "text");
  const title = titleColumn && row ? String(row.cells[titleColumn.id] ?? record?.title ?? t("untitled")) : record?.title || t("record");
  return <Sheet open={visible} modal={false} onOpenChange={(open) => { if (!open) close(); }}>
    <SheetContent data-testid="related-record-panel" onPointerDownOutside={(event) => { if (savingRef.current) event.preventDefault(); }} onFocusOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (savingRef.current) event.preventDefault(); }}>
      <SheetHeader>
        <div className="flex items-center gap-2">
          {stack.length > 1 && <Button variant="ghost" size="icon" aria-label={t("backToPrevRecord")} disabled={saving} onClick={() => { reset(); setStack((previous) => previous.slice(0, -1)); }}><ArrowLeft /></Button>}
          <SheetTitle className="min-w-0 flex-1 truncate font-medium">{title || t("untitled")}</SheetTitle>
          <Button variant="ghost" size="icon" aria-label={t("refreshRecord")} disabled={loading || saving || Object.keys(draft).length > 0} onClick={() => setRevision((value) => value + 1)}><RefreshCw /></Button>
          <Button variant="ghost" size="icon" aria-label={t("closeRecord")} disabled={saving} onClick={close}><X /></Button>
        </div>
        <SheetDescription>{t("recordSheetDesc")}</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {stale && <div className="flex flex-col gap-2 text-xs text-muted-foreground"><p>{t("staleRecordHint")}</p><Button variant="outline" size="sm" disabled={saving} onClick={() => { setDraft({}); draftRef.current = {}; setRevision((value) => value + 1); }}>{t("discardDraftReload")}</Button></div>}
          {loading && !row && <p className="text-sm text-muted-foreground">{t("readingRecord")}</p>}
          {!loading && !row && error && <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>{t("retry")}</Button>}
          {row && record && row.id === record.id && row.columns.filter((column) => !column.config.hidden).map((column) => {
            const value = Object.hasOwn(draft, column.id) ? draft[column.id] : row.cells[column.id] ?? null;
            const readOnly = ["formula", "rollup"].includes(column.type);
            return <Field key={column.id} data-record-field={column.id} data-disabled={saving || readOnly}>
              <FieldLabel className="flex items-center gap-2"><ColumnTypeIcon type={column.type} className="size-4" />{column.name}{readOnly && <span className="text-xs text-muted-foreground">{t("readonly")}</span>}</FieldLabel>
              {readOnly ? <div className="rounded-md border border-border bg-muted p-2 text-sm"><CellDisplay column={column} value={value} relation={row.relations?.[column.id]} members={members} /></div> : <div aria-label={column.name} inert={saving}>{column.type === "number" ? <Input inputMode="decimal" aria-label={column.name} value={value == null ? "" : String(value)} aria-invalid={Boolean(error?.startsWith(column.name))} onChange={(event) => stage(column, event.target.value)} /> : column.type === "relation" ? <RelationPicker column={column} value={Array.isArray(value) ? value : []} records={row.relations?.[column.id]?.records} onChange={(value) => stage(column, value)} /> : <FormFieldControl column={column} value={value} members={members} onChange={(value) => stage(column, value)} onPendingChange={pending => setPendingFiles(previous => { const next = new Set(previous); if (pending) next.add(column.id); else next.delete(column.id); return next; })} />}</div>}
            </Field>;
          })}
        </FieldGroup>
      </div>
      <SheetFooter>
        {record && <Button variant="ghost" size="sm" className="mr-auto" disabled={saving} asChild><Link to={`/app/tables/${record.tableId}`} aria-disabled={saving} onClick={(event) => { if (savingRef.current) { event.preventDefault(); return; } close(); }}><ExternalLink />{t("openInTable")}</Link></Button>}
        <Button variant="outline" disabled={saving} onClick={close}><X />{t("cancel")}</Button>
        <Button disabled={saving || pendingFiles.size > 0 || !row || !Object.keys(draft).length} onClick={() => void save()}><Save />{saving ? t("saving") : t("saveChanges")}</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>;
}
