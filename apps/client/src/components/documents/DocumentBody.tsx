import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { RichTextEditor, useRichTextEditor, type RichTextLabels } from "@tabdo/ui/components/rich-text-editor";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Skeleton } from "@tabdo/ui/components/skeleton";
import { documentContentSchema, EMPTY_DOCUMENT, safeDocumentLink, type DocumentContent, type RecordDocument, type DocumentCommands } from "@tabdo/shared";
import { documentCommand, DocumentApiError } from "@/lib/document-api";
import { workspaceCacheKey, workspaceUnloadApproved } from "@/lib/workspace-scope";

export type DocumentState = { dirty: boolean; busy: boolean; status?: string };
export type DocumentHandle = { flush(): Promise<boolean> };
type Scope = { tableId: string; rowId: string; onStateChange?(state: DocumentState): void; ref?: Ref<DocumentHandle>; embedded?: boolean; onRefresh?(): void; refreshDisabled?: boolean };
type PendingSave = DocumentCommands["replaceDocument"];
type Draft = { content: DocumentContent; baseVersion: number; pending?: PendingSave };
const keyFor = (scope: Scope) => `tabdo.document-draft:${workspaceCacheKey()}:${scope.tableId}:${scope.rowId}`;
function readDraft(key: string): Draft | null {
  try { const value = JSON.parse(sessionStorage.getItem(key) ?? "null"); return value && Number.isInteger(value.baseVersion) && documentContentSchema.safeParse(value.content).success ? value : null; } catch { return null; }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export default function DocumentBody(scope: Scope) {
  const { t } = useTranslation("documents");
  const [doc, setDoc] = useState<RecordDocument | null>(), [error, setError] = useState("");
  const [status, setStatus] = useState("loading"), [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0), [comparing, setComparing] = useState(false);
  const [preview, setPreview] = useState<RecordDocument | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [pasteNotice, setPasteNotice] = useState(false);
  const [images, setImages] = useState<Record<string, string>>({});
  const draftKey = useRef(keyFor(scope)).current, mounted = useRef(true), composing = useRef(false), inFlight = useRef(false), version = useRef(0), dirty = useRef(false), conflicted = useRef(false), failed = useRef(false), pending = useRef<PendingSave | undefined>(undefined), content = useRef<DocumentContent>(EMPTY_DOCUMENT), fileInput = useRef<HTMLInputElement>(null);
  const identity = { tableId: scope.tableId, rowId: scope.rowId };
  const retain = useCallback(() => {
    try { if (dirty.current) sessionStorage.setItem(draftKey, JSON.stringify({ content: content.current, baseVersion: version.current, pending: pending.current })); else sessionStorage.removeItem(draftKey); }
    catch { setError(t("draftStorageFailed")); }
  }, [draftKey, t]);
  const editor = useRichTextEditor({ isAllowedUri: safeDocumentLink, content: EMPTY_DOCUMENT, editable: false, immediatelyRender: false,
    editorProps: { attributes: { "data-placeholder": t("placeholder"), "aria-label": t("body"), role: "textbox", "aria-multiline": "true" },
      handleDOMEvents: { compositionstart: () => { composing.current = true; return false; }, compositionend: () => { composing.current = false; setTick(v => v + 1); return false; } },
      handlePaste: (_view, event) => { if (event.clipboardData?.getData("text/html")) setPasteNotice(true); if (event.clipboardData?.files.length) { setError(t("pasteImages")); return true; } return false; },
    },
    onUpdate: ({ editor }) => { if (preview) return; content.current = editor.getJSON() as DocumentContent; dirty.current = true; failed.current = conflicted.current; setStatus(conflicted.current ? "conflict" : "unsaved"); retain(); setTick(v => v + 1); },
  });

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void documentCommand("getDocument", identity, controller.signal).then(value => {
      if (!mounted.current || !editor) return;
      setDoc(value); setError("");
      const draft = readDraft(draftKey); version.current = draft?.baseVersion ?? value?.version ?? 0; content.current = draft?.content ?? value?.content ?? EMPTY_DOCUMENT; pending.current = draft?.pending; dirty.current = !!draft;
      editor.commands.setContent(content.current, { emitUpdate: false });
      const conflict = !!draft && (value?.version ?? 0) !== draft.baseVersion && !(draft.pending && same(value?.content, draft.pending.content) && value?.version === draft.pending.expectedVersion + 1);
      if (draft?.pending && value?.version === draft.pending.expectedVersion + 1 && same(value?.content, draft.pending.content)) { version.current = value.version; pending.current = undefined; dirty.current = !same(content.current, value.content); retain(); }
      conflicted.current = conflict; failed.current = conflict; setStatus(conflict ? "conflict" : dirty.current ? "unsaved" : "saved");
      if (conflict) setError(t("errors.VERSION_CONFLICT"));
      editor.setEditable(true, false); setTick(v => v + 1);
    }).catch(cause => { if (mounted.current && cause.name !== "AbortError") { setError(cause.message); setStatus("failed"); } });
    return () => { mounted.current = false; controller.abort(); };
  }, [editor, loadRevision]);
  useEffect(() => {
    if (doc === undefined || !editor) return;
    editor.setEditable(!preview && !busy, false);
  }, [editor, doc, preview, busy]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (workspaceUnloadApproved()) return; if (dirty.current || inFlight.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  const saveFlight = useRef<Promise<boolean> | null>(null), uploadFlight = useRef<Promise<void> | null>(null);
  const saveOnce = async (): Promise<boolean> => {
    if (!dirty.current) return true;
    if (!editor || doc === undefined || inFlight.current || composing.current || conflicted.current) return false;
    const problem = documentContentSchema.safeParse(content.current);
    if (!problem.success) { setError(t("errors.BAD_INPUT")); setStatus("failed"); failed.current = true; return false; }
    const sent = pending.current ?? { ...identity, content: structuredClone(content.current), expectedVersion: version.current, idempotencyKey: crypto.randomUUID() };
    pending.current = sent; retain(); inFlight.current = true; setStatus("saving"); setError("");
    try {
      const saved = await documentCommand("replaceDocument", sent);
      if (!mounted.current) return false;
      version.current = saved.version; pending.current = undefined; dirty.current = !same(content.current, sent.content); failed.current = false;
      setDoc({ ...saved, content: sent.content as DocumentContent, updatedAt: new Date().toISOString() });
      setStatus(dirty.current ? "unsaved" : "saved"); retain(); return true;
    } catch (cause) {
      if (!mounted.current) return false;
      conflicted.current = cause instanceof DocumentApiError && cause.code === "VERSION_CONFLICT"; failed.current = true; setStatus(conflicted.current ? "conflict" : "failed"); setError(cause instanceof Error ? cause.message : t("errors.REQUEST_FAILED")); retain(); return false;
    } finally { inFlight.current = false; if (mounted.current) setTick(v => v + 1); }
  };
  const save = () => {
    if (saveFlight.current) return saveFlight.current;
    const promise = saveOnce().finally(() => { saveFlight.current = null; });
    saveFlight.current = promise; return promise;
  };
  const flush = async () => {
    if (uploadFlight.current) await uploadFlight.current;
    if (saveFlight.current && !await saveFlight.current) return false;
    while (dirty.current) { if (!await save()) return false; }
    return !inFlight.current;
  };
  useImperativeHandle(scope.ref, () => ({ flush }));
  useEffect(() => {
    if (doc === undefined || !dirty.current || failed.current || composing.current || busy || preview) return;
    const timer = window.setTimeout(() => void save(), 900); return () => window.clearTimeout(timer);
  }, [tick, doc, busy, preview]);
  // File bytes are fetched only for this document; object URLs never enter persisted content.
  useEffect(() => {
    if (!doc) return;
    const ids = new Set<string>(), stack = [...(preview?.content ?? content.current).content];
    while (stack.length) { const node = stack.pop()!; if (node.type === "image") ids.add(String(node.attrs!.fileId)); stack.push(...node.content ?? []); }
    const controller = new AbortController();
    for (const fileId of ids) if (!images[fileId]) void documentCommand("getDocumentImage", { ...identity, fileId }, controller.signal).then(image => {
      if (!mounted.current) return;
      const bytes = Uint8Array.from(atob(image.base64), c => c.charCodeAt(0));
      setImages(previous => ({ ...previous, [fileId]: URL.createObjectURL(new Blob([bytes], { type: image.mimeType })) }));
    }).catch(cause => { if (mounted.current && cause.name !== "AbortError") setError(cause.message); });
    return () => controller.abort();
  }, [doc?.id, tick, preview]);
  const imageUrls = useRef(images); imageUrls.current = images;
  useEffect(() => () => Object.values(imageUrls.current).forEach(url => URL.revokeObjectURL(url)), []);
  const viewServer = async () => {
    setComparing(true); setError("");
    try {
      const value = await documentCommand("getDocument", identity);
      if (mounted.current && value) { setPreview(value); editor?.commands.setContent(value.content, { emitUpdate: false }); }
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { if (mounted.current) setComparing(false); }
  };
  const backToDraft = () => { editor?.commands.setContent(content.current, { emitUpdate: false }); setPreview(null); };
  const uploadOnce = async (file?: File) => {
    if (!file) return;
    if (doc === undefined || conflicted.current || composing.current) { setError(t("saveBeforeImage")); return; }
    // The slash prefix was removed immediately before opening the existing file picker.
    // Drain that edit through the same CAS/idempotent save path before authorizing the upload.
    if (saveFlight.current && !await saveFlight.current) return;
    while (dirty.current) { if (!await save()) return; }
    if (inFlight.current) { setError(t("saveBeforeImage")); return; }
    if (file.size > 5 * 1024 * 1024) { setError(t("imageBudget")); return; }
    setBusy(true); inFlight.current = true; setError("");
    try {
      if (!doc) {
        const saved = await documentCommand("replaceDocument", { ...identity, content: EMPTY_DOCUMENT, expectedVersion: 0, idempotencyKey: crypto.randomUUID() });
        version.current = saved.version;
        if (!mounted.current) return;
        setDoc({ ...saved, content: EMPTY_DOCUMENT, updatedAt: new Date().toISOString() });
      }
      const buffer = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (let i = 0; i < buffer.length; i += 8192) binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
      const image = await documentCommand("uploadDocumentImage", { ...identity, name: file.name, mimeType: file.type as "image/png", base64: btoa(binary), expectedVersion: version.current, idempotencyKey: crypto.randomUUID() });
      if (!mounted.current) return;
      setImages(previous => ({ ...previous, [image.fileId]: URL.createObjectURL(file) }));
      editor?.chain().focus().insertContent({ type: "image", attrs: { fileId: image.fileId, alt: file.name } }).run();
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { inFlight.current = false; if (mounted.current) { setBusy(false); setTick(v => v + 1); } }
  };
  const upload = (file?: File) => {
    const promise = uploadOnce(file).finally(() => { uploadFlight.current = null; });
    uploadFlight.current = promise; return promise;
  };
  const exportDraft = () => { const blob = new Blob([JSON.stringify(content.current, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "document-draft.json"; a.click(); URL.revokeObjectURL(url); };
  const exportAndReload = async () => {
    if (inFlight.current) return;
    exportDraft(); setBusy(true); inFlight.current = true;
    try {
      const value = await documentCommand("getDocument", identity);
      if (!mounted.current || !value) return;
      content.current = value.content; version.current = value.version; dirty.current = false; pending.current = undefined; conflicted.current = false; failed.current = false; retain();
      editor?.commands.setContent(value.content, { emitUpdate: false }); setDoc(value); setPreview(null); setStatus("saved"); setError("");
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => { scope.onStateChange?.({ dirty: dirty.current, busy: busy || inFlight.current, status }); }, [tick, busy, status, scope.onStateChange]);
  const toolbarDisabled = busy || !!preview || doc === undefined;
  const labels: RichTextLabels = { paragraph: t("paragraph"), underline: t("underline"), strike: t("strike"), code: t("code"), horizontalRule: t("horizontalRule"), alignment: t("alignment"), colorHighlight: t("colorHighlight"), color: t("color"), highlight: t("highlight"), defaultColor: t("defaultColor"), searchReplace: t("searchReplace"), search: t("search"), replaceWith: t("replaceWith"), replace: t("replace"), replaceAll: t("replaceAll"), previousMatch: t("previousMatch"), nextMatch: t("nextMatch"), matchCase: t("matchCase"), slashCommands: t("slashCommands"), noResults: t("noResults"), basicBlocks: t("basicBlocks"), inline: t("inline"), align: value => t(value), colorName: name => t(`colors.${name}`), commandDescription: key => t(`commands.${key}`), insertFormat: t("insertFormat"), formatting: t("formatting"), selectionFormatting: t("selectionFormatting"), bold: t("bold"), italic: t("italic"), heading: level => t("heading", { level }), bulletList: t("bulletList"), orderedList: t("orderedList"), quote: t("quote"), codeBlock: t("codeBlock"), link: t("link"), image: t("image"), undo: t("undo"), redo: t("redo"), close: t("close"), linkHint: t("linkHint"), url: t("url"), applyLink: t("applyLink"), removeLink: t("removeLink") };
  const actions = <>
    {scope.onRefresh && <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("table:refreshRecord")} title={t("table:refreshRecord")} disabled={scope.refreshDisabled} onClick={scope.onRefresh}><RefreshCw /></Button>}
    {!scope.embedded && <Button type="button" variant="ghost" size="sm" disabled={busy || status === "saving" || !dirty.current || status === "conflict"} onClick={() => void save()}>{t("save")}</Button>}
  </>;
  return <div data-testid="document-editor" className="flex min-w-0 flex-col">
    {!scope.embedded && <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{t(`status.${status}`)}</p>}
    {error && <div role="alert" className="flex flex-col gap-2 py-3 text-sm text-destructive"><p>{error}</p>{status === "conflict" && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={comparing} onClick={() => void viewServer()}>{t("viewServer")}</Button><Button size="sm" variant="outline" onClick={exportDraft}>{t("downloadDraft")}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void exportAndReload()}>{t("downloadAndReload")}</Button></div>}</div>}
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" tabIndex={-1} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
    {doc === undefined ? <div className="flex flex-col gap-4 py-8"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" />{error && <Button variant="outline" onClick={() => setLoadRevision(v => v + 1)}>{t("table:retry")}</Button>}</div> : <>
      {preview && <div className="flex flex-wrap items-center gap-2 py-3"><p className="mr-auto text-sm">{t("comparingServer")}</p><Button variant="outline" size="sm" disabled={busy} onClick={backToDraft}>{t("backToDraft")}</Button></div>}
      {pasteNotice && <div role="status" className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><p className="flex-1">{t("pasteNotice")}</p><Button variant="ghost" size="sm" onClick={() => setPasteNotice(false)}>{t("dismiss")}</Button></div>}
      <RichTextEditor editor={editor} labels={labels} disabled={toolbarDisabled} isAllowedUri={safeDocumentLink} onImage={() => fileInput.current?.click()} imageDisabled={status === "conflict"} imageSources={images} actions={actions} />
      {busy && <p role="status" className="text-xs text-muted-foreground">{t("uploading")}</p>}
    </>}
  </div>;
}
