import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Loader2, Search } from "lucide-react";
import type { SkillLibrary, SkillSummary } from "@tabdo/shared";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";

export function SkillsPage() {
  const [library, setLibrary] = useState<SkillLibrary | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { const next = await api.listSkills(); setLibrary(next); setError(null); }, []);
  useEffect(() => { void load().catch((e: Error) => setError(e.message)); }, [load]);
  const toggle = async (skill: SkillSummary, enabled: boolean) => {
    setBusy(skill.id);
    try { await api.setSkillEnabled(skill.id, enabled); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const visible = library?.skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <AppPage className="gap-4" header={<AppPageHeader page="skills" description="平台内置技能，包含操作说明、参考资料和脚本。" />}>
    <div className="relative w-full max-w-sm"><Search aria-hidden className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="搜索技能" className="pl-9" placeholder="搜索技能" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">{error}<Button size="sm" variant="outline" onClick={() => void load().catch((e: Error) => setError(e.message))}>重试</Button></div>}
    {!library && !error ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />加载技能…</p> : library && <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">技能</th><th className="px-4 py-3 font-medium">用途</th><th className="whitespace-nowrap px-4 py-3 font-medium">文件</th><th className="px-4 py-3 font-medium">启用</th><th className="w-12"><span className="sr-only">查看详情</span></th></tr></thead>
        <tbody className="divide-y divide-border">{visible.map((skill) => <tr key={skill.id} className="group hover:bg-muted/30">
          <td className="px-4 py-4"><Link to={`/app/skills/${encodeURIComponent(skill.id)}`} className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{skill.name}</Link><p className="mt-1 text-xs text-muted-foreground">{skill.builtin ? "平台内置 · 只读" : "工作区技能"}</p></td>
          <td className="min-w-52 max-w-2xl px-4 py-4 text-muted-foreground">{skill.description}</td><td className="px-4 py-4 tabular-nums">{skill.fileCount}</td>
          <td className="px-4 py-4"><Switch aria-label={`${skill.name} 启用`} checked={skill.enabled} disabled={!library.canManage || busy !== null} onCheckedChange={(enabled) => void toggle(skill, enabled)} /></td>
          <td className="pr-4"><Button asChild size="icon" variant="ghost"><Link to={`/app/skills/${encodeURIComponent(skill.id)}`} aria-label={`查看 ${skill.name}`}><ChevronRight /></Link></Button></td>
        </tr>)}</tbody>
      </table>
      {!visible.length && <p className="py-16 text-center text-sm text-muted-foreground">没有匹配的技能</p>}
    </div>}
  </AppPage>;
}
