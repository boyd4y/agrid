import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Copy, ExternalLink, Plus, Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { BlogConfig, BlogDetail, BlogSource, ColumnDef } from "@tabdo/shared";
import { blogConfigSchema } from "@tabdo/shared";
import { Button } from "@tabdo/ui/components/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@tabdo/ui/components/collapsible";
import { Input } from "@tabdo/ui/components/input";
import { Textarea } from "@tabdo/ui/components/textarea";
import { Checkbox } from "@tabdo/ui/components/checkbox";
import { Badge } from "@tabdo/ui/components/badge";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@tabdo/ui/components/field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@tabdo/ui/components/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@tabdo/ui/components/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@tabdo/ui/components/dialog";
import { Alert, AlertDescription } from "@tabdo/ui/components/alert";
import { Separator } from "@tabdo/ui/components/separator";
import { ListPagination } from "@/components/controls/list-pagination";
import { useArrayPagination } from "@/hooks/useListPagination";
import { useSaveBeforeLeave } from "@/hooks/useSaveBeforeLeave";
import { RecordPage, type RecordPageHandle } from "@/components/table/RecordPage";
import type { DocumentState } from "@/components/documents/DocumentBody";
import { workspaceCacheKey, workspaceUnloadApproved } from "@/lib/workspace-scope";
import { blogCommand } from "@/lib/blog-api";
import { subscribeDataChanges } from "@/lib/data-changes";
import type { PreviewSlotHeader } from "@/components/preview/preview-slot";

type PublicAction = { action: "publishBlog" | "withdrawBlogArticle" | "unpublishBlog"; rowId?: string };
const mappingTypes: Record<keyof BlogConfig["mapping"], string[]> = { title: ["text"], slug: ["text"], summary: ["text"], author: ["text", "person"], date: ["date", "text"], cover: ["file"], category: ["select", "text"], tags: ["multi_select", "select", "text"] };
export function BlogEditor({ siteId, onPreviewHeaderChange }: { siteId: string; onPreviewHeaderChange?: (header: PreviewSlotHeader | null) => void }) {
  const { t } = useTranslation("blogs"), id = useId(), navigate = useNavigate();
  const pageRef = useRef<RecordPageHandle>(null);
  const [blog, setBlog] = useState<BlogDetail | null>(null), [name, setName] = useState(""), [config, setConfig] = useState<BlogConfig | null>(null);
  const draftKey = `tabdo.blog-draft:${workspaceCacheKey()}:${siteId}`, recovered = useRef(false), loadGeneration = useRef(0);
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [columns, setColumns] = useState<ColumnDef[]>([]), [sources, setSources] = useState<BlogSource[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [tab, setTab] = useState("articles");
  const [preview, setPreview] = useState<{ url: string; expiresAt: string } | null>(null), [confirmation, setConfirmation] = useState<PublicAction | null>(null);
  const [active, setActive] = useState<string | null>(null), [articleState, setArticleState] = useState<DocumentState>({ dirty: false, busy: false });
  const startPending = useRef<{ signature: string; key: string } | null>(null);
  const articleBlocked = articleState.dirty || articleState.busy;
  const dirty = !!blog && !!config && (name !== blog.name || JSON.stringify(config) !== JSON.stringify(blog.config));
  const { leave, leaving, dialog: leaveDialog } = useSaveBeforeLeave(async () => {
    const saved = await pageRef.current?.flush() ?? true;
    return saved && !dirty;
  });
  const leaveRef = useRef(leave); leaveRef.current = leave;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  useEffect(() => { const guard = (e: BeforeUnloadEvent) => { if (!workspaceUnloadApproved() && dirtyRef.current) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, []);
  const history = useArrayPagination(blog?.revisions ?? [], 10);
  const apply = useCallback((next: BlogDetail) => { setBlog(next); setName(next.name); setConfig(next.config); setDraftVersion(null); }, []);
  const load = useCallback(async () => { const current = ++loadGeneration.current; try {
    const next = await blogCommand("getBlog", { siteId });
    if (current !== loadGeneration.current) return;
    apply(next); setError("");
    if (!recovered.current) {
      recovered.current = true;
      try {
        const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "null");
        if (saved && typeof saved.name === "string" && Number.isInteger(saved.version) && blogConfigSchema.safeParse(saved.config).success) { setName(saved.name); setConfig(saved.config); setDraftVersion(saved.version); }
      } catch { /* The saved server version remains usable. */ }
    }
  } catch(e) { if (current === loadGeneration.current) setError((e as Error).message); } }, [siteId, apply, draftKey]);
  useEffect(() => {
    if (!blog || !config) return;
    try {
      if (dirty) sessionStorage.setItem(draftKey, JSON.stringify({ name, config, version: draftVersion ?? blog.version }));
      else sessionStorage.removeItem(draftKey);
    } catch { setError(t("documents:draftStorageFailed")); }
  }, [blog, config, name, dirty, draftVersion, draftKey, t]);
  useEffect(() => { void load(); const unsubscribe = subscribeDataChanges(() => { if (!dirtyRef.current) void load(); }); const focus = () => { if (!dirtyRef.current) void load(); }; window.addEventListener("focus", focus); return () => { unsubscribe(); window.removeEventListener("focus", focus); }; }, [load]);
  const tableId = blog?.config.tableId;
  useEffect(() => { if (!tableId) return; const controller = new AbortController(); void blogCommand("getBlogSources", { tableId }, controller.signal).then(next => { setColumns(next.columns); setSources(next.items); setCursor(next.nextAfterId); }).catch(e => { if (!controller.signal.aborted) setError(e.message); }); return () => controller.abort(); }, [tableId]);
  const reloadSources = useCallback(async () => {
    if (!tableId) return;
    const next = await blogCommand("getBlogSources", { tableId });
    setColumns(next.columns); setSources(next.items); setCursor(next.nextAfterId);
  }, [tableId]);
  async function startArticle(source?: BlogSource) {
    if (!blog || dirty || articleBlocked) return;
    const input = { siteId, expectedVersion: blog.version, ...(source ? { rowId: source.rowId, expectedRowVersion: source.rowVersion } : {}), title: t("untitled") };
    const signature = JSON.stringify(input);
    if (startPending.current?.signature !== signature) startPending.current = { signature, key: crypto.randomUUID() };
    const result = await blogCommand("startBlogArticle", { ...input, idempotencyKey: startPending.current.key });
    setActive(result.rowId); setArticleState({ dirty: false, busy: false }); startPending.current = null;
    await reloadSources();
  }
  const leaveArticle = () => void leave(() => {
    setActive(null); setArticleState({ dirty: false, busy: false }); void reloadSources().catch(e => setError(e.message));
  });
  async function work(fn: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); try { await fn(); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); toast.success(t("copied")); } catch { setError(t("copyFailed")); } }
  async function copyDraft() {
    try { await navigator.clipboard.writeText(JSON.stringify({ name, config, version: draftVersion ?? blog?.version }, null, 2)); toast.success(t("draftCopied")); }
    catch { setError(t("draftCopyFailed")); }
  }
  async function discardDraft() {
    const current = ++loadGeneration.current;
    const latest = await blogCommand("getBlog", { siteId });
    if (current !== loadGeneration.current) return;
    // Keep the draft until the latest saved configuration has been read successfully.
    sessionStorage.removeItem(draftKey);
    apply(latest); setPreview(null); setDiscarding(false);
  }
  async function build() {
    const next = await blogCommand("buildBlog", { siteId, expectedVersion: blog!.version, idempotencyKey: crypto.randomUUID() }); apply(next);
    setPreview(await blogCommand("createBlogPreview", { siteId, buildId: next.revisionId, idempotencyKey: crypto.randomUUID() })); setTab("preview");
  }
  async function publishAction() {
    if (!confirmation || !blog) return;
    const input = { siteId, expectedVersion: blog.version, expectedPublishedRevisionId: blog.publishedRevisionId, ...(confirmation.action === "publishBlog" ? { buildId: blog.revisionId } : {}), ...(confirmation.rowId ? { rowId: confirmation.rowId } : {}) };
    const { authorizationToken } = await blogCommand("authorizeBlogPublication", { ...input, action: confirmation.action, idempotencyKey: crypto.randomUUID() });
    const result = confirmation.action === "publishBlog" ? await blogCommand("publishBlog", { ...input, buildId: blog.revisionId, authorizationToken, idempotencyKey: crypto.randomUUID() }) : confirmation.action === "withdrawBlogArticle" ? await blogCommand("withdrawBlogArticle", { ...input, rowId: confirmation.rowId!, authorizationToken, idempotencyKey: crypto.randomUUID() }) : await blogCommand("unpublishBlog", { ...input, authorizationToken, idempotencyKey: crypto.randomUUID() });
    apply(result); setPreview(null); setConfirmation(null); toast.success(t("completed"));
  }
  useEffect(() => {
    onPreviewHeaderChange?.({
      title: blog?.name,
      actions: <Button asChild variant="ghost" size="icon"><Link to={`/app/sites/${siteId}`} aria-label={t("sites:openEditor")} title={t("sites:openEditor")} onClick={event => { event.preventDefault(); void leaveRef.current(() => navigate(`/app/sites/${siteId}`)); }}><ExternalLink /></Link></Button>,
      refresh: { run: () => { void work(async () => { await load(); await reloadSources(); }); }, disabled: busy || dirty || articleBlocked, busy },
      beforeClose: close => { void leaveRef.current(close); },
    });
    return () => onPreviewHeaderChange?.(null);
  }, [onPreviewHeaderChange, blog?.name, load, reloadSources, busy, dirty, articleBlocked, siteId, navigate, t]);
  if (!blog || !config) return <div className="flex flex-col gap-4 p-6">{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p role="status">{t("loading")}</p>}{!onPreviewHeaderChange && <Button variant="outline" onClick={() => void load()}>{t("reload")}</Button>}</div>;
  const Toolbar = onPreviewHeaderChange ? "div" : "header";
  const change = (patch: Partial<BlogConfig>) => setConfig(current => ({ ...current!, ...patch }));
  const selectRow = (source: BlogSource, selected: boolean) => change({ articles: selected ? [...config.articles, { rowId: source.rowId, imageIds: [] }] : config.articles.filter(a => a.rowId !== source.rowId) });
  const mappingSelect = (key: keyof BlogConfig["mapping"]) => <Field key={key}><FieldLabel htmlFor={`${id}-${key}`}>{t(`mapping.${key}`)}{["title", "slug"].includes(key) ? t("required") : ""}</FieldLabel><Select value={config.mapping[key] ?? "none"} disabled={busy} onValueChange={value => { const mapping = { ...config.mapping }; if (value === "none") delete mapping[key]; else mapping[key] = value; change({ mapping }); }}><SelectTrigger id={`${id}-${key}`}><SelectValue placeholder={t("chooseField")} /></SelectTrigger><SelectContent><SelectGroup>{!["title", "slug"].includes(key) && <SelectItem value="none">{t("notPublic")}</SelectItem>}{columns.filter(c => mappingTypes[key].includes(c.type)).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>;
  return <div className="flex h-full min-h-0 flex-col" data-testid="blog-editor">
    <Toolbar data-testid="blog-editor-actions" className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><div className="flex min-w-0 items-center gap-2">{!onPreviewHeaderChange && <><Button asChild size="icon" variant="ghost" aria-label={t("back")}><Link to="/app/sites" onClick={event => { event.preventDefault(); void leave(() => navigate("/app/sites")); }}><ArrowLeft /></Link></Button><h1 className="truncate text-base font-medium">{blog.name}</h1></>}<Badge variant="secondary">{blog.publishedRevisionId ? t("published") : t("draft")}</Badge></div><div className="flex flex-wrap items-center gap-2">{!onPreviewHeaderChange && <Button variant="ghost" size="icon" aria-label={t("reload")} disabled={busy || dirty || articleBlocked} onClick={() => void work(load)}><RefreshCw /></Button>}<Button variant="outline" disabled={busy || !dirty} onClick={() => void work(async () => { apply(await blogCommand("saveBlog", { siteId, expectedVersion: draftVersion ?? blog.version, name, config, idempotencyKey: crypto.randomUUID() })); setPreview(null); })}>{t("save")}</Button><Button variant="outline" disabled={busy || dirty || articleBlocked} onClick={() => void work(build)}>{busy ? t("working") : t("build")}</Button><Button disabled={busy || dirty || articleBlocked || !blog.manifest} onClick={() => setConfirmation({ action: "publishBlog" })}>{t("publish")}</Button></div></Toolbar>
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4 sm:p-6">
      <div className="mb-5 flex flex-col gap-3">{error && <Alert variant="destructive"><AlertDescription className="gap-3"><p>{error}</p>{dirty && <Button variant="outline" size="sm" disabled={busy} onClick={() => setDiscarding(true)}>{t("reloadLatest")}</Button>}</AlertDescription></Alert>}<p role="status" className="text-sm text-muted-foreground">{dirty ? t("unsaved") : blog.pendingChanges ? t("pending") : t("upToDate")}</p>{blog.publishedRevisionId && <div className="flex min-w-0 flex-wrap items-center gap-2"><a className="min-w-0 break-all text-sm text-primary underline underline-offset-4" href={blog.publicUrl} target="_blank" rel="noopener noreferrer">{blog.publicUrl}</a><Button size="icon" variant="ghost" aria-label={t("copyPublic")} onClick={() => void copy(blog.publicUrl)}><Copy /></Button><Button variant="destructive-ghost" size="sm" disabled={busy || dirty || articleBlocked} onClick={() => setConfirmation({ action: "unpublishBlog" })}>{t("unpublish")}</Button></div>}</div>
      {active ? <div className="flex min-w-0 flex-col gap-4"><div><Button variant="ghost" size="sm" disabled={leaving} onClick={leaveArticle}><ArrowLeft />{t("backToArticles")}</Button></div><RecordPage ref={pageRef} key={`${workspaceCacheKey()}:${tableId}:${active}`} tableId={config.tableId} rowId={active} titleColumnId={config.mapping.title} advancedColumnIds={[config.mapping.slug]} onStateChange={setArticleState} /></div> : <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1"><TabsList className="mb-4 w-full sm:w-fit">{["articles", "settings", "preview", "history"].map(value => <TabsTrigger key={value} value={value} className="flex-1">{t(`tabs.${value}`)}</TabsTrigger>)}</TabsList>
        <TabsContent value="settings"><FieldGroup className="max-w-3xl"><Field><FieldLabel htmlFor={`${id}-name`}>{t("name")}</FieldLabel><Input id={`${id}-name`} value={name} maxLength={100} disabled={busy} onChange={e => setName(e.target.value)} /></Field><Field><FieldLabel htmlFor={`${id}-description`}>{t("description")}</FieldLabel><Textarea id={`${id}-description`} value={config.description} maxLength={500} disabled={busy} onChange={e => change({ description: e.target.value })} /></Field><Field><FieldLabel htmlFor={`${id}-authorName`}>{t("authorName")}</FieldLabel><Input id={`${id}-authorName`} value={config.authorName} maxLength={100} disabled={busy} onChange={e => change({ authorName: e.target.value })} /></Field><Field><FieldLabel htmlFor={`${id}-language`}>{t("language")}</FieldLabel><Select value={config.language} onValueChange={value => change({ language: value as BlogConfig["language"] })} disabled={busy}><SelectTrigger id={`${id}-language`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="zh-CN">中文</SelectItem><SelectItem value="en">English</SelectItem></SelectGroup></SelectContent></Select></Field><Collapsible><CollapsibleTrigger asChild><Button variant="ghost" size="sm">{t("advanced")}</Button></CollapsibleTrigger><CollapsibleContent><FieldSet className="pt-4"><FieldLegend>{t("publicFields")}</FieldLegend><FieldDescription>{t("fieldsHint")}</FieldDescription><FieldGroup className="grid gap-4 sm:grid-cols-2">{(Object.keys(mappingTypes) as (keyof BlogConfig["mapping"])[]).map(mappingSelect)}</FieldGroup></FieldSet></CollapsibleContent></Collapsible></FieldGroup></TabsContent>
        <TabsContent value="articles" className="flex flex-col gap-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-medium">{t("selection", { count: config.articles.length })}</h2><p className="mt-1 text-sm text-muted-foreground">{t("selectionHint")}</p></div><Button disabled={busy || dirty} onClick={() => void work(() => startArticle())}><Plus />{t("newArticle")}</Button></div>
          <FieldSet className="gap-0 rounded-md border"><FieldLegend className="sr-only">{t("tabs.articles")}</FieldLegend>{sources.map(source => { const selected = config.articles.find(a => a.rowId === source.rowId), title = String(source.cells[config.mapping.title] ?? t("untitled")), published = blog.publishedArticles.find(a => a.rowId === source.rowId); return <div key={source.rowId} className="flex flex-col gap-3 border-b p-4 last:border-b-0" data-testid={`blog-source-${source.rowId}`}><div className="flex items-start justify-between gap-3"><label className="flex min-w-0 cursor-pointer items-start gap-3"><Checkbox className="mt-1" checked={!!selected} disabled={busy || !selected && config.articles.length >= 20} onCheckedChange={value => selectRow(source, value === true)} aria-label={t("selectNamed", { name: title })} /><span className="min-w-0"><span className="block break-words text-sm font-medium">{title}</span></span></label>{published && <Badge variant="outline">{t("published")}</Badge>}<Button size="sm" variant="ghost" disabled={busy || dirty} onClick={() => void work(() => startArticle(source))}><Pencil />{t("write")}</Button></div>{selected && (source.images.length > 0 || source.covers.length > 0) && <FieldSet className="ml-7 gap-3"><FieldLegend variant="label">{t("assets")}</FieldLegend><FieldDescription>{t("assetsHint")}</FieldDescription>{source.images.map(image => <label key={image.id} className="flex items-center gap-2 text-sm"><Checkbox checked={selected.imageIds.includes(image.id)} disabled={busy} onCheckedChange={value => change({ articles: config.articles.map(a => a.rowId === source.rowId ? { ...a, imageIds: value === true ? [...a.imageIds, image.id] : a.imageIds.filter(v => v !== image.id) } : a) })} />{image.name}</label>)}{config.mapping.cover && <Field><FieldLabel htmlFor={`${id}-cover-${source.rowId}`}>{t("mapping.cover")}</FieldLabel><Select value={selected.coverFileId ?? "none"} disabled={busy} onValueChange={value => change({ articles: config.articles.map(a => a.rowId === source.rowId ? { ...a, coverFileId: value === "none" ? undefined : value } : a) })}><SelectTrigger id={`${id}-cover-${source.rowId}`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="none">{t("notPublic")}</SelectItem>{source.covers.filter(cover => cover.columnId === config.mapping.cover).map(cover => <SelectItem key={cover.id} value={cover.id}>{cover.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>}</FieldSet>}</div>; })}{!sources.length && <p className="p-6 text-sm text-muted-foreground">{t("noSources")}</p>}</FieldSet>
          {cursor && <Button variant="outline" disabled={busy} onClick={() => void work(async () => { const next = await blogCommand("getBlogSources", { tableId: config.tableId, afterId: cursor }); setSources(items => [...items, ...next.items]); setCursor(next.nextAfterId); })}>{t("loadMore")}</Button>}
          {blog.publishedArticles.length > 0 && <><Separator /><FieldSet><FieldLegend>{t("onlineArticles")}</FieldLegend><FieldDescription>{t("recallHint")}</FieldDescription>{blog.publishedArticles.map(article => <div key={article.rowId} className="flex flex-wrap items-center justify-between gap-2 py-2"><a className="min-w-0 break-words text-sm text-primary underline underline-offset-4" href={`${blog.publicUrl}articles/${article.slug}.html`} target="_blank" rel="noopener noreferrer">{article.title}</a><Button size="sm" variant="destructive-ghost" disabled={busy || dirty || articleBlocked} onClick={() => setConfirmation({ action: "withdrawBlogArticle", rowId: article.rowId })}>{t("withdraw")}</Button></div>)}</FieldSet></>}
        </TabsContent>
        <TabsContent value="preview" className="flex flex-col gap-4"><p className="text-sm text-muted-foreground">{t("previewHint")}</p>{preview ? <><div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">{t("previewExpires", { date: new Date(preview.expiresAt).toLocaleTimeString() })}</span><Button variant="outline" size="sm" onClick={() => void copy(preview.url)}>{t("copyPreview")}</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => void work(async () => { await blogCommand("revokeBlogPreviews", { siteId, idempotencyKey: crypto.randomUUID() }); setPreview(null); })}>{t("revokePreview")}</Button></div><iframe title={t("previewTitle")} src={preview.url} sandbox="allow-scripts allow-forms allow-downloads" className="h-[65dvh] min-h-80 w-full rounded-md border bg-background" /></> : <div className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-md border border-dashed p-6"><p className="text-sm text-muted-foreground">{t("buildHint")}</p><Button disabled={busy || dirty || articleBlocked} onClick={() => void work(build)}>{t("build")}</Button></div>}<p className="text-xs text-muted-foreground">{t("limits")}</p></TabsContent>
        <TabsContent value="history" className="flex flex-col gap-3"><p className="text-sm text-muted-foreground">{t("historyHint")}</p>{history.items.map(revision => <div key={revision.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3"><span className="text-sm">{t("version", { n: revision.version })} · {revision.built ? t("built") : t("draft")}<span className="ml-2 text-muted-foreground">{new Date(revision.createdAt).toLocaleString()}</span></span><Button variant="outline" size="sm" disabled={busy || dirty || articleBlocked} onClick={() => void work(async () => { apply(await blogCommand("restoreBlogRevision", { siteId, revisionId: revision.id, expectedVersion: blog.version, idempotencyKey: crypto.randomUUID() })); setPreview(null); setTab("settings"); })}>{t("restore")}</Button></div>)}<ListPagination page={history.page} hasNext={history.hasNext} totalPages={history.totalPages} onPageChange={history.setPage} /></TabsContent>
      </Tabs>}
    </div>
    <Dialog open={discarding} onOpenChange={open => { if (!busy) setDiscarding(open); }}><DialogContent closeLabel={t("cancel")}><DialogHeader className="pr-6"><DialogTitle>{t("discardDraftTitle")}</DialogTitle><DialogDescription>{t("discardDraftDescription")}</DialogDescription></DialogHeader>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => void copyDraft()}>{t("copyDraft")}</Button><Button variant="outline" disabled={busy} onClick={() => setDiscarding(false)}>{t("cancel")}</Button><Button variant="destructive" disabled={busy} onClick={() => void work(discardDraft)}>{busy ? t("working") : t("discardAndReload")}</Button></div></DialogContent></Dialog>
    {leaveDialog}<Dialog open={!!confirmation} onOpenChange={open => { if (!open && !busy) setConfirmation(null); }}><DialogContent closeLabel={t("close")}><DialogHeader><DialogTitle>{t(confirmation?.action === "publishBlog" ? "publish" : confirmation?.action === "withdrawBlogArticle" ? "withdraw" : "unpublish")}</DialogTitle><DialogDescription>{t(confirmation?.action === "publishBlog" ? "publishHint" : "recallHint")}</DialogDescription></DialogHeader>{confirmation?.action === "publishBlog" && <><p className="text-sm">{t("publishCount", { count: blog.manifest?.articles.length ?? 0, assets: blog.manifest?.assets.length ?? 0 })}</p><ul className="max-h-48 list-inside list-disc overflow-auto text-sm">{blog.manifest?.articles.map(a => <li key={a.rowId}>{a.title}</li>)}</ul></>}<p className="break-all text-sm text-muted-foreground">{blog.publicUrl}</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>{t("cancel")}</Button><Button disabled={busy} onClick={() => void work(publishAction)}>{busy ? t("working") : t("confirm")}</Button></div></DialogContent></Dialog>
  </div>;
}
