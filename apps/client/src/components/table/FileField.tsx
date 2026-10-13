import { useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, RotateCcw, Upload, X } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { Badge } from "@tabdo/ui/components/badge";
import { Popover, PopoverAnchor, PopoverContent } from "@tabdo/ui/components/popover";
import type { StoredFile } from "@tabdo/shared";
import type { CellValue, ColumnDef } from "@/types/table";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { useTranslation } from "react-i18next";

// Coalesce the visible grid's metadata requests instead of fetching once per cell.
const metadata = new Map<string, StoredFile>();
const unavailable = new Map<string, number>();
let tenantScope: string | undefined, cacheGeneration = 0;
const queued = new Set<string>();
const fetching = new Set<string>();
const listeners = new Set<() => void>();
let scheduled = false;
const notify = () => listeners.forEach(listener => listener());
function remember(files: StoredFile[]) { files.forEach(file => { metadata.set(file.id, file); unavailable.delete(file.id); }); notify(); }
function requestFiles(ids: string[]) {
  ids.forEach(id => { if (!metadata.has(id) && (unavailable.get(id) ?? 0) < Date.now() && !fetching.has(id)) queued.add(id); });
  if (scheduled || !queued.size) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const allIds = [...queued], generation = cacheGeneration; queued.clear(); allIds.forEach(id => fetching.add(id));
    for (let start = 0; start < allIds.length; start += 100) {
      const ids = allIds.slice(start, start + 100);
      void api.getFiles(ids).then(({ files }) => {
        if (generation !== cacheGeneration) return;
        remember(files);
        ids.forEach(id => { if (!metadata.has(id)) unavailable.set(id, Date.now() + 15_000); });
      }).catch(() => { if (generation === cacheGeneration) ids.forEach(id => unavailable.set(id, Date.now() + 15_000)); }).finally(() => { if (generation === cacheGeneration) { ids.forEach(id => fetching.delete(id)); notify(); } });
    }
  });
}
function useFiles(ids: string[]) {
  const { data: session } = useSession();
  const scope = `${session?.user.id ?? ""}:${session?.session.activeOrganizationId ?? ""}`;
  if (tenantScope !== scope) { tenantScope = scope; cacheGeneration++; metadata.clear(); unavailable.clear(); queued.clear(); fetching.clear(); }
  const [, refresh] = useState(0);
  const key = ids.join(",");
  useEffect(() => { const listener = () => refresh(value => value + 1); listeners.add(listener); requestFiles(ids); return () => { listeners.delete(listener); }; }, [key, scope]);
  return { files: ids.map(id => metadata.get(id)), retry: () => { ids.forEach(id => unavailable.delete(id)); requestFiles(ids); } };
}
function idsFor(value: CellValue) { return Array.isArray(value) ? value : []; }

export function FileDisplay({ value }: { value: CellValue }) {
  const { t } = useTranslation("table"), ids = idsFor(value);
  const { files, retry } = useFiles(ids);
  if (!ids.length) return null;
  const first = files[0];
  return <div className="flex min-w-0 items-center gap-1" data-testid="file-display">
    {first ? <a href={api.fileDownloadUrl(first.id)} download title={first.name} data-file-id={first.id} className="flex min-w-0 items-center gap-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={event => event.stopPropagation()}><Paperclip className="size-3.5 shrink-0" /><span className="truncate text-sm">{first.name}</span></a> : unavailable.has(ids[0]) ? <Button variant="ghost" size="sm" onClick={event => { event.stopPropagation(); retry(); }}>{t("files.unavailable")}</Button> : <span className="truncate text-sm text-muted-foreground">{t("files.loading")}</span>}
    {ids.length > 1 && <Badge variant="secondary" className="shrink-0">+{ids.length - 1}</Badge>}
  </div>;
}

export function FileEditor({ column, value, onChange, onPendingChange, disabled = false, size = "default" }: {
  column: ColumnDef; value: CellValue; onChange: (value: string[]) => void | Promise<void>;
  onPendingChange?: (pending: boolean) => void; disabled?: boolean; size?: "default" | "sm";
}) {
  const { t } = useTranslation("table");
  const [draft, setDraft] = useState(idsFor(value)), [pending, setPending] = useState(false), [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null), [unsaved, setUnsaved] = useState(false), [retryFiles, setRetryFiles] = useState<File[]>([]);
  const input = useRef<HTMLInputElement>(null), alive = useRef(true), busy = useRef(false), dirty = useRef(false), pendingCallback = useRef(onPendingChange);
  pendingCallback.current = onPendingChange;
  const { files, retry: retryMetadata } = useFiles(draft);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pendingCallback.current?.(false); }; }, []);
  useEffect(() => { if (!dirty.current) setDraft(idsFor(value)); }, [JSON.stringify(value)]);
  const run = async (next: string[] | null, selected: File[] = []) => {
    if (busy.current || disabled) return;
    busy.current = true; setPending(true); pendingCallback.current?.(true); setError(null); setProgress(0);
    const generation = cacheGeneration;
    try {
      if (selected.length) {
        const { files } = await api.uploadFiles(column.tableId, column.id, selected, percent => { if (alive.current) setProgress(percent); });
        if (!alive.current || generation !== cacheGeneration) return;
        remember(files);
        next = column.config.file?.multiple === false ? files.map(file => file.id) : [...new Set([...draft, ...files.map(file => file.id)])];
        setRetryFiles([]);
      }
      if (!alive.current || !next) return;
      dirty.current = true; setDraft(next); setUnsaved(true);
      await onChange(next);
      if (!alive.current) return;
      dirty.current = false; setUnsaved(false);
    } catch (error) {
      if (!alive.current) return;
      if (selected.length && next === null) setRetryFiles(selected);
      setError(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      busy.current = false;
      if (alive.current) { setPending(false); pendingCallback.current?.(false); }
    }
  };
  return <div className="flex min-w-0 flex-col gap-2" data-testid="file-editor" aria-busy={pending}>
    {draft.map((id, index) => <div key={id} data-file-id={id} className="flex min-w-0 items-center gap-2">
      {files[index] ? <a href={api.fileDownloadUrl(id)} download title={files[index]!.name} className="flex min-w-0 flex-1 items-center gap-1 text-sm" onClick={event => event.stopPropagation()}><Paperclip className="size-4 shrink-0" /><span className="truncate">{files[index]!.name}</span></a> : unavailable.has(id) ? <Button variant="ghost" size="sm" className="min-w-0 flex-1" onClick={retryMetadata}>{t("files.unavailable")}</Button> : <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{t("files.loading")}</span>}
      <Button type="button" variant="ghost" size="icon" disabled={disabled || pending} aria-label={t("files.remove", { name: files[index]?.name ?? t("columnTypes.file") })} onClick={() => void run(draft.filter(fileId => fileId !== id))}><X /></Button>
    </div>)}
    <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label={t("files.upload")} multiple={column.config.file?.multiple !== false} disabled={disabled || pending} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void run(null, files); }} />
    <Button type="button" variant="outline" size={size} disabled={disabled || pending} onClick={() => input.current?.click()}>{pending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Upload data-icon="inline-start" />}{pending ? t("files.uploading", { progress }) : t("files.upload")}</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {(unsaved || retryFiles.length > 0) && <Button type="button" variant="outline" size="sm" disabled={disabled || pending} onClick={() => void run(retryFiles.length ? null : draft, retryFiles)}><RotateCcw data-icon="inline-start" />{t("retry")}</Button>}
  </div>;
}

export function FileCellEditor({ column, value, onChange, onClose }: { column: ColumnDef; value: CellValue; onChange: (value: CellValue) => void | Promise<void>; onClose: () => void }) {
  const [pending, setPending] = useState(false);
  return <Popover open onOpenChange={open => { if (!open && !pending) onClose(); }}><PopoverAnchor asChild><span className="h-full w-full" /></PopoverAnchor><PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-3" align="start" onPointerDownOutside={event => { if (pending) event.preventDefault(); }} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}><FileEditor column={column} value={value} onChange={onChange} onPendingChange={setPending} size="sm" /></PopoverContent></Popover>;
}
