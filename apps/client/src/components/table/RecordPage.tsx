import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@tabdo/ui/components/collapsible";
import { Input } from "@tabdo/ui/components/input";
import { Field, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { workspaceCacheKey, workspaceUnloadApproved } from "@/lib/workspace-scope";
import { subscribeDataChanges } from "@/lib/data-changes";
import { useMemberOptions } from "@/hooks/useMemberOptions";
import { FormFieldControl } from "@/components/form/FormFieldControls";
import DocumentBody, { type DocumentState, type DocumentHandle } from "@/components/documents/DocumentBody";
import { RelationPicker } from "./RelationPicker";
import { CellDisplay } from "./CellEditors";
import { ColumnTypeIcon } from "./ColumnTypeIcon";
import type { RowData, ColumnDef, CellValue } from "@/types/table";

type RecordData = RowData & { columns: ColumnDef[] };
export type RecordPageHandle = DocumentHandle;
type Props = { ref?: Ref<RecordPageHandle>; tableId: string; rowId: string; titleColumnId?: string; advancedColumnIds?: string[]; onStateChange?(state: DocumentState): void; onSaved?(): void };
/** The page is keyed by workspace/table/row at each host. Attribute and body versions save independently. */
export function RecordPage({ ref, tableId, rowId, titleColumnId, advancedColumnIds = [], onStateChange, onSaved }: Props) {
  const { t } = useTranslation("table"), members = useMemberOptions();
  const [row, setRow] = useState<RecordData | null>(null), [draft, setDraft] = useState<Record<string, CellValue>>({});
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [stale, setStale] = useState(false), [revision, setRevision] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<Set<string>>(new Set()), [bodyState, setBodyState] = useState<DocumentState>({ dirty: false, busy: false });
  const bodyRef = useRef<DocumentHandle>(null), rowFlight = useRef<Promise<boolean> | null>(null), rowFailed = useRef(false);
  const pendingFilesRef = useRef(new Set<string>()), fileWaiters = useRef<(() => void)[]>([]);
  const [flushing, setFlushing] = useState(false);
  const key = useRef(`tabdo.record-draft:${workspaceCacheKey()}:${tableId}:${rowId}`).current;
  const draftRef = useRef(draft), savingRef = useRef(false), baseVersion = useRef<number | undefined>(undefined), mounted = useRef(true);
  draftRef.current = draft;
  const retain = useCallback(() => {
    try {
      if (Object.keys(draftRef.current).length) sessionStorage.setItem(key, JSON.stringify({ cells: draftRef.current, baseVersion: baseVersion.current }));
      else sessionStorage.removeItem(key);
    } catch { setError(t("documents:draftStorageFailed")); }
  }, [key, t]);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    setLoading(true);
    void api.getRow(rowId).then(result => {
      if (cancelled) return;
      if (result.tableId !== tableId) throw new Error(t("recordWrongTable"));
      if (!rowFailed.current) setError("");
      if (!Object.keys(draftRef.current).length) {
        try {
          const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
          if (saved && Number.isInteger(saved.baseVersion) && saved.cells && typeof saved.cells === "object" && !Array.isArray(saved.cells)) {
            draftRef.current = saved.cells; baseVersion.current = saved.baseVersion; setDraft(saved.cells);
          }
        } catch { /* A malformed local draft never becomes a write. */ }
      }
      // A committed response may have been lost during unmount. Acknowledge only values now on the server.
      if (Object.keys(draftRef.current).length && Object.entries(draftRef.current).every(([id, value]) => {
        const normalized = result.columns.find(c => c.id === id)?.type === "number" && value != null && String(value).trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
        return JSON.stringify(normalized) === JSON.stringify(result.cells[id] ?? null);
      })) {
        draftRef.current = {}; setDraft({}); baseVersion.current = undefined; rowFailed.current = false; setError(""); retain();
      }
      setRow(result); setStale(!!baseVersion.current && baseVersion.current !== result.version);
    }).catch(cause => { if (!cancelled) setError(cause.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; mounted.current = false; };
  }, [rowId, tableId, revision, key, t]);
  useEffect(() => subscribeDataChanges(change => {
    if (!(change.all || change.tableIds.includes(tableId))) return;
    if (Object.keys(draftRef.current).length || savingRef.current) setStale(true);
    else setRevision(v => v + 1);
  }), [tableId]);
  const dirty = Object.keys(draft).length > 0;
  useEffect(() => { onStateChange?.({ dirty: dirty || bodyState.dirty, busy: saving || flushing || pendingFiles.size > 0 || bodyState.busy }); }, [dirty, saving, flushing, pendingFiles.size, bodyState, onStateChange]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (workspaceUnloadApproved()) return; if (Object.keys(draftRef.current).length || savingRef.current || pendingFilesRef.current.size) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  const stage = (column: ColumnDef, value: CellValue) => {
    if (!row) return;
    baseVersion.current ??= row.version;
    const next = { ...draftRef.current };
    if (JSON.stringify(value) === JSON.stringify(row.cells[column.id] ?? null)) delete next[column.id]; else next[column.id] = value;
    draftRef.current = next; setDraft(next); retain();
    if (!Object.keys(next).length) baseVersion.current = undefined;
  };
  const saveOnce = async (): Promise<boolean> => {
    if (!Object.keys(draftRef.current).length) return true;
    if (!row || savingRef.current || pendingFilesRef.current.size) return false;
    const cells = { ...draftRef.current };
    for (const column of row.columns.filter(c => c.type === "number" && Object.hasOwn(cells, c.id))) {
      const raw = String(cells[column.id] ?? "").trim();
      if (raw && (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw) || !Number.isFinite(Number(raw)))) { setError(t("needsNumber", { name: column.name })); rowFailed.current = true; return false; }
      cells[column.id] = raw ? Number(raw) : null;
    }
    savingRef.current = true; setSaving(true); setError("");
    try {
      const updated = await api.patchRow(rowId, { cells, expectedVersion: baseVersion.current ?? row.version });
      if (!mounted.current) return false;
      setRow({ ...updated, columns: row.columns }); draftRef.current = {}; setDraft({}); baseVersion.current = undefined; retain(); setStale(false); rowFailed.current = false; onSaved?.(); return true;
    } catch (cause) { rowFailed.current = true; if (mounted.current) setError(cause instanceof Error ? cause.message : t("saveFailed")); return false; }
    finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  };
  const save = () => {
    if (rowFlight.current) return rowFlight.current;
    const promise = saveOnce().finally(() => { rowFlight.current = null; });
    rowFlight.current = promise; return promise;
  };
  useEffect(() => {
    if (!dirty || rowFailed.current || saving || pendingFiles.size || !row) return;
    const timer = window.setTimeout(() => void save(), 900); return () => window.clearTimeout(timer);
  }, [draft, row, saving, pendingFiles.size]);
  const flush = async () => {
    setFlushing(true);
    try {
      // Sequential, separate CAS writes. A body failure never rolls back a committed attribute save.
      if (pendingFilesRef.current.size) await new Promise<void>(resolve => { fileWaiters.current.push(resolve); });
      const attributesSaved = await save();
      const bodySaved = await bodyRef.current?.flush() ?? !row;
      return attributesSaved && bodySaved;
    } finally { if (mounted.current) setFlushing(false); }
  };
  useImperativeHandle(ref, () => ({ flush }));
  const pageStatus = error || bodyState.status === "failed" || bodyState.status === "conflict" ? "failed" : saving || flushing || bodyState.busy ? "saving" : dirty || bodyState.dirty ? "unsaved" : loading || bodyState.status === "loading" ? "loading" : "saved";
  const titleColumn = row?.columns.find(c => c.id === titleColumnId) ?? row?.columns.find(c => c.type === "text");
  const control = (column: ColumnDef) => {
    const value = Object.hasOwn(draft, column.id) ? draft[column.id] : row?.cells[column.id] ?? null;
    const readOnly = ["formula", "rollup"].includes(column.type);
    return <Field key={column.id} className={cn("min-w-0", column !== titleColumn && "record-property grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)]")} data-record-field={column.id} data-disabled={saving || readOnly}>
      <FieldLabel className={column === titleColumn ? "sr-only" : "min-w-0 flex-wrap gap-1.5 py-1.5 text-muted-foreground"}><ColumnTypeIcon type={column.type} className="size-4" />{column.name}{readOnly && <span className="text-xs text-muted-foreground">{t("readonly")}</span>}</FieldLabel>
      {column === titleColumn ? <Input className="h-auto border-0 px-0 py-2 text-2xl font-semibold shadow-none md:text-2xl" aria-label={column.name} value={value == null ? "" : String(value)} disabled={saving} placeholder={t("untitled")} onChange={e => stage(column, e.target.value)} /> : readOnly ? <div className="min-h-8 px-2 py-1.5 text-sm"><CellDisplay column={column} value={value} relation={row?.relations?.[column.id]} members={members} /></div> : <div className="min-w-0" aria-label={column.name} inert={saving}>{column.type === "number" ? <Input size="sm" inputMode="decimal" aria-label={column.name} value={value == null ? "" : String(value)} aria-invalid={!!error.startsWith(column.name)} onChange={e => stage(column, e.target.value)} /> : column.type === "relation" ? <RelationPicker size="sm" column={column} value={Array.isArray(value) ? value : []} records={row?.relations?.[column.id]?.records} onChange={value => stage(column, value)} /> : <FormFieldControl size="sm" column={column} value={value} members={members} onChange={value => stage(column, value)} onPendingChange={pending => { const next = new Set(pendingFilesRef.current); if (pending) next.add(column.id); else next.delete(column.id); pendingFilesRef.current = next; setPendingFiles(next); if (!next.size) fileWaiters.current.splice(0).forEach(resolve => resolve()); }} />}</div>}
    </Field>;
  };
  return <div className="mx-auto flex w-full min-w-0 max-w-[720px] flex-col gap-3" data-testid="record-page">
    <div className="flex min-h-7 flex-wrap items-center justify-end gap-2"><p role="status" aria-live="polite" className={cn("text-xs text-muted-foreground", pageStatus === "failed" && "text-destructive")}>{t(`pageStatus.${pageStatus}`)}</p>{pageStatus === "failed" && <Button variant="outline" size="sm" disabled={saving || flushing || pendingFiles.size > 0 || !(dirty || bodyState.dirty)} onClick={() => void flush()}><Save />{t("retrySave")}</Button>}</div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading && !row && <p role="status" className="text-sm text-muted-foreground">{t("readingRecord")}</p>}
    {stale && <div className="flex flex-col gap-2 text-xs text-muted-foreground"><p>{t("staleRecordHint")}</p><Button variant="outline" size="sm" disabled={saving} onClick={() => { draftRef.current = {}; setDraft({}); baseVersion.current = undefined; rowFailed.current = false; setError(""); retain(); setRevision(v => v + 1); }}>{t("discardDraftReload")}</Button></div>}
    {row && <><FieldGroup className="gap-1">{titleColumn && control(titleColumn)}{row.columns.filter(c => !c.config.hidden && c !== titleColumn && !advancedColumnIds.includes(c.id)).map(control)}</FieldGroup>
      {!!advancedColumnIds.length && <Collapsible><CollapsibleTrigger asChild><Button variant="ghost" size="sm">{t("blogs:advanced")}</Button></CollapsibleTrigger><CollapsibleContent><FieldGroup className="gap-1 pt-2">{row.columns.filter(c => advancedColumnIds.includes(c.id) && c !== titleColumn).map(control)}</FieldGroup></CollapsibleContent></Collapsible>}
      <DocumentBody ref={bodyRef} embedded tableId={tableId} rowId={rowId} onStateChange={setBodyState} onRefresh={() => setRevision(v => v + 1)} refreshDisabled={loading || saving || dirty} />
    </>}
    {!row && !loading && <Button variant="outline" onClick={() => setRevision(v => v + 1)}>{t("retry")}</Button>}
  </div>;
}
