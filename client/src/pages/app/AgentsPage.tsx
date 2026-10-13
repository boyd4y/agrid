import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Cloud, Monitor, Pencil, Plus, RefreshCw } from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, type MemberOption } from "@/lib/api";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { HARNESS_LABELS } from "@/lib/harness";
import { HarnessLogo } from "@/components/icons/HarnessLogos";
import { MemberDirectory, MemberDirectoryRow } from "@/components/members/MemberDirectory";

export function AgentsPage() {
  const [agents, setAgents] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [enabledNames, setEnabledNames] = useState<string[]>([]);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true); setError(null);
    try {
      const [members, library] = await Promise.all([api.listMembers(), api.listSkills()]);
      if (id !== requestId.current) return;
      setAgents(members.members.filter((m) => m.kind === "agent"));
      setCanManage(library.canManage);
      setEnabledNames(library.skills.filter((skill) => skill.enabled).map((skill) => skill.name));
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : "智能体加载失败");
    } finally { if (id === requestId.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const onChange = () => void refresh();
    void refresh(); window.addEventListener("tabdo:agents-changed", onChange);
    return () => { requestId.current++; window.removeEventListener("tabdo:agents-changed", onChange); };
  }, [refresh]);
  const visible = agents.filter((agent) => agent.name.toLowerCase().includes(query.trim().toLowerCase()));
  const create = canManage ? <Button asChild size="sm"><Link to="/app/agents/new"><Plus data-icon="inline-start" />创建智能体</Link></Button> : undefined;
  return <AppPage data-testid="agents-page" className="items-center" header={<AppPageHeader page="agents" description="设置人设与技能，让智能体按你的工作方式处理数据。">
    <Button variant="ghost" size="icon" aria-label="刷新智能体" disabled={loading} onClick={() => void refresh()}><RefreshCw data-icon="inline-start" /></Button>{create}
  </AppPageHeader>}>
    <MemberDirectory label="智能体" count={agents.length} query={query} onQueryChange={setQuery} loading={loading} error={error} onRetry={() => void refresh()}
      empty={!agents.length ? <AppEmptyState className="flex-1" illustration={NOTIOLY.fastInternet} title="还没有智能体" description="设置人设与 Skill，创建你的第一个智能体。" action={create} />
        : !visible.length ? <AppEmptyState className="flex-1" illustration={NOTIOLY.fastInternet} title="没有匹配的智能体" description="试试其他名称。" /> : undefined}>
            {visible.map((agent) => {
              const persona = agent.agent?.persona;
              const harness = persona?.defaultHarness ?? "pi";
              const model = persona?.defaultModel ?? "openrouter/free";
              const sandbox = persona?.runtime === "sandbox" || (!persona?.runtime && harness !== "pi");
              const skills = enabledNames.filter((name) => !persona?.skillNames || persona.skillNames.includes(name));
              return <MemberDirectoryRow key={agent.id} member={agent}
                title={canManage ? <Link className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" to={`/app/agents/${agent.id}/edit`}>{agent.name}</Link> : agent.name}
                description={persona?.systemPrompt || "尚未设置人设"}
                metadata={<>

                    <Badge variant="outline" className="gap-1"><HarnessLogo id={harness} className="size-3" />{HARNESS_LABELS[harness].split(" ")[0]}</Badge>
                    <Badge variant="outline" className="gap-1">{sandbox ? <Cloud className="size-3" /> : <Monitor className="size-3" />}{sandbox ? "Sandbox" : "本地"}</Badge>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground"><BookOpen className="size-3" />{skills.length} 个 Skill</span>
                    <span className="max-w-full truncate text-xs text-muted-foreground">{model === "__harness_default__" ? "默认模型" : model.replace(/^openrouter\//, "")}</span>
                </>}
                action={canManage && <Button variant="outline" size="sm" asChild><Link to={`/app/agents/${agent.id}/edit`} aria-label={`编辑 ${agent.name}`}><Pencil data-icon="inline-start" />编辑</Link></Button>}
              />;
            })}
    </MemberDirectory>
  </AppPage>;
}
