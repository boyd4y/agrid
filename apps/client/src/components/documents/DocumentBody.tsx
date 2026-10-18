import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Bold, Italic, Heading1, Heading2, Heading3, List, ListOrdered, Quote, Code, Link as LinkIcon, ImagePlus, History, BookOpen, Pencil, Undo2, Redo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { ToggleGroup, ToggleGroupItem } from "@tabdo/ui/components/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tabdo/ui/components/dialog";
import { Input } from "@tabdo/ui/components/input";
import { Field, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { Skeleton } from "@tabdo/ui/components/skeleton";
import { documentContentSchema, EMPTY_DOCUMENT, safeDocumentLink, type DocumentContent, type RecordDocument, type DocumentCommands, type DocumentResults } from "@tabdo/shared";
import { documentCommand, DocumentApiError } from "@/lib/document-api";
import { workspaceCacheKey, workspaceUnloadApproved } from "@/lib/workspace-scope";
import { documentExtensions } from "@/components/documents/document-extensions";
import "@/components/documents/document.css";

export type DocumentState = { dirty: boolean; busy: boolean; status?: string };
export type DocumentHandle = { flush(): Promise<boolean> };
type Scope = { tableId: string; rowId: string; onStateChange?(state: DocumentState): void; ref?: Ref<DocumentHandle>; embedded?: boolean };
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
  const [status, setStatus] = useState("loading"), [busy, setBusy] = useState(false), [readOnly, setReadOnly] = useState(false);
  const [tick, setTick] = useState(0), [history, setHistory] = useState<DocumentResults["listDocumentRevisions"] | null>(null), [historyOpen, setHistoryOpen] = useState(false), [historyBusy, setHistoryBusy] = useState(false);
  const [preview, setPreview] = useState<RecordDocument | null>(null), [linkOpen, setLinkOpen] = useState(false), [href, setHref] = useState("");
  const [loadRevision, setLoadRevision] = useState(0);
  const [pasteNotice, setPasteNotice] = useState(false);
  const [images, setImages] = useState<Record<string, string>>({});
  const draftKey = useRef(keyFor(scope)).current, mounted = useRef(true), composing = useRef(false), inFlight = useRef(false), version = useRef(0), dirty = useRef(false), conflicted = useRef(false), failed = useRef(false), pending = useRef<PendingSave | undefined>(undefined), content = useRef<DocumentContent>(EMPTY_DOCUMENT), fileInput = useRef<HTMLInputElement>(null);
  const identity = { tableId: scope.tableId, rowId: scope.rowId };
  const retain = useCallback(() => {
    try { if (dirty.current) sessionStorage.setItem(draftKey, JSON.stringify({ content: content.current, baseVersion: version.current, pending: pending.current })); else sessionStorage.removeItem(draftKey); }
    catch { setError(t("draftStorageFailed")); }
  }, [draftKey, t]);
  const editor = useEditor({ extensions: documentExtensions, content: EMPTY_DOCUMENT, editable: false, immediatelyRender: false,
    editorProps: { attributes: { class: "document-prose", "data-placeholder": t("placeholder"), "aria-label": t("body"), role: "textbox", "aria-multiline": "true" },
      handleDOMEvents: { compositionstart: () => { composing.current = true; return false; }, compositionend: () => { composing.current = false; setTick(v => v + 1); return false; } },
      handlePaste: (_view, event) => { if (event.clipboardData?.getData("text/html")) setPasteNotice(true); if (event.clipboardData?.files.length) { setError(t("pasteImages")); return true; } return false; },
    },
    onUpdate: ({ editor }) => { if (preview) return; content.current = editor.getJSON() as DocumentContent; dirty.current = true; failed.current = conflicted.current; setStatus(conflicted.current ? "conflict" : "unsaved"); retain(); setTick(v => v + 1); },
  });
  const selection = useEditorState({ editor, selector: ({ editor }) => editor ? { marks: ["bold", "italic"].filter(mark => editor.isActive(mark)), heading: [1, 2, 3].find(level => editor.isActive("heading", { level })), bullet: editor.isActive("bulletList"), ordered: editor.isActive("orderedList"), quote: editor.isActive("blockquote"), code: editor.isActive("codeBlock") } : null });
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
    editor.setEditable(!readOnly && !preview && !busy, false);
  }, [editor, doc, readOnly, preview, busy]);
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
    if (doc === undefined || !dirty.current || failed.current || composing.current || busy || preview || readOnly) return;
    const timer = window.setTimeout(() => void save(), 900); return () => window.clearTimeout(timer);
  }, [tick, doc, busy, preview, readOnly]);
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
  const loadHistory = async (append = false) => {
    if (historyBusy) return; setHistoryBusy(true); setError("");
    try {
      const page = await documentCommand("listDocumentRevisions", { ...identity, ...(append && history?.nextBeforeVersion ? { beforeVersion: history.nextBeforeVersion } : {}) });
      if (mounted.current) { setHistory(previous => append && previous ? { ...page, items: [...previous.items, ...page.items] } : page); setHistoryOpen(true); }
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { if (mounted.current) setHistoryBusy(false); }
  };
  const viewVersion = async (v?: number) => {
    setHistoryBusy(true); setError("");
    try {
      const value = v === undefined ? await documentCommand("getDocument", identity) : await documentCommand("getDocumentRevision", { ...identity, version: v });
      if (mounted.current && value) { setPreview(value); editor?.commands.setContent(value.content, { emitUpdate: false }); }
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { if (mounted.current) setHistoryBusy(false); }
  };
  const backToDraft = () => { editor?.commands.setContent(content.current, { emitUpdate: false }); setPreview(null); };
  const restore = async () => {
    if (!preview || dirty.current || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const saved = await documentCommand("restoreDocumentRevision", { ...identity, version: preview.version, expectedVersion: version.current, idempotencyKey: crypto.randomUUID() });
      if (!mounted.current) return;
      version.current = saved.version; content.current = preview.content; setDoc({ ...preview, version: saved.version }); setPreview(null); setStatus("saved"); setHistoryOpen(false);
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const uploadOnce = async (file?: File) => {
    if (!file || doc === undefined || inFlight.current || dirty.current) { setError(t("saveBeforeImage")); return; }
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
  const toolbarDisabled = busy || readOnly || !!preview || doc === undefined;
  return <div data-testid="document-editor" data-document-root className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
          <p hidden={scope.embedded} role="status" aria-live="polite" className="text-xs text-muted-foreground">{t(`status.${status}`)}</p>
          {doc !== undefined && <div className="flex flex-wrap gap-1">
            <Button variant="ghost" size="sm" disabled={busy || historyBusy} onClick={() => setReadOnly(v => !v)}>{readOnly ? <Pencil /> : <BookOpen />}{readOnly ? t("edit") : t("read")}</Button>
            <Button variant="ghost" size="sm" disabled={busy || historyBusy || !doc} onClick={() => void loadHistory()}><History />{t("history")}</Button>
            <Button hidden={scope.embedded} variant="outline" size="sm" disabled={busy || status === "saving" || !dirty.current || status === "conflict"} onClick={() => void save()}>{t("save")}</Button>
          </div>}
        </div>
        {error && <div role="alert" className="flex flex-col gap-2 border-b px-5 py-3 text-sm text-destructive"><p>{error}</p>{status === "conflict" && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={historyBusy} onClick={() => void viewVersion()}>{t("viewServer")}</Button><Button size="sm" variant="outline" onClick={exportDraft}>{t("downloadDraft")}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void exportAndReload()}>{t("downloadAndReload")}</Button></div>}</div>}
        {doc === undefined ? <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-8"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" />{error && <Button variant="outline" onClick={() => setLoadRevision(v => v + 1)}>{t("table:retry")}</Button>}</div> : <>
          {!readOnly && !preview && <div aria-label={t("formatting")} className="flex flex-wrap items-center gap-1 border-b px-3 py-2">
            <ToggleGroup type="multiple" size="sm" value={selection?.marks ?? []} disabled={toolbarDisabled} onValueChange={values => { if (values.includes("bold") !== !!selection?.marks.includes("bold")) editor?.chain().focus().toggleBold().run(); if (values.includes("italic") !== !!selection?.marks.includes("italic")) editor?.chain().focus().toggleItalic().run(); }}><ToggleGroupItem value="bold" aria-label={t("bold")}><Bold className="size-4" /></ToggleGroupItem><ToggleGroupItem value="italic" aria-label={t("italic")}><Italic className="size-4" /></ToggleGroupItem></ToggleGroup>
            <ToggleGroup type="single" size="sm" value={String(selection?.heading ?? "")} disabled={toolbarDisabled} onValueChange={value => { const level = Number(value || selection?.heading) as 1 | 2 | 3; editor?.chain().focus().toggleHeading({ level }).run(); }}>{[Heading1, Heading2, Heading3].map((Icon, i) => <ToggleGroupItem key={i} value={String(i + 1)} aria-label={t("heading", { level: i + 1 })}><Icon className="size-4" /></ToggleGroupItem>)}</ToggleGroup>
            <ToggleGroup type="multiple" size="sm" disabled={toolbarDisabled} value={[selection?.bullet && "bullet", selection?.ordered && "ordered", selection?.quote && "quote", selection?.code && "code"].filter(Boolean) as string[]} onValueChange={values => { if (values.includes("bullet") !== !!selection?.bullet) editor?.chain().focus().toggleBulletList().run(); else if (values.includes("ordered") !== !!selection?.ordered) editor?.chain().focus().toggleOrderedList().run(); else if (values.includes("quote") !== !!selection?.quote) editor?.chain().focus().toggleBlockquote().run(); else if (values.includes("code") !== !!selection?.code) editor?.chain().focus().toggleCodeBlock().run(); }}>
              <ToggleGroupItem value="bullet" aria-label={t("bulletList")}><List className="size-4" /></ToggleGroupItem><ToggleGroupItem value="ordered" aria-label={t("orderedList")}><ListOrdered className="size-4" /></ToggleGroupItem><ToggleGroupItem value="quote" aria-label={t("quote")}><Quote className="size-4" /></ToggleGroupItem><ToggleGroupItem value="code" aria-label={t("codeBlock")}><Code className="size-4" /></ToggleGroupItem>
            </ToggleGroup>
            <Button variant="ghost" size="icon" disabled={toolbarDisabled} aria-label={t("link")} onClick={() => { setHref(editor?.getAttributes("link").href ?? ""); setLinkOpen(true); }}><LinkIcon /></Button>
            <Button variant="ghost" size="icon" disabled={toolbarDisabled || dirty.current || status === "saving" || status === "conflict"} aria-label={t("image")} onClick={() => fileInput.current?.click()}><ImagePlus /></Button>
            <Button variant="ghost" size="icon" disabled={toolbarDisabled || !editor?.can().undo()} aria-label={t("undo")} onClick={() => editor?.chain().focus().undo().run()}><Undo2 /></Button>
            <Button variant="ghost" size="icon" disabled={toolbarDisabled || !editor?.can().redo()} aria-label={t("redo")} onClick={() => editor?.chain().focus().redo().run()}><Redo2 /></Button>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" tabIndex={-1} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
          </div>}
          {preview && <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3"><p className="mr-auto text-sm">{t("previewVersion", { version: preview.version })}</p><Button variant="outline" size="sm" disabled={busy} onClick={backToDraft}>{t("backToDraft")}</Button><Button size="sm" disabled={busy || dirty.current} onClick={() => void restore()}>{t("restore")}</Button>{dirty.current && <p className="w-full text-xs text-muted-foreground">{t("restoreDirty")}</p>}</div>}
          {pasteNotice && <div role="status" className="flex items-center gap-2 border-b px-5 py-2 text-xs text-muted-foreground"><p className="flex-1">{t("pasteNotice")}</p><Button variant="ghost" size="sm" onClick={() => setPasteNotice(false)}>{t("dismiss")}</Button></div>}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
            {historyOpen && <aside aria-label={t("history")} className="flex max-h-40 w-full shrink-0 flex-col gap-2 overflow-y-auto border-b p-3 sm:max-h-none sm:w-48 sm:border-r sm:border-b-0"><Button variant="ghost" size="sm" onClick={() => setHistoryOpen(false)}>{t("closeHistory")}</Button>{history?.items.map(item => <Button key={item.version} variant="ghost" className="h-auto flex-col items-start gap-1" disabled={historyBusy || busy} onClick={() => void viewVersion(item.version)}><span>v{item.version}</span><span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span></Button>)}{history?.hasMore && <Button variant="outline" size="sm" disabled={historyBusy} onClick={() => void loadHistory(true)}>{t("moreHistory")}</Button>}</aside>}
            <div className="min-w-0 flex-1"><div className="mx-auto max-w-[72ch] px-5 py-8 sm:px-8"><EditorContent editor={editor} /></div></div>
          </div>
          <p className="border-t px-5 py-2 text-xs text-muted-foreground">{busy ? t("uploading") : dirty.current ? t("draftRetained") : t("budget")}</p>
        </>}
        <div hidden aria-hidden="true">{Object.entries(images).map(([id, url]) => <img key={id} data-private-source={id} src={url} alt="" />)}</div>
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent closeLabel={t("close")}><DialogHeader><DialogTitle>{t("link")}</DialogTitle><DialogDescription>{t("linkHint")}</DialogDescription></DialogHeader><form noValidate onSubmit={event => { event.preventDefault(); if (href && !safeDocumentLink(href)) return; const chain = editor?.chain().focus().extendMarkRange("link"); if (href) chain?.setLink({ href }).run(); else chain?.unsetLink().run(); setLinkOpen(false); }}><FieldGroup><Field><FieldLabel htmlFor="document-link">{t("url")}</FieldLabel><Input id="document-link" value={href} aria-invalid={!!href && !safeDocumentLink(href)} onChange={event => setHref(event.target.value)} autoFocus /></Field><Button type="submit" disabled={!!href && !safeDocumentLink(href)}>{href ? t("applyLink") : t("removeLink")}</Button></FieldGroup></form></DialogContent></Dialog>
  </div>;
}
