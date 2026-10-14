import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Save, X } from "lucide-react";
import type { AutomationRule, AutomationSource } from "@tabdo/shared";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { AutomationRunsSheet } from "@/components/automation/AutomationRunsSheet";
import { ScheduleFields } from "@/components/automation/ScheduleFields";
import { Button } from "@tabdo/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@tabdo/ui/components/card";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@tabdo/ui/components/field";
import { Input } from "@tabdo/ui/components/input";
import { Textarea } from "@tabdo/ui/components/textarea";
import { Switch } from "@tabdo/ui/components/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { Separator } from "@tabdo/ui/components/separator";
import { api } from "@/lib/api";
import { notifyDataChanged } from "@/lib/data-changes";
import { useMemberOptions } from "@/hooks/useMemberOptions";

type Schedule = Extract<AutomationSource, { kind: "schedule" }>;
export function ScheduledTaskDetailPage() {
  const { t } = useTranslation("automation"), { automationId } = useParams(), navigate = useNavigate();
  const agents = useMemberOptions().filter(member => member.kind === "agent");
  const [rule, setRule] = useState<AutomationRule | null>(null), [loading, setLoading] = useState(Boolean(automationId)), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [name, setName] = useState(""), [agentUserId, setAgentUserId] = useState(""), [prompt, setPrompt] = useState(""), [enabled, setEnabled] = useState(true), [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [source, setSource] = useState<Schedule>({ kind: "schedule", cron: "0 9 * * *", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  useEffect(() => {
    if (!automationId) return;
    let cancelled = false; setLoading(true); setError(null);
    void api.getAutomation(automationId).then(rule => {
      if (cancelled) return;
      if (rule.source.kind !== "schedule") { navigate(`/app/automations/${rule.id}`, { replace: true }); return; }
      setRule(rule); setName(rule.name); setEnabled(rule.enabled); setSource(rule.source);
      const action = rule.actions.find(action => action.type === "run_agent");
      setAgentUserId(action?.type === "run_agent" ? action.agentUserId ?? "" : "");
      setPrompt(action?.type === "run_agent" ? action.prompt ?? "" : "");
    }).catch(error => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [automationId, retry, navigate]);
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(null);
    try {
      const data = { name: name.trim(), source, enabled, trigger: { type: "schedule_due" as const }, conditions: [], eventConditions: [], conditionLogic: "and" as const, actions: [{ type: "run_agent" as const, agentUserId, prompt: prompt.trim() }] };
      if (rule) await api.updateAutomation(rule.id, data); else await api.createSourceAutomation(data);
      notifyDataChanged(); navigate("/app/schedules");
    } catch (error) { setError(error instanceof Error ? error.message : t("saveFailed")); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <AppPage contentWidth="standard" header={<AppPageHeader page="schedules" description={automationId ? rule?.name ?? t("scheduled.edit") : t("scheduled.new")}><Button variant="ghost" size="sm" disabled={saving} onClick={() => navigate("/app/schedules")}><ArrowLeft data-icon="inline-start" />{t("backToList")}</Button>{rule && <AutomationRunsSheet automationId={rule.id} name={rule.name} />}</AppPageHeader>}>
    {loading ? <p role="status">{t("loading")}</p> : automationId && !rule ? <ListErrorState description={error} onRetry={() => setRetry(value => value + 1)} /> : <Card padding="lg" className="mx-auto my-auto w-full max-w-3xl shrink-0" data-testid="scheduled-task-editor">
      <CardHeader><CardTitle>{t(automationId ? "scheduled.edit" : "scheduled.new")}</CardTitle><CardDescription>{t("scheduled.description")}</CardDescription></CardHeader>
      <CardContent><fieldset disabled={saving} className="flex min-w-0 flex-col gap-6">
        <FieldGroup className="flex-row items-end gap-4"><Field className="min-w-0"><FieldLabel htmlFor="scheduled-name">{t("scheduled.name")}</FieldLabel><Input id="scheduled-name" value={name} onChange={event => setName(event.target.value)} placeholder={t("scheduled.namePlaceholder")} /></Field><Field orientation="horizontal" className="w-auto shrink-0 pb-2"><Switch id="scheduled-enabled" checked={enabled} onCheckedChange={setEnabled} /><FieldLabel htmlFor="scheduled-enabled">{t("enabled")}</FieldLabel></Field></FieldGroup>
        <FieldGroup className="gap-4"><Field><FieldLabel>{t("pickAgent")}</FieldLabel>{agents.length ? <Select value={agentUserId} onValueChange={setAgentUserId}><SelectTrigger aria-label={t("pickAgent")}><SelectValue placeholder={t("pickAgent")} /></SelectTrigger><SelectContent><SelectGroup>{agents.map(agent => <SelectItem key={agent.userId} value={agent.userId}>{agent.name}</SelectItem>)}</SelectGroup></SelectContent></Select> : <FieldDescription>{t("scheduled.noAgents")} <Button asChild size="sm" variant="outline"><Link to="/app/agents/new">{t("scheduled.createAgent")}</Link></Button></FieldDescription>}</Field>
          <Field><FieldLabel htmlFor="scheduled-prompt">{t("scheduled.task")}</FieldLabel><Textarea id="scheduled-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} rows={4} placeholder={t("scheduled.taskPlaceholder")} /></Field></FieldGroup>
        <Separator /><FieldSet className="gap-3"><FieldLegend variant="label">{t("scheduled.configureTime")}</FieldLegend><ScheduleFields value={source} onChange={setSource} disabled={saving} /></FieldSet>
        {error && <FieldDescription role="alert">{error}</FieldDescription>}
      </fieldset></CardContent>
      <CardFooter className="mt-6 justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => navigate("/app/schedules")}><X data-icon="inline-start" />{t("cancel")}</Button><Button type="button" disabled={saving || !name.trim() || !agentUserId || !prompt.trim()} onClick={() => void save()}><Save data-icon="inline-start" />{t(saving ? "saving" : "save")}</Button></CardFooter>
    </Card>}
  </AppPage>;
}
