import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Save, X, Settings2, BookOpen, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_DISABLED_PLATFORM_TOOLS, PLATFORM_TOOL_IDS, type SkillSummary, type SandboxProvider } from "@tabdo/shared";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { Card } from "@tabdo/ui/components/card";
import { Button } from "@tabdo/ui/components/button";
import { FieldError, FieldSet } from "@tabdo/ui/components/field";
import { Separator } from "@tabdo/ui/components/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tabdo/ui/components/tabs";
import { api, type MemberOption } from "@/lib/api";
import { type HarnessId } from "@/lib/harness";
import { AgentBasicFields, AgentSkillFields, type AgentBasicValues, type HarnessStatus } from "@/components/agents/AgentConfigurationFields";
import { AgentToolFields } from "@/components/agents/AgentToolFields";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

/** Shared create/edit form; deep links restore configuration from the server. */
export function AgentEditorPage() {
  const { t } = useTranslation(["agents", "common"]);
  const { agentId } = useParams(), navigate = useNavigate();
  const [editing, setEditing] = useState<MemberOption | null>(null), [loading, setLoading] = useState(true), [ready, setReady] = useState(false), [canManage, setCanManage] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const [agentName, setAgentName] = useState(""), [persona, setPersona] = useState(t("defaultPersona"));
  const [harness, setHarness] = useState<HarnessId>("pi"), [model, setModel] = useState("__harness_default__"), [harnesses, setHarnesses] = useState<HarnessStatus[]>([]);
  const [sandboxProvider, setSandboxProvider] = useState<SandboxProvider>("vercel");
  const [runtime, setRuntime] = useState<"local" | "sandbox">("local");
  const [skills, setSkills] = useState<SkillSummary[]>([]), [skillNames, setSkillNames] = useState<string[]>([]);
  const [disabledTools, setDisabledTools] = useState<string[]>([...DEFAULT_DISABLED_PLATFORM_TOOLS]);
  const [image, setImage] = useState<string | null>(null), [avatarProcessing, setAvatarProcessing] = useState(false);
  const selectedSkills = skills.filter((skill) => skill.enabled && skillNames.includes(skill.name));
  const savingRef = useRef(false);
  const [initialConfiguration, setInitialConfiguration] = useState("");
  const [section, setSection] = useState("basic");
  const formRef = useRef<HTMLFormElement>(null);
  const values: AgentBasicValues = { name: agentName, image, persona, harness, model, runtime, sandboxProvider };
  const updateValues = (patch: Partial<AgentBasicValues>) => {
    if (patch.image !== undefined) setImage(patch.image);
    if (patch.name !== undefined) setAgentName(patch.name);
    if (patch.persona !== undefined) setPersona(patch.persona);
    if (patch.harness !== undefined) setHarness(patch.harness);
    if (patch.model !== undefined) setModel(patch.model);
    if (patch.sandboxProvider !== undefined) setSandboxProvider(patch.sandboxProvider);
    if (patch.runtime !== undefined) setRuntime(patch.runtime);
  };
  const configuration = { name: agentName.trim(), image, persona: { systemPrompt: persona.trim(), defaultHarness: "pi" as const, defaultModel: "__harness_default__", runtime, sandboxProvider, skillNames: selectedSkills.map((skill) => skill.name), disabledTools: [...disabledTools].sort() } };
  const dirty = JSON.stringify(configuration) !== initialConfiguration;
  const basicValid = Boolean(agentName.trim() && persona.trim());
  useEffect(() => {
    let cancelled = false;setSection("basic");setLoading(true);setReady(false);setCreateError(null);setEditing(null);
    void Promise.all([api.listSkills(), agentId ? api.listMembers() : Promise.resolve(null), fetch("/api/chat/status").then((r) => { if (!r.ok) throw new Error(t("statusLoadFailed"));return r.json(); })]).then(([library, members, status]) => {
      if (cancelled) return;
      setSkills(library.skills);setCanManage(library.canManage);setHarnesses(status.harnesses ?? []);
      const agent = agentId ? members?.members.find((m) => m.id === agentId && m.kind === "agent") : null;
      if (agentId && !agent) throw new Error(t("notFound"));
      const selected = agent?.agent?.persona?.defaultHarness ?? "pi";
      setImage(agent?.image ?? null);setEditing(agent ?? null);setAgentName(agent?.name ?? "");setPersona(agent?.agent?.persona?.systemPrompt ?? t("defaultPersona"));
      setHarness(agent?.agent?.persona?.defaultHarness ?? "pi");setModel("__harness_default__");
      setRuntime(agent?.agent?.persona?.runtime ?? status.harnesses?.find((h: HarnessStatus) => h.id === selected)?.defaultRuntime ?? (selected === "pi" ? "local" : "sandbox"));
      const selectedSandboxProvider = agent?.agent?.persona?.sandboxProvider ?? (agent ? "vercel" : status.defaultSandboxProvider ?? "vercel");
      setSandboxProvider(selectedSandboxProvider);
      const selectedNames = library.skills.filter((s) => s.enabled && (!agent?.agent?.persona?.skillNames || agent.agent.persona.skillNames.includes(s.name))).map((s) => s.name);
      const platformIds = new Set<string>(PLATFORM_TOOL_IDS);
      const selectedDisabledTools = (agent ? agent.agent?.persona?.disabledTools ?? [] : [...DEFAULT_DISABLED_PLATFORM_TOOLS]).filter(id => platformIds.has(id));
      setSkillNames(selectedNames); setDisabledTools(selectedDisabledTools);
      setInitialConfiguration(JSON.stringify({ name: (agent?.name ?? "").trim(), image: agent?.image ?? null, persona: {
        systemPrompt: (agent?.agent?.persona?.systemPrompt ?? t("defaultPersona")).trim(),
        defaultHarness: "pi",
        defaultModel: "__harness_default__",
        runtime: agent?.agent?.persona?.runtime ?? status.harnesses?.find((h: HarnessStatus) => h.id === selected)?.defaultRuntime ?? (selected === "pi" ? "local" : "sandbox"),
        sandboxProvider: selectedSandboxProvider,
        skillNames: selectedNames, disabledTools: [...selectedDisabledTools].sort(),
      }}));setReady(true);
    }).catch((e: Error) => { if (!cancelled) setCreateError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [agentId, retry]);
  const createAgent = async (e: React.FormEvent) => {
    e.preventDefault();if (avatarProcessing || savingRef.current || !ready || !canManage || (agentId && !editing)) return;
    if (!basicValid) { setSection("basic"); setCreateError(t("fillRequired")); return; }
    if (agentId && !dirty) return;
    if (!agentId && section !== "tools") { if (formRef.current?.checkValidity()) setSection(section === "basic" ? "skills" : "tools"); return; }
    savingRef.current = true;setBusy(true);setCreateError(null);
    try {
      if (editing) await api.updateAgent(editing.id, { ...configuration, image: image === (editing.image ?? null) ? undefined : image });else await api.createAgent({ ...configuration, role: "member" });
      toast.success(editing ? t("saved") : t("created"));navigate("/app/agents");
    } catch (e) { setCreateError(e instanceof Error ? e.message : t("saveFailed")); } finally { savingRef.current = false;setBusy(false); }
  };
  const steps = [{ id: "basic", label: t("stepBasic"), icon: Settings2 }, { id: "skills", label: t("stepSkills"), icon: BookOpen }, { id: "tools", label: t("stepTools"), icon: Wrench }];
  const stepIndex = steps.findIndex((step) => step.id === section);
  const sectionTitle = section === "basic" ? t("basic") : section === "skills" ? t("skills") : t("tools");
  const sectionDescription = section === "basic" ? t("basicDesc") : section === "skills" ? t("skillsDesc") : t("toolsDesc");
  return <AppPage contentWidth="standard" header={<AppPageHeader page="agents" title={agentId ? editing?.name ?? t("editAgent") : t("createAgent")} >
    <Button variant="ghost" size="sm" disabled={busy || avatarProcessing} onClick={() => navigate("/app/agents")}><ArrowLeft data-icon="inline-start" />{t("backToList")}</Button>
  </AppPageHeader>}>
    {loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("loadingConfig")}</p>
      : !ready ? <div className="flex flex-col items-center gap-3"><FieldError>{createError}</FieldError><Button variant="outline" onClick={() => setRetry((n) => n + 1)}><RefreshCw data-icon="inline-start" />{t("common:retry")}</Button></div>
      : !canManage ? <p className="text-sm text-muted-foreground">{t("adminOnly")}</p>
      : <Card padding="none" className="@container/agent-editor w-full min-w-0 shrink-0 overflow-hidden" data-testid="agent-editor">
          <form noValidate ref={formRef} onSubmit={createAgent} data-testid="agent-create-form">
            <FieldSet disabled={busy} className="gap-0">
              {agentId ? (
                <Tabs value={section} onValueChange={(value) => { setSection(value); setCreateError(null); }} orientation="vertical" activationMode="manual" className="min-h-[480px] flex-row items-stretch gap-0">
                  <aside className="w-12 shrink-0 border-r p-1 sm:w-40 sm:p-3 md:w-[200px]">
                    <TabsList variant="navigation" aria-label={t("configAria")} className="h-auto w-full flex-col items-stretch gap-1">
                      <TabsTrigger value="basic" aria-label={t("basic")} disabled={busy || avatarProcessing} className="min-h-9 w-full justify-center px-1 sm:justify-start sm:px-2"><Settings2 /><span className="hidden sm:inline">{t("basic")}</span></TabsTrigger>
                      <TabsTrigger value="skills" aria-label={t("skills")} disabled={busy || avatarProcessing} className="min-h-9 w-full justify-center px-1 sm:justify-start sm:px-2"><BookOpen /><span className="hidden sm:inline">{t("skills")}</span></TabsTrigger>
                      <TabsTrigger value="tools" aria-label={t("tools")} disabled={busy || avatarProcessing} className="min-h-9 w-full justify-center px-1 sm:justify-start sm:px-2"><Wrench /><span className="hidden sm:inline">{t("tools")}</span></TabsTrigger>
                    </TabsList>
                  </aside>
                  <TabsContent value="basic" className="min-w-0 flex-1 p-3 sm:p-6">
                    <div className="mb-4 flex flex-col gap-1"><h2 className="font-semibold">{t("basic")}</h2></div>
                    <AgentBasicFields value={values} onChange={updateValues} harnesses={harnesses} disabled={busy} onAvatarProcessingChange={setAvatarProcessing} harnessLocked />
                  </TabsContent>
                  <TabsContent value="skills" className="min-w-0 flex-1 p-3 sm:p-6">
                    <div className="mb-4 flex flex-col gap-1"><h2 className="font-semibold">{t("skills")}</h2><p className="text-sm text-muted-foreground">{t("skillsDescShort")}</p></div>
                    <AgentSkillFields skills={skills} selected={skillNames} onChange={setSkillNames} disabled={busy} />
                  </TabsContent>
                  <TabsContent value="tools" className="min-w-0 flex-1 p-3 sm:p-6">
                    <div className="mb-4 flex flex-col gap-1"><h2 className="font-semibold">{t("tools")}</h2><p className="text-sm text-muted-foreground">{t("toolsDesc")}</p></div>
                    <AgentToolFields harness={harness} disabledTools={disabledTools} onChange={setDisabledTools} disabled={busy} />
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="flex min-h-[480px] gap-0">
                  <nav aria-label={t("createStepsAria")} className="w-12 shrink-0 border-r p-1 sm:w-40 sm:p-3 md:w-[200px]">
                    <ol className="flex flex-col gap-2">
                      {steps.map((step, index) => <li key={step.id} className="min-w-0 flex-1">
                        <Button type="button" variant={section === step.id ? "secondary" : "ghost"} className="w-full justify-center sm:justify-start" disabled={busy || avatarProcessing || (index > 0 && !basicValid)} aria-label={step.label} aria-current={section === step.id ? "step" : undefined}
                          onClick={() => { if (step.id === "basic" || formRef.current?.checkValidity()) { setSection(step.id); setCreateError(null); } }}>
                          <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", section === step.id && "border-primary bg-primary text-primary-foreground")}>
                            {index < stepIndex ? <Check aria-hidden /> : index + 1}
                          </span><step.icon data-icon="inline-start" className="hidden sm:block" /><span className="hidden sm:inline">{step.label}</span>
                        </Button>
                      </li>)}
                    </ol>
                  </nav>
                  <div className="min-w-0 flex-1 p-3 sm:p-6">
                    <div className="mb-4 flex flex-col gap-1"><h2 className="font-semibold">{sectionTitle}</h2>{section !== "basic" && <p className="text-sm text-muted-foreground">{sectionDescription}</p>}</div>
                    {section === "basic" ? <AgentBasicFields value={values} onChange={updateValues} harnesses={harnesses} disabled={busy} onAvatarProcessingChange={setAvatarProcessing} harnessLocked={false} />  : section === "skills" ? <AgentSkillFields skills={skills} selected={skillNames} onChange={setSkillNames} disabled={busy} /> : <AgentToolFields harness={harness} disabledTools={disabledTools} onChange={setDisabledTools} disabled={busy} />}
                  </div>
                </div>
              )}
              <Separator />
              <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-4 sm:px-6">
                <div role="status" className="min-w-0 text-sm text-muted-foreground">{createError ? <FieldError role="alert">{createError}</FieldError> : agentId ? !basicValid ? t("fixBasic") : dirty ? t("unsaved") : t("allSaved") : t("stepOf", { n: stepIndex + 1, total: steps.length })}</div>
                <div className="ml-auto flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" disabled={busy || avatarProcessing} onClick={() => navigate("/app/agents")}><X data-icon="inline-start" />{t("cancel")}</Button>
                  {!agentId && stepIndex > 0 && <Button type="button" variant="outline" onClick={() => setSection(steps[stepIndex - 1].id)}><ArrowLeft data-icon="inline-start" />{t("prev")}</Button>}
                  <Button type="submit" disabled={busy || avatarProcessing || !basicValid || (Boolean(agentId) && !dirty)}>
                    {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : agentId ? <Save data-icon="inline-start" /> : section !== "tools" ? <ArrowRight data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                    {busy ? t("saving") : agentId ? t("saveChanges") : section !== "tools" ? t("next") : t("createAgent")}
                  </Button>
                </div>
              </div>
            </FieldSet>
          </form>
      </Card>}
  </AppPage>;
}
