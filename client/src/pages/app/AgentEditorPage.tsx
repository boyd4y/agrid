import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Save, X, Settings2, BookOpen, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";
import type { SkillSummary } from "@tabdo/shared";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldSet } from "@/components/ui/field";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type MemberOption } from "@/lib/api";
import { type HarnessId } from "@/lib/harness";
import { AgentBasicFields, AgentSkillFields, type AgentBasicValues, type HarnessStatus } from "@/components/agents/AgentConfigurationFields";
import { AgentToolFields } from "@/components/agents/AgentToolFields";
import { cn } from "@/lib/utils";

/** Shared create/edit form; deep links restore configuration from the server. */
export function AgentEditorPage() {
  const { agentId } = useParams(), navigate = useNavigate();
  const [editing, setEditing] = useState<MemberOption | null>(null), [loading, setLoading] = useState(true), [ready, setReady] = useState(false), [canManage, setCanManage] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const [agentName, setAgentName] = useState(""), [persona, setPersona] = useState("你是 tabdo 的 AI 助手，用简洁中文帮助用户处理数据。");
  const [harness, setHarness] = useState<HarnessId>("pi"), [model, setModel] = useState("openrouter/free"), [harnesses, setHarnesses] = useState<HarnessStatus[]>([]);
  const [runtime, setRuntime] = useState<"local" | "sandbox">("local");
  const [skills, setSkills] = useState<SkillSummary[]>([]), [skillNames, setSkillNames] = useState<string[]>([]);
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [image, setImage] = useState<string | null>(null), [avatarProcessing, setAvatarProcessing] = useState(false);
  const selectedSkills = skills.filter((skill) => skill.enabled && skillNames.includes(skill.name));
  const savingRef = useRef(false);
  const [initialConfiguration, setInitialConfiguration] = useState("");
  const [section, setSection] = useState("basic");
  const formRef = useRef<HTMLFormElement>(null);
  const values: AgentBasicValues = { name: agentName, image, persona, harness, model, runtime };
  const updateValues = (patch: Partial<AgentBasicValues>) => {
    if (patch.image !== undefined) setImage(patch.image);
    if (patch.name !== undefined) setAgentName(patch.name);
    if (patch.persona !== undefined) setPersona(patch.persona);
    if (patch.harness !== undefined) { if (patch.harness !== harness) setDisabledTools([]); setHarness(patch.harness); }
    if (patch.model !== undefined) setModel(patch.model);
    if (patch.runtime !== undefined) setRuntime(patch.runtime);
  };
  const configuration = { name: agentName.trim(), image, persona: { systemPrompt: persona.trim(), defaultHarness: harness, defaultModel: model.trim(), runtime, skillNames: selectedSkills.map((skill) => skill.name), disabledTools: [...disabledTools].sort() } };
  const dirty = JSON.stringify(configuration) !== initialConfiguration;
  const basicValid = Boolean(agentName.trim() && persona.trim() && model.trim());
  useEffect(() => {
    let cancelled = false;setSection("basic");setLoading(true);setReady(false);setCreateError(null);setEditing(null);
    void Promise.all([api.listSkills(), agentId ? api.listMembers() : Promise.resolve(null), fetch("/api/chat/status").then((r) => { if (!r.ok) throw new Error("运行配置加载失败");return r.json(); })]).then(([library, members, status]) => {
      if (cancelled) return;
      setSkills(library.skills);setCanManage(library.canManage);setHarnesses(status.harnesses ?? []);
      const agent = agentId ? members?.members.find((m) => m.id === agentId && m.kind === "agent") : null;
      if (agentId && !agent) throw new Error("智能体不存在或不属于当前工作区");
      const selected = agent?.agent?.persona?.defaultHarness ?? "pi";
      setImage(agent?.image ?? null);setEditing(agent ?? null);setAgentName(agent?.name ?? "");setPersona(agent?.agent?.persona?.systemPrompt ?? "你是 tabdo 的 AI 助手，用简洁中文帮助用户处理数据。");
      setHarness(agent?.agent?.persona?.defaultHarness ?? "pi");setModel(agent?.agent?.persona?.defaultModel ?? status.harnesses?.find((h: HarnessStatus) => h.id === selected)?.defaultModel ?? "openrouter/free");
      setRuntime(agent?.agent?.persona?.runtime ?? status.harnesses?.find((h: HarnessStatus) => h.id === selected)?.defaultRuntime ?? (selected === "pi" ? "local" : "sandbox"));
      const selectedNames = library.skills.filter((s) => s.enabled && (!agent?.agent?.persona?.skillNames || agent.agent.persona.skillNames.includes(s.name))).map((s) => s.name);
      setSkillNames(selectedNames); setDisabledTools(agent?.agent?.persona?.disabledTools ?? []);
      setInitialConfiguration(JSON.stringify({ name: (agent?.name ?? "").trim(), image: agent?.image ?? null, persona: {
        systemPrompt: (agent?.agent?.persona?.systemPrompt ?? "你是 tabdo 的 AI 助手，用简洁中文帮助用户处理数据。").trim(),
        defaultHarness: selected,
        defaultModel: (agent?.agent?.persona?.defaultModel ?? status.harnesses?.find((h: HarnessStatus) => h.id === selected)?.defaultModel ?? "openrouter/free").trim(),
        runtime: agent?.agent?.persona?.runtime ?? status.harnesses?.find((h: HarnessStatus) => h.id === selected)?.defaultRuntime ?? (selected === "pi" ? "local" : "sandbox"),
        skillNames: selectedNames, disabledTools: [...(agent?.agent?.persona?.disabledTools ?? [])].sort(),
      }}));setReady(true);
    }).catch((e: Error) => { if (!cancelled) setCreateError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [agentId, retry]);
  const createAgent = async (e: React.FormEvent) => {
    e.preventDefault();if (avatarProcessing || savingRef.current || !ready || !canManage || (agentId && !editing)) return;
    if (!basicValid) { setSection("basic"); setCreateError("请填写名称、人设和模型。"); return; }
    if (agentId && !dirty) return;
    if (!agentId && section !== "tools") { if (formRef.current?.reportValidity()) setSection(section === "basic" ? "skills" : "tools"); return; }
    savingRef.current = true;setBusy(true);setCreateError(null);
    try {
      if (editing) await api.updateAgent(editing.id, { ...configuration, image: image === (editing.image ?? null) ? undefined : image });else await api.createAgent({ ...configuration, role: "member" });
      toast.success(editing ? "智能体配置已保存" : "智能体已创建");navigate("/app/agents");
    } catch (e) { setCreateError(e instanceof Error ? e.message : "保存失败"); } finally { savingRef.current = false;setBusy(false); }
  };
  const steps = [{ id: "basic", label: "基础信息", icon: Settings2 }, { id: "skills", label: "选择 Skill", icon: BookOpen }, { id: "tools", label: "配置工具", icon: Wrench }];
  const stepIndex = steps.findIndex((step) => step.id === section);
  const sectionTitle = section === "basic" ? "基础信息" : section === "skills" ? "Skill" : "工具";
  const sectionDescription = section === "basic" ? "设置名称、人设和运行方式。" : section === "skills" ? "选择智能体按需学习的工作方法，只列出已选择且启用的 Skill。" : "查看智能体可调用的工具，按需要开启或关闭。";
  return <AppPage className="items-center" header={<AppPageHeader page="agents" title={agentId ? editing?.name ?? "编辑智能体" : "创建智能体"} description={agentId ? "编辑智能体配置" : "设置基础信息、Skill 和工具"}>
    <Button variant="ghost" size="sm" disabled={busy || avatarProcessing} onClick={() => navigate("/app/agents")}><ArrowLeft data-icon="inline-start" />返回列表</Button>
  </AppPageHeader>}>
    {loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />读取智能体配置…</p>
      : !ready ? <div className="flex flex-col items-center gap-3"><FieldError>{createError}</FieldError><Button variant="outline" onClick={() => setRetry((n) => n + 1)}><RefreshCw data-icon="inline-start" />重试</Button></div>
      : !canManage ? <p className="text-sm text-muted-foreground">只有工作区管理员可以配置智能体。</p>
      : <Card padding="none" className="@container/agent-editor w-full max-w-6xl shrink-0 overflow-hidden">
        <CardContent>
          <form ref={formRef} onSubmit={createAgent} data-testid="agent-create-form">
            <FieldSet disabled={busy} className="gap-0">
              {agentId ? (
                <Tabs value={section} onValueChange={(value) => { setSection(value); setCreateError(null); }} orientation="vertical" className="flex-col gap-0 @3xl/agent-editor:flex-row">
                  <div className="shrink-0 border-b p-4 @3xl/agent-editor:w-52 @3xl/agent-editor:border-b-0 @3xl/agent-editor:border-r @5xl/agent-editor:w-60">
                    <TabsList aria-label="智能体配置" className="h-auto w-full flex-row items-stretch gap-1 @3xl/agent-editor:flex-col">
                      <TabsTrigger value="basic" disabled={busy || avatarProcessing} className="min-h-11 flex-1 justify-start px-3"><Settings2 />基础信息</TabsTrigger>
                      <TabsTrigger value="skills" disabled={busy || avatarProcessing} className="min-h-11 flex-1 justify-start px-3"><BookOpen />Skill</TabsTrigger>
                      <TabsTrigger value="tools" disabled={busy || avatarProcessing} className="min-h-11 flex-1 justify-start px-3"><Wrench />工具</TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent value="basic" className="min-w-0 p-6 @5xl/agent-editor:p-8">
                    <div className="mb-6 flex flex-col gap-1"><h2 className="font-semibold">基础信息</h2><p className="text-sm text-muted-foreground">设置名称、人设和运行方式。</p></div>
                    <AgentBasicFields value={values} onChange={updateValues} harnesses={harnesses} disabled={busy} onAvatarProcessingChange={setAvatarProcessing} harnessLocked />
                  </TabsContent>
                  <TabsContent value="skills" className="min-w-0 p-6 @5xl/agent-editor:p-8">
                    <div className="mb-6 flex flex-col gap-1"><h2 className="font-semibold">Skill</h2><p className="text-sm text-muted-foreground">选择智能体按需学习的工作方法。</p></div>
                    <AgentSkillFields skills={skills} selected={skillNames} onChange={setSkillNames} disabled={busy} />
                  </TabsContent>
                  <TabsContent value="tools" className="min-w-0 p-6 @5xl/agent-editor:p-8">
                    <div className="mb-6 flex flex-col gap-1"><h2 className="font-semibold">工具</h2><p className="text-sm text-muted-foreground">查看智能体可调用的工具，按需要开启或关闭。</p></div>
                    <AgentToolFields harness={harness} disabledTools={disabledTools} onChange={setDisabledTools} disabled={busy} />
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="flex flex-col @3xl/agent-editor:flex-row">
                  <nav aria-label="创建智能体步骤" className="shrink-0 border-b p-4 @3xl/agent-editor:w-52 @3xl/agent-editor:border-b-0 @3xl/agent-editor:border-r @5xl/agent-editor:w-60">
                    <ol className="flex gap-2 @3xl/agent-editor:flex-col">
                      {steps.map((step, index) => <li key={step.id} className="min-w-0 flex-1">
                        <Button type="button" variant={section === step.id ? "secondary" : "ghost"} className="h-11 w-full justify-start" disabled={busy || avatarProcessing || (index > 0 && !basicValid)} aria-current={section === step.id ? "step" : undefined}
                          onClick={() => { if (step.id === "basic" || formRef.current?.reportValidity()) { setSection(step.id); setCreateError(null); } }}>
                          <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border", section === step.id && "border-primary bg-primary text-primary-foreground")}>
                            {index < stepIndex ? <Check aria-hidden /> : index + 1}
                          </span><step.icon data-icon="inline-start" />{step.label}
                        </Button>
                      </li>)}
                    </ol>
                  </nav>
                  <div className="min-w-0 flex-1 p-6 @5xl/agent-editor:p-8">
                    <div className="mb-6 flex flex-col gap-1"><h2 className="font-semibold">{sectionTitle}</h2><p className="text-sm text-muted-foreground">{sectionDescription}</p></div>
                    {section === "basic" ? <AgentBasicFields value={values} onChange={updateValues} harnesses={harnesses} disabled={busy} onAvatarProcessingChange={setAvatarProcessing} harnessLocked={false} />  : section === "skills" ? <AgentSkillFields skills={skills} selected={skillNames} onChange={setSkillNames} disabled={busy} /> : <AgentToolFields harness={harness} disabledTools={disabledTools} onChange={setDisabledTools} disabled={busy} />}
                  </div>
                </div>
              )}
              <Separator />
              <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                <div role="status" className="min-w-0 text-sm text-muted-foreground">{createError ? <FieldError role="alert">{createError}</FieldError> : agentId ? !basicValid ? "请完善基础信息后保存" : dirty ? "有未保存的修改" : "所有修改已保存" : `第 ${stepIndex + 1} 步，共 ${steps.length} 步`}</div>
                <Field orientation="horizontal" className="w-auto flex-wrap justify-end">
                  <Button type="button" variant="outline" disabled={busy || avatarProcessing} onClick={() => navigate("/app/agents")}><X data-icon="inline-start" />取消</Button>
                  {!agentId && stepIndex > 0 && <Button type="button" variant="outline" onClick={() => setSection(steps[stepIndex - 1].id)}><ArrowLeft data-icon="inline-start" />上一步</Button>}
                  <Button type="submit" disabled={busy || avatarProcessing || !basicValid || (Boolean(agentId) && !dirty)}>
                    {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : agentId ? <Save data-icon="inline-start" /> : section !== "tools" ? <ArrowRight data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                    {busy ? "保存中…" : agentId ? "保存修改" : section !== "tools" ? "下一步" : "创建智能体"}
                  </Button>
                </Field>
              </div>
            </FieldSet>
          </form>
        </CardContent>
      </Card>}
  </AppPage>;
}
