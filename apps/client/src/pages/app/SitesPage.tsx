import { BlogCreateDialog } from "@/components/sites/BlogCreateDialog";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Globe, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SiteSummary } from "@tabdo/shared";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@tabdo/ui/components/dialog";
import { Field, FieldLabel } from "@tabdo/ui/components/field";
import { ListItem } from "@tabdo/ui/components/list-item";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { ListPagination } from "@/components/controls/list-pagination";
import { useArrayPagination } from "@/hooks/useListPagination";
import { subscribeDataChanges } from "@/lib/data-changes";
import { api } from "@/lib/api";

export function SitesPage() {
  const { t } = useTranslation("sites"), navigate = useNavigate();
  const [sites, setSites] = useState<SiteSummary[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [search, setSearch] = useState(""), [create, setCreate] = useState(false), [name, setName] = useState(""), [saving, setSaving] = useState(false), [formError, setFormError] = useState("");
  const [blogCreate, setBlogCreate] = useState(false);
  const [deleting, setDeleting] = useState<SiteSummary | null>(null);
  const load = useCallback(async () => { setError(""); try { setSites(await api.listSites()); } catch(e) { setError((e as Error).message); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); return subscribeDataChanges(() => void load()); }, [load]);
  const pagination = useArrayPagination(sites.filter(site => site.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())));
  const openCreate = () => { setName(""); setFormError(""); setCreate(true); };
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (saving || !name.trim()) return; setSaving(true); setFormError("");
    try {
      const { sdkUrl } = await api.getSiteConfig();
      const escaped = name.trim().replace(/[&<>"']/g, value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[value]!));
      const site = await api.saveSite({ name: name.trim(), files: [
        { path: "index.html", content: `<!doctype html>\n<html lang="${t("htmlLang")}">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1">\n  <title>${escaped}</title>\n  <link rel="stylesheet" href="./styles.css">\n</head>\n<body>\n  <main><h1>${escaped}</h1><p>${t("starterText")}</p></main>\n  <script type="module" src="./app.js"></script>\n</body>\n</html>\n` },
        { path: "styles.css", content: "body { margin: 0; padding: 48px 24px; font-family: system-ui, sans-serif; color: #37352f; background: #fff; }\nmain { max-width: 720px; margin: auto; }\nh1 { font-size: clamp(2rem, 5vw, 3rem); line-height: 1.15; }\np { line-height: 1.7; }\n" },
        { path: "app.js", content: `import { createClient } from ${JSON.stringify(sdkUrl)};\nimport { config } from './tabdo-config.js';\n\n// Connect the tables needed by this page after configuring an API key.\nexport const tabdo = config.key ? createClient(config) : null;\n` },
        { path: "tabdo-config.js", content: "export const config = {\n  url: location.origin,\n  key: '',\n};\n" },
      ] });
      navigate(`/app/sites/${site.id}`);
    } catch(e) { setFormError((e as Error).message); } finally { setSaving(false); }
  }
  const action = <Button onClick={openCreate}><Plus data-icon="inline-start" />{t("create")}</Button>;
  return <AppPage contentWidth="standard" className="gap-5" header={<AppPageHeader page="sites" description={t("description")}><Button variant="ghost" size="icon" aria-label={t("refresh")} disabled={loading} onClick={() => void load()}><RefreshCw /></Button><Button variant="outline" onClick={() => setBlogCreate(true)}>{t("blogs:create")}</Button>{action}</AppPageHeader>}>
    {sites.length > 0 && <div className="relative max-w-sm"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label={t("search")} placeholder={t("search")} value={search} onChange={event => { setSearch(event.target.value); pagination.resetPage(); }} className="pl-9" /></div>}
    {error ? <ListErrorState title={t("loadFailed")} description={error} onRetry={() => void load()} /> : loading ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>
      : !sites.length ? <AppEmptyState illustration={NOTIOLY.painting} title={t("emptyTitle")} description={t("emptyDescription")} action={action} />
      : <><ul className="flex flex-col gap-3" aria-label={t("title")}>{pagination.items.map(site => <ListItem key={site.id} className="flex items-start gap-3">
        <Link to={`/app/sites/${site.id}`} className="absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("editNamed", { name: site.name })} />
        <span className="pointer-events-none flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"><Globe className="size-5 text-muted-foreground" /></span>
        <div className="pointer-events-none min-w-0 flex-1"><h2 className="truncate text-sm font-medium">{site.name}</h2><p className="mt-1 text-xs text-muted-foreground">{t("version", { n: site.version })} · {site.publishedVersion ? t("publishedVersion", { n: site.publishedVersion }) : t("draft")}</p></div>
        <Button variant="destructive-ghost" size="icon" className="relative" aria-label={t("deleteNamed", { name: site.name })} onClick={() => setDeleting(site)}><Trash2 /></Button>
      </ListItem>)}</ul>{!pagination.items.length && <p className="py-12 text-center text-sm text-muted-foreground">{t("noMatches")}</p>}<ListPagination page={pagination.page} hasNext={pagination.hasNext} totalPages={pagination.totalPages} onPageChange={pagination.setPage} /></>}
    <BlogCreateDialog open={blogCreate} onOpenChange={setBlogCreate} />
    <Dialog open={create} onOpenChange={open => { if (!saving) setCreate(open); }}><DialogContent closeLabel={t("close")}><DialogHeader><DialogTitle>{t("create")}</DialogTitle><DialogDescription>{t("createDescription")}</DialogDescription></DialogHeader><form noValidate onSubmit={event => void submit(event)} className="flex flex-col gap-5"><Field><FieldLabel htmlFor="site-name">{t("name")}</FieldLabel><Input id="site-name" value={name} maxLength={100} onChange={event => setName(event.target.value)} autoFocus /></Field>{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => setCreate(false)}>{t("cancel")}</Button><Button type="submit" disabled={saving || !name.trim()}>{saving ? t("saving") : t("create")}</Button></div></form></DialogContent></Dialog>
    <DeleteConfirmation open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null); }} title={t("deleteNamed", { name: deleting?.name })} description={t("deleteDescription")} onConfirm={async () => { if (deleting) { await api.deleteSite(deleting.id); await load(); } }} />
  </AppPage>;
}
