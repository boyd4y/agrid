import { useState } from "react";
import { Check, ChevronRight, Code2, Copy, FileText, Folder } from "lucide-react";
import type { SkillDocument, SkillFile } from "@tabdo/shared";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

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

export function SkillExplorer({ skill }: { skill: SkillDocument }) {
  const { t } = useTranslation("common");
  const files = [{ path: "SKILL.md", content: skill.document }, ...skill.files];
  const [path, setPath] = useState("SKILL.md");
  const [copied, setCopied] = useState(false);
  const selected = files.find((file) => file.path === path) ?? files[0];
  const render = (nodes: Node[]) => nodes.map((node) => node.file ? <Button variant={selected.path === node.path ? "secondary" : "ghost"} size="sm" type="button" key={node.path} aria-pressed={selected.path === node.path} onClick={() => { setPath(node.path); setCopied(false); }} title={node.path} className="w-full justify-start">
    {/\.(py|js|ts|sh)$/.test(node.name) ? <Code2 data-icon="inline-start" /> : <FileText data-icon="inline-start" />}<span className="truncate">{node.name}</span>
  </Button> : <details open key={node.path} className="group/folder"><summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"><ChevronRight className="size-3 shrink-0 transition-transform group-open/folder:rotate-90" /><Folder className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{node.name}</span></summary><div className="ml-3 border-l border-border pl-2">{render(node.children)}</div></details>);
  return <div className="grid min-h-96 shrink-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[240px_minmax(0,1fr)] md:grid-rows-1" data-testid="skill-explorer">
    <aside aria-label={t("skillFiles")} className="min-h-32 max-h-48 overflow-auto border-b border-border bg-muted/20 p-3 md:min-h-0 md:max-h-none md:border-b-0 md:border-r">
      <h2 className="mb-3 px-2 text-xs font-medium text-muted-foreground">{t("explorerFiles", { count: files.length })}</h2>{render(tree(files))}
    </aside>
    <section aria-label={t("fileContent")} className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3"><span className="truncate font-mono text-xs" title={selected.path}>{selected.path}</span>
        <div className="flex shrink-0 items-center gap-2"><span className="text-xs text-muted-foreground">{t("readonly")}</span><Button size="icon" variant="ghost" aria-label={copied ? t("copiedFile") : t("copyFile")} onClick={() => void navigator.clipboard.writeText(selected.content).then(() => setCopied(true)).catch(() => toast.error(t("copyFailed")))}>{copied ? <Check /> : <Copy />}</Button></div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" tabIndex={0}><pre className="min-w-max py-4 font-mono text-[13px] leading-6">{selected.content.split("\n").map((line, index) => <div key={index} className="flex"><span aria-hidden className="sticky left-0 w-12 shrink-0 select-none bg-card pr-3 text-right text-muted-foreground/60">{index + 1}</span><code className="pr-6">{line || " "}</code></div>)}</pre></div>
    </section>
  </div>;
}
