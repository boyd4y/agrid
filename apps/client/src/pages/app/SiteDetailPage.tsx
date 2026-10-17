import { BlogEditor } from "@/components/sites/BlogEditor";
import { useAuth } from "@/hooks/useAuth";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Code2, Download, ExternalLink, Eye, FileCode2, History, Link2, Plus, RotateCcw, Save, Trash2, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { SiteDetail, SiteSourceFile } from "@tabdo/shared";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { CodeEditor } from "@tabdo/ui/components/code-editor";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@tabdo/ui/components/dialog";
import { Field, FieldLabel } from "@tabdo/ui/components/field";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@tabdo/ui/components/tabs";
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from "@tabdo/ui/components/resizable";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from "@tabdo/ui/components/dropdown-menu";
import { SitePreview } from "@/components/sites/SitePreview";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { ListPagination } from "@/components/controls/list-pagination";
import { useArrayPagination } from "@/hooks/useListPagination";
import { subscribeDataChanges } from "@/lib/data-changes";
import { api } from "@/lib/api";

export function SiteDetailPage() {
  const { siteId } = useParams();
  return siteId ? <SiteEditor key={siteId} siteId={siteId} /> : null;
}
function SiteEditor({ siteId }: { siteId: string }) {
  const { t } = useTranslation("sites");
  const [site, setSite] = useState<SiteDetail | null>(null), [files, setFiles] = useState<SiteSourceFile[]>([]), [name, setName] = useState("");
  const [selected, setSelected] = useState("index.html"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState("files"), [mobileTab, setMobileTab] = useState("code");
  const [adding, setAdding] = useState(false), [path, setPath] = useState(""), [fileError, setFileError] = useState(""), [removing, setRemoving] = useState<string | null>(null);
  const [publishDialog, setPublishDialog] = useState(false), [dataDialog, setDataDialog] = useState(false), [apiKey, setApiKey] = useState("");
  const wide = useMediaQuery("(min-width: 1024px)");
  const [historical, setHistorical] = useState<SiteDetail | null>(null);
  const { user } = useAuth();
  const draftKey = `tabdo.site-draft.${user?.id ?? ""}.${siteId}`;
  const recovered = useRef(false), loadGeneration = useRef(0);
  const [draftVersion, setDraftVersion] = useState<number | null>(null), [discarding, setDiscarding] = useState(false);
  const dirty = !!site && (site.name !== name || JSON.stringify(site.files) !== JSON.stringify(files));
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const history = useArrayPagination(site?.revisions ?? [], 10);
  const apply = useCallback((next: SiteDetail) => { setSite(next); setFiles(next.files); setName(next.name); setError(""); setHistorical(null); setDraftVersion(null); }, []);
  const load = useCallback(async () => { const current = ++loadGeneration.current; try {
    const next = await api.getSite(siteId); if (current !== loadGeneration.current) return; apply(next);
    if (!recovered.current) {
      recovered.current = true;
      try { const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "null");
        if (saved && typeof saved.name === "string" && Array.isArray(saved.files) && typeof saved.version === "number") { setName(saved.name); setFiles(saved.files); setDraftVersion(saved.version); }
      } catch { /* The saved server version remains usable. */ }
    }
  } catch(e) { if (current === loadGeneration.current) setError((e as Error).message); } }, [siteId, apply, draftKey]);
  useEffect(() => {
    if (!site) return;
    try { if (dirty) sessionStorage.setItem(draftKey, JSON.stringify({ name, files, version: draftVersion ?? site.version })); else sessionStorage.removeItem(draftKey); }
    catch { /* Saving a version remains available when browser storage is full. */ }
  }, [dirty, files, name, site, draftVersion, draftKey]);
  useEffect(() => { void load(); return subscribeDataChanges(() => { if (!dirtyRef.current) void load(); }); }, [load]);
  const shownFiles = historical?.files ?? files;
  const active = shownFiles.find(file => file.path === selected) ?? shownFiles[0];
  async function save() {
    if (!site || busy) return null; setBusy(true); setError("");
    try { const next = await api.saveSite({ siteId, name, files, expectedVersion: draftVersion ?? site.version }); apply(next); return next; }
    catch(e) { setError((e as Error).message); return null; } finally { setBusy(false); }
  }
  async function restore() {
    if (!site || !historical || busy) return; setBusy(true); setError("");
    try { apply(await api.restoreSite(siteId, historical.revisionId, site.version)); } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function publish() {
    if (!site || busy || dirty) return; setBusy(true); setError("");
    try { apply(await api.publishSite(siteId, site.revisionId)); setPublishDialog(false); toast.success(t("published")); } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function addFile(event: React.FormEvent) {
    event.preventDefault(); setFileError("");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(html|css|js|mjs|json|svg|txt|md)$/i.test(path) || path.split("/").some(part => !part || part === "." || part === "..") || path.length > 180) { setFileError(t("invalidPath")); return; }
    if (files.some(file => file.path === path || file.path.startsWith(path + "/") || path.startsWith(file.path + "/"))) { setFileError(t("duplicatePath")); return; }
    setFiles(current => [...current, { path, content: "" }]); setSelected(path); setAdding(false);
  }
  function connectData(event: React.FormEvent) {
    event.preventDefault();
    if (!/^tab_(?:pub_)?[A-Za-z0-9_-]{43}$/.test(apiKey)) { setFileError(t("invalidKey")); return; }
    const content = `export const config = ${JSON.stringify({ url: new URL(site!.publicUrl).origin, key: apiKey }, null, 2)};\n`;
    setFiles(current => [...current.filter(file => file.path !== "tabdo-config.js"), { path: "tabdo-config.js", content }]);
    setSelected("tabdo-config.js"); setDataDialog(false); setApiKey("");
  }
  if (!site) return <div className="flex h-full flex-col p-8">{error ? <ListErrorState title={t("loadFailed")} description={error} onRetry={() => void load()} /> : <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>}</div>;
  if (site.kind === "blog") return <BlogEditor siteId={siteId} />;
  const editor = <div className="flex h-full min-h-0 min-w-0 flex-col">
    <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3"><span className="truncate text-xs font-medium">{active?.path}</span>{active && <div className="flex shrink-0 gap-1">
      <Button variant="ghost" size="icon" className="size-7" aria-label={t("downloadFile")} onClick={() => { const url = URL.createObjectURL(new Blob([active.content], { type: "text/plain;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = active.path.split("/").at(-1)!; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download /></Button>
      {active.path !== "index.html" && !historical && <Button variant="destructive-ghost" size="icon" className="size-7" aria-label={t("deleteFile")} onClick={() => setRemoving(active.path)}><Trash2 /></Button>}
    </div>}</div>
    {active && <CodeEditor key={active.path} filename={active.path} value={active.content} aria-label={t("codeEditor", { path: active.path })} readOnly={!!historical} onChange={content => setFiles(current => current.map(file => file.path === active.path ? { ...file, content } : file))} className="min-h-0 flex-1" />}
  </div>;
  const preview = <SitePreview siteId={siteId} files={shownFiles} />;
  return <div className="flex h-full min-h-0 flex-col" data-testid="site-editor">
    <h1 className="sr-only">{site.name}</h1>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex min-w-0 items-center gap-2"><Button asChild variant="ghost" size="icon" aria-label={t("back")}><Link to="/app/sites"><ArrowLeft /></Link></Button><Input aria-label={t("name")} value={name} onChange={event => setName(event.target.value)} disabled={busy || !!historical} maxLength={100} className="w-36 border-transparent bg-transparent font-medium shadow-none hover:border-input sm:w-52" /><span role="status" className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">{dirty ? t("unsaved") : t("savedVersion", { n: site.version })}</span></div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => { setApiKey(""); setFileError(""); setDataDialog(true); }} disabled={busy || !!historical}><Link2 data-icon="inline-start" /><span className="hidden sm:inline">{t("connectData")}</span><span className="sm:hidden">{t("data")}</span></Button>
        {dirty && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDiscarding(true)}>{t("discard")}</Button>}
        <Button variant="outline" size="sm" disabled={busy || !dirty || !name.trim() || !!historical} onClick={() => void save()}><Save data-icon="inline-start" />{t("save")}</Button>
        <Button size="sm" disabled={busy || dirty || !!historical} onClick={() => setPublishDialog(true)}><Upload data-icon="inline-start" />{t("publish")}</Button>
      </div>
    </header>
    {error && <div role="alert" className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2 text-sm text-destructive"><span>{error}</span><Button variant="ghost" size="sm" onClick={() => dirty ? setDiscarding(true) : void load()}>{t("reload")}</Button></div>}
    {historical && <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs"><span>{t("viewingVersion", { n: historical.revisions.find(item => item.id === historical.revisionId)?.version })}</span><div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => setHistorical(null)}><X data-icon="inline-start" />{t("backToDraft")}</Button><Button variant="outline" size="sm" disabled={busy || dirty} onClick={() => void restore()}><RotateCcw data-icon="inline-start" />{t("restore")}</Button></div></div>}
    <div className="flex min-h-0 flex-1">
      <Tabs value={panel} onValueChange={setPanel} className="hidden w-48 shrink-0 gap-0 border-r border-border md:flex">
        <TabsList className="h-10 w-full shrink-0 rounded-none border-b border-border bg-transparent"><TabsTrigger value="files" className="flex-1 text-xs"><FileCode2 />{t("files")}</TabsTrigger><TabsTrigger value="history" className="flex-1 text-xs"><History />{t("history")}</TabsTrigger></TabsList>
        <TabsContent value="files" className="min-h-0 overflow-auto p-2"><div className="mb-2 flex justify-end"><Button variant="ghost" size="icon" className="size-7" aria-label={t("addFile")} disabled={!!historical || files.length >= 50} onClick={() => { setPath(""); setFileError(""); setAdding(true); }}><Plus /></Button></div>{shownFiles.map(file => <Button key={file.path} variant="ghost" className={`mb-1 h-8 w-full justify-start gap-2 px-2 text-xs ${active?.path === file.path ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`} title={file.path} onClick={() => setSelected(file.path)}><FileCode2 className="shrink-0" /><span className="truncate">{file.path}</span></Button>)}</TabsContent>
        <TabsContent value="history" className="min-h-0 overflow-auto p-2"><p className="mb-2 px-2 text-xs text-muted-foreground">{dirty ? t("saveBeforeHistory") : t("historyDescription")}</p>{history.items.map(revision => <Button key={revision.id} variant="ghost" className="mb-1 h-auto w-full flex-col items-start gap-1 px-2 py-2" disabled={busy || dirty} onClick={() => { void api.getSite(siteId, revision.id).then(setHistorical).catch(e => setError(e.message)); }}><span className="text-xs">{t("version", { n: revision.version })}{revision.id === site.publishedRevisionId ? ` · ${t("published")}` : ""}</span><span className="text-xs text-muted-foreground">{new Date(revision.createdAt).toLocaleString()}</span></Button>)}<ListPagination compact className="justify-center gap-1" page={history.page} hasNext={history.hasNext} totalPages={history.totalPages} onPageChange={history.setPage} /></TabsContent>
      </Tabs>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1 lg:hidden">
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="max-w-40 text-xs"><FileCode2 /><span className="truncate">{active?.path}</span></Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuGroup>{shownFiles.map(file => <DropdownMenuItem key={file.path} onSelect={() => setSelected(file.path)}>{file.path}</DropdownMenuItem>)}<DropdownMenuItem disabled={!!historical} onSelect={() => { setPath(""); setFileError(""); setAdding(true); }}><Plus />{t("addFile")}</DropdownMenuItem>{site.revisions.map(revision => <DropdownMenuItem key={revision.id} disabled={dirty || busy} onSelect={() => { void api.getSite(siteId, revision.id).then(setHistorical).catch(e => setError(e.message)); }}><History />{t("version", { n: revision.version })}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
          <Tabs value={mobileTab} onValueChange={setMobileTab}><TabsList className="h-8"><TabsTrigger value="code" className="text-xs"><Code2 />{t("code")}</TabsTrigger><TabsTrigger value="preview" className="text-xs"><Eye />{t("preview")}</TabsTrigger></TabsList></Tabs>
        </div>
        {wide ? <div className="flex min-h-0 flex-1"><ResizablePanelGroup><ResizablePanel defaultSize="50%" minSize="25%">{editor}</ResizablePanel><ResizableHandle /><ResizablePanel defaultSize="50%" minSize="25%" className="flex flex-col">{preview}</ResizablePanel></ResizablePanelGroup></div> : <div className="flex min-h-0 flex-1 flex-col">{mobileTab === "code" ? editor : preview}</div>}
      </div>
    </div>
    <Dialog open={discarding} onOpenChange={setDiscarding}><DialogContent closeLabel={t("close")}><DialogHeader><DialogTitle>{t("discard")}</DialogTitle><DialogDescription>{t("discardDescription")}</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDiscarding(false)}>{t("cancel")}</Button><Button variant="destructive" onClick={() => { sessionStorage.removeItem(draftKey); setDiscarding(false); void load(); }}>{t("discard")}</Button></div></DialogContent></Dialog>
    <Dialog open={adding} onOpenChange={setAdding}><DialogContent closeLabel={t("close")}><DialogHeader><DialogTitle>{t("addFile")}</DialogTitle><DialogDescription>{t("fileDescription")}</DialogDescription></DialogHeader><form noValidate onSubmit={addFile} className="flex flex-col gap-4"><Field><FieldLabel htmlFor="site-file-path">{t("path")}</FieldLabel><Input id="site-file-path" value={path} onChange={event => setPath(event.target.value)} placeholder="assets/styles.css" autoFocus /></Field>{fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}<Button type="submit" disabled={!path.trim()}>{t("addFile")}</Button></form></DialogContent></Dialog>
    <Dialog open={dataDialog} onOpenChange={open => { setDataDialog(open); if (!open) setApiKey(""); }}><DialogContent closeLabel={t("close")}><DialogHeader><DialogTitle>{t("connectData")}</DialogTitle><DialogDescription>{t("dataDescription")}</DialogDescription></DialogHeader><form noValidate onSubmit={connectData} className="flex flex-col gap-4"><Field><FieldLabel htmlFor="site-api-key">API Key</FieldLabel><Input id="site-api-key" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="tab_…" /></Field><Link to="/app/settings?tab=api-keys" className="text-sm text-primary underline underline-offset-4">{t("manageKeys")}</Link>{fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}<Button type="submit" disabled={!apiKey}>{t("applyKey")}</Button></form></DialogContent></Dialog>
    <Dialog open={publishDialog} onOpenChange={open => { if (!busy) setPublishDialog(open); }}><DialogContent closeLabel={t("close")}><DialogHeader><DialogTitle>{t("publishTitle")}</DialogTitle><DialogDescription>{t("publishDescription", { n: site.version })}</DialogDescription></DialogHeader><p className="break-all rounded-md bg-muted p-3 text-sm">{site.publicUrl}</p>{site.publishedRevisionId && <a href={site.publicUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary underline underline-offset-4"><ExternalLink className="size-4" />{t("openPublished")}</a>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex flex-wrap justify-end gap-2">{site.publishedRevisionId && <Button variant="destructive-ghost" disabled={busy} onClick={() => { setBusy(true); void api.unpublishSite(siteId).then(next => { apply(next); setPublishDialog(false); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>{t("unpublish")}</Button>}<Button disabled={busy} onClick={() => void publish()}>{busy ? t("publishing") : t("publish")}</Button></div></DialogContent></Dialog>
    <DeleteConfirmation open={!!removing} onOpenChange={open => { if (!open) setRemoving(null); }} title={t("deleteFile")} description={t("deleteFileDescription", { path: removing })} onConfirm={async () => { setFiles(current => current.filter(file => file.path !== removing)); setSelected("index.html"); }} />
  </div>;
}
