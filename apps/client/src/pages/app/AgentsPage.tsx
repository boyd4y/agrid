import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Cloud, Monitor, Pencil, Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { Button } from "@tabdo/ui/components/button";
import { Badge } from "@tabdo/ui/components/badge";
import { api, type MemberOption } from "@/lib/api";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { HARNESS_LABELS } from "@/lib/harness";
import { HarnessLogo } from "@/components/icons/HarnessLogos";
import { useArrayPagination } from "@/hooks/useListPagination";
import { ListPagination } from "@/components/controls/list-pagination";
import { MemberDirectory, MemberDirectoryRow } from "@/components/members/MemberDirectory";

export function AgentsPage() {
  const { t } = useTranslation(["app", "common", "errors"]);
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
      if (id === requestId.current) setError(e instanceof Error ? e.message : t("errors:agentsLoadFailed"));
    } finally { if (id === requestId.current) setLoading(false); }
  }, [t]);
  useEffect(() => {
    const onChange = () => void refresh();
    void refresh(); window.addEventListener("tabdo:agents-changed", onChange);
    return () => { requestId.current++; window.removeEventListener("tabdo:agents-changed", onChange); };
  }, [refresh]);
  const visible = agents.filter((agent) => agent.name.toLowerCase().includes(query.trim().toLowerCase()));
  const pagination = useArrayPagination(visible);
  useEffect(() => pagination.resetPage(), [query, pagination.resetPage]);
  const create = canManage ? <Button asChild size="sm"><Link to="/app/agents/new"><Plus data-icon="inline-start" />{t("agents.create")}</Link></Button> : undefined;
  return <AppPage contentWidth="standard" data-testid="agents-page" className="items-center" header={<AppPageHeader page="agents" description={t("agents.description")}>
    <Button variant="ghost" size="icon" aria-label={t("agents.refreshAria")} disabled={loading} onClick={() => void refresh()}><RefreshCw data-icon="inline-start" /></Button>{create}
  </AppPageHeader>}>
    <MemberDirectory label={t("nav.agents")} count={agents.length} query={query} onQueryChange={setQuery} loading={loading} error={error} onRetry={() => void refresh()}
      pagination={visible.length > 0 && <ListPagination page={pagination.page} hasNext={pagination.hasNext} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />}
      empty={!agents.length ? <AppEmptyState className="flex-1" illustration={NOTIOLY.fastInternet} title={t("agents.emptyTitle")} description={t("agents.emptyDescription")} action={create} />
        : !visible.length ? <AppEmptyState className="flex-1" illustration={NOTIOLY.fastInternet} title={t("agents.noMatchTitle")} description={t("agents.noMatchDescription")} /> : undefined}>
            {pagination.items.map((agent) => {
              const persona = agent.agent?.persona;
              const harness = persona?.defaultHarness ?? "pi";
              const model = persona?.defaultModel ?? "__harness_default__";
              const sandbox = persona?.runtime === "sandbox" || (!persona?.runtime && harness !== "pi");
              const skills = enabledNames.filter((name) => !persona?.skillNames || persona.skillNames.includes(name));
              return <MemberDirectoryRow key={agent.id} member={agent}
                to={canManage ? `/app/agents/${agent.id}/edit` : undefined}
                description={persona?.systemPrompt || t("agents.noPersona")}
                metadata={<>
                    <Badge variant="outline" className="gap-1"><HarnessLogo id={harness} className="size-3" />{HARNESS_LABELS[harness].split(" ")[0]}</Badge>
                    <Badge variant="outline" className="gap-1">{sandbox ? <Cloud className="size-3" /> : <Monitor className="size-3" />}{sandbox ? t("agents.sandbox") : t("agents.local")}</Badge>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground"><BookOpen className="size-3" />{t("agents.skillCount", { count: skills.length })}</span>
                    <span className="max-w-full truncate text-xs text-muted-foreground">{model === "__harness_default__" ? t("agents.defaultModel") : model.replace(/^openrouter\//, "")}</span>
                </>}
                action={canManage && <Button variant="outline" size="sm" asChild><Link to={`/app/agents/${agent.id}/edit`} aria-label={t("agents.editAria", { name: agent.name })}><Pencil data-icon="inline-start" />{t("common:edit")}</Link></Button>}
              />;
            })}
    </MemberDirectory>
  </AppPage>;
}
