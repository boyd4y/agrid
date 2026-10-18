import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ColumnDef, TableMeta } from "@tabdo/shared";
import { Button } from "@tabdo/ui/components/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@tabdo/ui/components/dialog";
import { Field, FieldLabel, FieldGroup } from "@tabdo/ui/components/field";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@tabdo/ui/components/collapsible";
import { Input } from "@tabdo/ui/components/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@tabdo/ui/components/select";
import { api } from "@/lib/api";
import { blogCommand } from "@/lib/blog-api";
export function BlogCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, i18n } = useTranslation("blogs"), navigate = useNavigate(), id = useId();
  const [tables, setTables] = useState<TableMeta[]>([]), [columns, setColumns] = useState<ColumnDef[]>([]);
  const [tableId, setTableId] = useState(""), [name, setName] = useState(""), [title, setTitle] = useState(""), [slug, setSlug] = useState("");
  const [advanced, setAdvanced] = useState(false), [description, setDescription] = useState("");
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { if (!open) return; setAdvanced(false); setDescription(""); pending.current = null; setName(""); setTableId(""); setTitle(""); setSlug(""); setColumns([]); setError(""); void api.listTables().then(setTables).catch(() => setError(t("errors.REQUEST_FAILED"))); }, [open, t]);
  useEffect(() => { if (!tableId) return; const controller = new AbortController(); setColumns([]); setTitle(""); setSlug(""); void blogCommand("getBlogSources", { tableId, limit: 1 }, controller.signal).then(v => setColumns(v.columns)).catch(e => { if (!controller.signal.aborted) setError(e.message); }); return () => controller.abort(); }, [tableId]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const signature = JSON.stringify({ name, description, advanced, tableId, title, slug });
      if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
      const blog = advanced ? await blogCommand("saveBlog", { name, config: { tableId, authorName: "", description, language: i18n.language === "en" ? "en" : "zh-CN", mapping: { title, slug }, articles: [] }, idempotencyKey: pending.current.key }) : await blogCommand("createBlog", { name, description, language: i18n.language === "en" ? "en" : "zh-CN", idempotencyKey: pending.current.key });
      onOpenChange(false); navigate(`/app/sites/${blog.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const field = (key: "title" | "slug", value: string, change: (v: string) => void) => <Field><FieldLabel htmlFor={`${id}-${key}`}>{t(`mapping.${key}`)}</FieldLabel><Select value={value} onValueChange={change} disabled={busy || !columns.length}><SelectTrigger id={`${id}-${key}`}><SelectValue placeholder={t("chooseField")} /></SelectTrigger><SelectContent><SelectGroup>{columns.filter(c => c.type === "text").map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>;
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent closeLabel={t("close")}><DialogHeader><DialogTitle>{t("create")}</DialogTitle><DialogDescription>{t("createHint")}</DialogDescription></DialogHeader><form noValidate onSubmit={event => void submit(event)} className="flex flex-col gap-5"><FieldGroup>
    <Field><FieldLabel htmlFor={`${id}-name`}>{t("name")}</FieldLabel><Input id={`${id}-name`} value={name} maxLength={100} onChange={e => setName(e.target.value)} disabled={busy} autoFocus /></Field>
    <Field><FieldLabel htmlFor={`${id}-description`}>{t("description")}</FieldLabel><Input id={`${id}-description`} value={description} maxLength={500} disabled={busy} onChange={e => setDescription(e.target.value)} /></Field>
    </FieldGroup><Collapsible open={advanced} onOpenChange={setAdvanced}><CollapsibleTrigger asChild><Button variant="ghost" size="sm" disabled={busy}>{t("bindExisting")}</Button></CollapsibleTrigger><CollapsibleContent><FieldGroup className="pt-4"><Field><FieldLabel htmlFor={`${id}-table`}>{t("contentTable")}</FieldLabel><Select value={tableId} onValueChange={setTableId} disabled={busy}><SelectTrigger id={`${id}-table`}><SelectValue placeholder={t("chooseTable")} /></SelectTrigger><SelectContent><SelectGroup>{tables.map(table => <SelectItem key={table.id} value={table.id}>{table.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
    {field("title", title, setTitle)}{field("slug", slug, setSlug)}
  </FieldGroup></CollapsibleContent></Collapsible>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" disabled={busy || advanced && (!tableId || !title || !slug) || !name.trim()}>{busy ? t("working") : t("create")}</Button></form></DialogContent></Dialog>;
}
