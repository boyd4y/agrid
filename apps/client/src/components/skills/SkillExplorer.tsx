import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Code2, Copy, FileText, Folder } from "lucide-react";
import type { SkillDocument, SkillFile } from "@tabdo/shared";
import { Loader2, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@tabdo/ui/components/button";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const CodeEditor = lazy(() => import("@tabdo/ui/components/code-editor").then(module => ({ default: module.CodeEditor })));

type Node = { name: string; path: string; children: Node[]; file?: SkillFile };
function tree(files: SkillFile[]) {
  const root: Node = { name: "", path: "", children: [] };
  for (const file of files) {
    let parent = root;
    for (const part of file.path.split("/")) {
      let node = parent.children.find((child) => child.name === part);
      if (!node) { node = { name: part, path: parent.path ? `${parent.path}/${part}` : part, children: [] }; parent.children.push(node); }
      parent = node;
    }
    parent.file = file;
  }
  return root.children;
}

export function SkillExplorer({ skill, canManage = false, onSaved }: { skill: SkillDocument; canManage?: boolean; onSaved?: (skill: SkillDocument) => void }) {
  const { t } = useTranslation("common");
  const files = [{ path: "SKILL.md", content: skill.document }, ...skill.files];
  const [path, setPath] = useState("SKILL.md");
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({}), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const alive = useRef(true), savingRef = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const canEdit = canManage && !skill.builtin;
  const dirty = files.some(file => draft[file.path] !== undefined && draft[file.path] !== file.content);
  const save = async () => {
    if (!canEdit || !dirty || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(null);
    try {
      const updated = await api.updateSkill(skill.id, draft["SKILL.md"] ?? skill.document, skill.version, skill.files.map(file => ({ ...file, content: draft[file.path] ?? file.content })));
      if (alive.current) { setDraft({}); onSaved?.(updated); }
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { savingRef.current = false; if (alive.current) setSaving(false); }
  };
  const original = files.find((file) => file.path === path) ?? files[0];
  const selected = { ...original, content: draft[original.path] ?? original.content };
  const render = (nodes: Node[]) => nodes.map((node) => node.file ? <Button variant={selected.path === node.path ? "secondary" : "ghost"} size="sm" type="button" key={node.path} aria-pressed={selected.path === node.path} onClick={() => { setPath(node.path); setCopied(false); }} title={node.path} className="w-full justify-start">
    {/\.(py|js|ts|sh)$/.test(node.name) ? <Code2 data-icon="inline-start" /> : <FileText data-icon="inline-start" />}<span className="truncate">{node.name}</span>
  </Button> : <details open key={node.path} className="group/folder"><summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"><ChevronRight className="size-3 shrink-0 transition-transform group-open/folder:rotate-90" /><Folder className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{node.name}</span></summary><div className="ml-3 border-l border-border pl-2">{render(node.children)}</div></details>);
  return <div className="grid min-h-96 shrink-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[240px_minmax(0,1fr)] md:grid-rows-1" data-testid="skill-explorer">
    <aside aria-label={t("skillFiles")} className="min-h-32 max-h-48 overflow-auto border-b border-border bg-muted/20 p-3 md:min-h-0 md:max-h-none md:border-b-0 md:border-r">
      <h2 className="mb-3 px-2 text-xs font-medium text-muted-foreground">{t("explorerFiles", { count: files.length })}</h2>{render(tree(files))}
    </aside>
    <section aria-label={t("fileContent")} className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3"><span className="truncate font-mono text-xs" title={selected.path}>{selected.path}</span>
        <div className="flex shrink-0 items-center gap-2"><span className="text-xs text-muted-foreground">{canEdit ? t("edit") : t("readonly")}</span><Button size="icon" variant="ghost" aria-label={copied ? t("copiedFile") : t("copyFile")} onClick={() => void navigator.clipboard.writeText(selected.content).then(() => setCopied(true)).catch(() => toast.error(t("copyFailed")))}>{copied ? <Check /> : <Copy />}</Button></div>
      </div>
      <Suspense fallback={<p role="status" className="flex-1 p-4 text-sm text-muted-foreground">{t("loadingSkill")}</p>}><CodeEditor key={selected.path} filename={selected.path} value={selected.content} readOnly={!canEdit || saving} aria-label={`${t("fileContent")}: ${selected.path}`} className="min-h-80 flex-1 rounded-none border-0" onChange={content => { if (!canEdit || savingRef.current) return; setCopied(false); setDraft(previous => ({ ...previous, [selected.path]: content })); }} /></Suspense>
      {error && <p role="alert" className="px-4 py-2 text-sm text-destructive">{error}</p>}
      {canEdit && <div className="flex shrink-0 gap-2 border-t border-border px-4 py-3"><Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => { setDraft({}); setError(null); }}><X data-icon="inline-start" />{t("cancel")}</Button><Button type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}{t("save")}</Button></div>}
    </section>
  </div>;
}
