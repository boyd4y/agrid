import { AutomationSourceFields } from "./AutomationSourceFields";
import { Field, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { AutomationEventConditions } from "./AutomationEventConditions";
import { AutomationDataActionFields, defaultCommandInput } from "./AutomationDataActionFields";
import { changedFilterOperator, filterOpsForColumn } from "@/lib/filter-value";
import { FILTER_CONTROL_CLASS_NAME, FilterValueInput } from "@/components/table/FilterBar";
import { FormFieldControl } from "@/components/form/FormFieldControls";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Zap, History, X, Save, Loader2 } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { Input } from "@tabdo/ui/components/input";
import { Textarea } from "@tabdo/ui/components/textarea";
import { Switch } from "@tabdo/ui/components/switch";
import { Checkbox } from "@tabdo/ui/components/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tabdo/ui/components/select";
import { api, type MemberOption } from "@/lib/api";
import type { ColumnDef, CellValue, FullTable, RowData } from "@/types/table";
import {
  FILTER_OP_LABELS,
  filterNeedsValue,
  type AutomationAction,
  type AutomationSource,
  type AutomationEventCondition,
  type AutomationRule,
  type AutomationRun,
  type AutomationTrigger,
  type FilterCondition,
  type FilterLogic,
  type FilterOp,
} from "@tabdo/shared";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

function newId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function defaultTrigger(columns: ColumnDef[]): AutomationTrigger {
  const selectCol = columns.find((c) => ["select", "multi_select"].includes(c.type) && c.config?.options?.length);
  if (selectCol?.config?.options?.[0]) {
    return {
      type: "enter_status",
      columnId: selectCol.id,
      optionId: selectCol.config.options[0].id,
    };
  }
  const first = columns[0];
  if (first) return { type: "field_changed", columnId: first.id };
  return { type: "row_created" };
}

function defaultAction(columns: ColumnDef[]): AutomationAction {
  const col =
    columns.find((c) => c.type === "text") ??
    columns.find((c) => !["formula", "rollup"].includes(c.type));
  return {
    type: "update_field",
    columnId: col?.id ?? "",
    value: "",
  };
}

function summarizeTrigger(t: AutomationTrigger, columns: ColumnDef[]) {
  const col = (id: string) =>
    columns.find((c) => c.id === id)?.name ?? id.slice(0, 6);
  if (t.type === "row_created") return i18n.t("automation:triggers.row_created");
  if (t.type === "field_changed") {
    const base = `${i18n.t("automation:triggers.field_changed")} · ${col(t.columnId)}`;
    if (t.toValue !== undefined && t.toValue !== null && t.toValue !== "") {
      return `${base} → ${String(t.toValue)}`;
    }
    return base;
  }
  if (t.type !== "enter_status") return i18n.t(`automation:triggers.${t.type}`);
  const opt = columns
    .find((c) => c.id === t.columnId)
    ?.config?.options?.find((o) => o.id === t.optionId)?.label;
  return `${i18n.t("automation:triggers.enter_status")} · ${col(t.columnId)}=${opt ?? t.optionId}`;
}

function summarizeActions(actions: AutomationAction[], columns: ColumnDef[]) {
  return actions
    .map((a) => {
      if (a.type === "update_field") {
        const name = columns.find((c) => c.id === a.columnId)?.name ?? i18n.t("automation:field");
        return i18n.t("automation:updateFieldNamed", { name });
      }
      return a.type === "command" ? i18n.t(`automation:generic.commands.${a.command}`) : i18n.t("automation:runAgent");
    })
    .join(" · ");
}

type Props = {
  table: FullTable;
  refreshToken?: number;
  active?: boolean;
};

export function AutomationPanel({ table, refreshToken, active = true }: Props) {
  const { t } = useTranslation("automation");
  const requestVersion = useRef(0);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AutomationRule | "new" | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  const [deleteRule, setDeleteRule] = useState<AutomationRule | null>(null);

  const columns = useMemo(
    () => table.columns.filter((c) => !c.config?.hidden),
    [table.columns],
  );

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const [list, memberRes] = await Promise.all([
        api.listAutomations(table.id),
        api.listMembers(),
      ]);
      if (version !== requestVersion.current) return;
      setRules(list);
      setMembers(memberRes.members ?? []);
      setError(null);
    } catch (e) {
      if (version === requestVersion.current)
        setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [table.id]);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current++;
    };
  }, [load, refreshToken]);

  const loadRuns = async () => {
    try {
      setRuns(await api.listAutomationRuns(table.id, { limit: 30 }));
      setShowRuns(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadRunsFailed"));
    }
  };

  useEffect(() => {
    if (!showRuns || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (!document.hidden) {
        try {
          const next = await api.listAutomationRuns(table.id, { limit: 30 });
          if (!cancelled) setRuns(next);
        } catch {
          /* Keep the last durable state; manual refresh reports errors. */
        }
      }
      if (!cancelled) timer = setTimeout(refresh, 5000);
    };
    timer = setTimeout(refresh, 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showRuns, table.id, active, refreshToken]);

  const replay = async (id: string) => {
    try {
      await api.replayAutomationRun(id);
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("replayFailed"));
    }
  };

  const toggleEnabled = async (rule: AutomationRule, enabled: boolean) => {
    try {
      const updated = await api.updateAutomation(rule.id, { enabled });
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("updateFailed"));
    }
  };

  const remove = async (id: string) => {
    await api.deleteAutomation(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
    setRuns((prev) => prev.filter((r) => r.automationId !== id));
    if (editing !== "new" && editing?.id === id) setEditing(null);
  };

  if (editing)
    return (
      <AutomationEditor
        key={editing === "new" ? "new" : editing.id}
        tableId={table.id}
        columns={columns}
        members={members}
        initial={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(rule) => {
          setRules((prev) =>
            prev.some((r) => r.id === rule.id)
              ? prev.map((r) => (r.id === rule.id ? rule : r))
              : [...prev, rule],
          );
          setEditing(null);
        }}
      />
    );

  return (
    <div className="space-y-4" data-testid="automation-panel">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {t("whenIfThenHint")}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={() => void loadRuns()}
        >
          <History className="h-3.5 w-3.5" />
          {t("runs")}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={() => setEditing("new")}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("newRule")}
        </Button>
      </div>

      {error && (
        <ListErrorState className="min-h-0 rounded-md border border-border py-6" title={error} />
      )}
      {loading && <p className="text-xs text-muted-foreground">{t("loading")}</p>}
      {!loading && rules.length === 0 && !editing && (
        <AppEmptyState
          illustration={NOTIOLY.chill}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Button type="button" size="sm" onClick={() => setEditing("new")}>
              <Plus className="h-3.5 w-3.5" />
              {t("newRule")}
            </Button>
          }
        />
      )}

      <ul className="flex flex-col gap-2">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 shadow-sm"
          >
            <Switch
              checked={rule.enabled}
              onCheckedChange={(v) => void toggleEnabled(rule, v)}
              aria-label={t("enableAutomation")}
            />
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => setEditing(rule)}
            >
              <div className="truncate text-sm font-medium text-foreground">
                {rule.name}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {summarizeTrigger(rule.trigger, columns)}
                {" → "}
                {summarizeActions(rule.actions, columns)}
              </div>
            </button>
            <Button
              type="button"
              variant="destructive-ghost"
              size="sm"
              onClick={() => setDeleteRule(rule)}
              aria-label={t("deleteRuleNamed", { name: rule.name })}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("deleteRule")}
            </Button>
          </li>
        ))}
      </ul>

      <DeleteConfirmation
        open={deleteRule !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteRule(null);
        }}
        title={t("deleteRuleQ")}
        description={t("deleteRuleDesc", { name: deleteRule?.name ?? "" })}
        onConfirm={async () => {
          if (deleteRule) await remove(deleteRule.id);
        }}
      />

      {showRuns && (
        <div className="rounded-lg border border-border bg-muted p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">{t("recentRuns")}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setShowRuns(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          {runs.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("noRuns")}</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-auto text-[11px]">
              {runs.map((r) => (
                <li
                  key={r.id}
                  className="flex justify-between gap-2 rounded px-1.5 py-1 hover:bg-accent"
                >
                  <span className="truncate">
                    {t(`triggers.${r.triggerType}`)} ·{" "}
                    {
                      {
                        queued: t("runStatus.queued"),
                        running: t("runStatus.running"),
                        retrying: t("runStatus.retrying"),
                        completed: t("runStatus.completed"),
                        failed: t("runStatus.failed"),
                        skipped: t("runStatus.skipped"),
                        cancelled: t("runStatus.cancelled"),
                        superseded: t("runStatus.superseded"),
                        unknown: t("runStatus.unknown"),
                        waiting_input: t("runStatus.waiting_input"),
                      }[r.status]
                    }
                    {r.nextStep ? t("stepsDone", { n: r.nextStep }) : ""}
                    {r.error ? ` · ${r.error}` : ""}
                  </span>
                  {r.status === "failed" && r.eventId && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 shrink-0 text-xs"
                      onClick={() => void replay(r.id)}
                    >
                      {t("replayPending")}
                    </Button>
                  )}
                  <span className="shrink-0 text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString("zh-CN", {
                      hour12: false,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

type EditorProps = {
  tableId?: string;
  source?: AutomationSource;
  columns: ColumnDef[];
  members: MemberOption[];
  initial: AutomationRule | null;
  onClose: () => void;
  onSaved: (rule: AutomationRule) => void;
  onSavingChange?: (saving: boolean) => void;
};

/** Trigger equality compares complete cell values, unlike IF array-membership filters. */
function TriggerValueInput(props: {
  column: ColumnDef;
  value: CellValue;
  onChange: (value: CellValue) => void;
  members: MemberOption[];
  sampleRows: RowData[];
}) {
  if (props.column.type === "relation" || props.column.type === "multi_select") {
    return <FormFieldControl size="sm" column={props.column} value={props.value} onChange={props.onChange} members={props.members} />;
  }
  return <FilterValueInput {...props} className="w-full min-w-0" />;
}

export function AutomationEditor({
  tableId = "",
  source: sourceProp,
  columns,
  members,
  initial,
  onClose,
  onSaved,
  onSavingChange,
}: EditorProps) {
  const { t } = useTranslation("automation");
  const [source, setSource] = useState<AutomationSource>(sourceProp ?? initial?.source ?? { kind: "table", tableId });
  const isTable = source.kind === "table";
  const [sampleRows, setSampleRows] = useState<RowData[]>([]);
  const needsFormulaSamples = columns.some(column => column.type === "formula" && (!column.config.formulaResultType || column.config.formulaResultType === "auto"));
  useEffect(() => {
    let disposed = false;
    setSampleRows([]);
    if (needsFormulaSamples) {
      void api.queryRowsPage(tableId)
        .then(page => { if (!disposed) setSampleRows(page.rows); })
        .catch(() => { /* Declared types remain available without samples. */ });
    }
    return () => { disposed = true; };
  }, [tableId, needsFormulaSamples]);
  const [name, setName] = useState(initial?.name ?? t(source.kind === "schedule" ? "scheduled.new" : "newAutomation"));
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    initial?.trigger ?? (source.kind === "table" ? defaultTrigger(columns) : { type: source.kind === "agentmail" ? "message_received" : source.kind === "webhook" ? "webhook_received" : "schedule_due" }),
  );
  const [conditions, setConditions] = useState<FilterCondition[]>(
    initial?.conditions ?? [],
  );
  const [eventConditions, setEventConditions] = useState<AutomationEventCondition[]>(initial?.eventConditions ?? []);
  const [invalidActions, setInvalidActions] = useState<Record<string, boolean>>({});
  const [pendingActions, setPendingActions] = useState<Record<string, boolean>>({});
  const blocked = Object.values(invalidActions).some(Boolean) || Object.values(pendingActions).some(Boolean);
  const savingRef = useRef(false);
  const [conditionLogic, setConditionLogic] = useState<FilterLogic>(
    initial?.conditionLogic ?? "and",
  );
  const [actions, setActions] = useState<AutomationAction[]>(
    initial?.actions?.length ? initial.actions.map(action => action.type === "run_agent" ? { type: "run_agent" as const, agentUserId: action.agentUserId, prompt: action.prompt ?? "" } : action) : [{ type: "command", command: "updateCells", input: defaultCommandInput("updateCells", source) }],
  );
  const [actionIds, setActionIds] = useState(() => actions.map(() => crypto.randomUUID()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectColumns = columns.filter((c) => ["select", "multi_select"].includes(c.type) && c.config?.options?.length);
  const writableColumns = columns.filter((c) => !["formula", "rollup"].includes(c.type));
  const agents = members.filter((member) => member.kind === "agent");

  const save = async () => {
    if (savingRef.current || blocked) return;
    savingRef.current = true;
    setSaving(true);
    onSavingChange?.(true);
    setError(null);
    try {
      if (!actions.length) throw new Error(t("needAction"));
      const payload = {
        source,
        eventConditions: isTable ? [] : eventConditions,
        name: name.trim() || t("unnamed"),
        enabled,
        trigger,
        conditions: isTable ? conditions : [],
        conditionLogic,
        actions,
      };
      const rule = initial
        ? await api.updateAutomation(initial.id, payload)
        : await api.createSourceAutomation(payload);
      onSaved(rule);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl" aria-label={t("editorAria")}>
      <div
        className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground"
        role="region"
        aria-label={t("editAutomation")}
        data-testid="automation-editor"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-warning" />
            <span className="text-sm font-semibold">{t("whenIfThen")}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label={t("backToRules")}
            disabled={saving}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <fieldset disabled={saving} className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4">
          {error && (
            <ListErrorState className="min-h-0 rounded-md border border-border py-4" title={error} />
          )}

          <div className="flex items-center gap-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 flex-1 text-sm font-medium"
              placeholder={t(source.kind === "schedule" ? "scheduled.new" : "namePlaceholder")}
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label={t("enabled")}
              />
              {t("enabled")}
            </div>
          </div>

          {!isTable && <section className="rounded-lg border p-3"><FieldGroup><Field><FieldLabel>{t("when")}</FieldLabel><p className="text-sm">{t(`triggers.${trigger.type}`)}</p></Field><AutomationSourceFields value={source} onChange={setSource} lockKind disabled={saving} /></FieldGroup></section>}
          {isTable && <>
          {/* WHEN */}
          <section className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="mb-2 text-xs font-semibold text-warning">
              {t("when")}
            </div>
            <Select
              value={trigger.type}
              onValueChange={(v) => {
                if (v === "row_created") setTrigger({ type: "row_created" });
                else if (v === "field_changed") {
                  setTrigger({
                    type: "field_changed",
                    columnId: columns[0]?.id ?? "",
                  });
                } else {
                  const col = selectColumns[0] ?? columns[0];
                  setTrigger({
                    type: "enter_status",
                    columnId: col?.id ?? "",
                    optionId: col?.config?.options?.[0]?.id ?? "",
                  });
                }
              }}
            >
              <SelectTrigger className="h-8 bg-background text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  (["row_created", "field_changed", "enter_status"] as const)
                ).map((k) => (
                  <SelectItem key={k} value={k} disabled={k === "enter_status" && !selectColumns.length} className="text-xs">
                    {t(`triggers.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {trigger.type === "field_changed" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Select
                  value={trigger.columnId}
                  onValueChange={(columnId) =>
                    setTrigger({ type: "field_changed", columnId })
                  }
                >
                  <SelectTrigger className="h-8 w-[160px] bg-background text-xs">
                    <SelectValue placeholder={t("fieldPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={trigger.toValue !== undefined}
                    onCheckedChange={(checked) => {
                      const col = columns.find(
                        (c) => c.id === trigger.columnId,
                      );
                      const value: CellValue =
                        col?.type === "relation" || col?.type === "multi_select"
                          ? []
                          : col?.type === "checkbox"
                            ? false
                            : col?.type === "number"
                              ? 0
                              : null;
                      setTrigger({
                        ...trigger,
                        toValue: checked ? value : undefined,
                      });
                    }}
                  />
                  {t("onlyWhenValue")}
                </label>
                {trigger.toValue !== undefined &&
                  columns.find((c) => c.id === trigger.columnId) && (
                    <div className="min-w-36 flex-1" data-testid="automation-trigger-value">
                      <TriggerValueInput
                        column={columns.find((c) => c.id === trigger.columnId)!}
                        value={trigger.toValue}
                        onChange={(value) =>
                          setTrigger({ ...trigger, toValue: value })
                        }
                        members={members}
                        sampleRows={sampleRows}
                      />
                    </div>
                  )}
              </div>
            )}

            {trigger.type === "enter_status" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Select
                  value={trigger.columnId}
                  onValueChange={(columnId) => {
                    const col = columns.find((c) => c.id === columnId);
                    setTrigger({
                      type: "enter_status",
                      columnId,
                      optionId: col?.config?.options?.[0]?.id ?? "",
                    });
                  }}
                >
                  <SelectTrigger className="h-8 w-[160px] bg-background text-xs">
                    <SelectValue placeholder={t("statusColumn")} />
                  </SelectTrigger>
                  <SelectContent>
                    {selectColumns.map(
                      (c) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.name}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <Select
                  value={trigger.optionId}
                  onValueChange={(optionId) =>
                    setTrigger({ ...trigger, optionId })
                  }
                >
                  <SelectTrigger className="h-8 w-[140px] bg-background text-xs">
                    <SelectValue placeholder={t("status")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      columns.find((c) => c.id === trigger.columnId)?.config
                        ?.options ?? []
                    ).map((o) => (
                      <SelectItem key={o.id} value={o.id} className="text-xs">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </section>

          </>}
          {!isTable && <section className="rounded-lg border p-3"><FieldGroup><Field><FieldLabel>{t("if")}</FieldLabel><Select value={conditionLogic} onValueChange={value => setConditionLogic(value as FilterLogic)}><SelectTrigger aria-label={t("generic.conditionLogic")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="and">{t("allMatch")}</SelectItem><SelectItem value="or">{t("anyMatch")}</SelectItem></SelectGroup></SelectContent></Select></Field><AutomationEventConditions source={source} value={eventConditions} onChange={setEventConditions} /></FieldGroup></section>}
          {isTable && <>
          {/* IF */}
          <section className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold text-primary">
                {t("if")}
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={conditionLogic}
                  onValueChange={(v) => setConditionLogic(v as FilterLogic)}
                >
                  <SelectTrigger className="h-7 w-[88px] bg-background text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="and" className="text-xs">
                      {t("allMatch")}
                    </SelectItem>
                    <SelectItem value="or" className="text-xs">
                      {t("anyMatch")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => {
                    const col = columns[0];
                    if (!col) return;
                    setConditions((prev) => [
                      ...prev,
                      {
                        id: newId("c"),
                        columnId: col.id,
                        op: filterOpsForColumn(col, sampleRows)[0],
                        value: null,
                      },
                    ]);
                  }}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {t("condition")}
                </Button>
              </div>
            </div>
            {conditions.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {t("noConditionHint")}
              </p>
            ) : (
              <div className="space-y-2">
                {conditions.map((c) => {
                  const col = columns.find((x) => x.id === c.columnId);
                  const ops = filterOpsForColumn(col, sampleRows);
                  return (
                    <div
                      key={c.id}
                      data-testid="automation-condition"
                      className="flex flex-wrap items-center gap-1.5"
                    >
                      <Select
                        value={c.columnId}
                        onValueChange={(columnId) => {
                          const nc = columns.find((x) => x.id === columnId);
                          setConditions((prev) =>
                            prev.map((f) =>
                              f.id === c.id
                                ? {
                                    ...f,
                                    columnId,
                                    op: filterOpsForColumn(nc, sampleRows)[0],
                                    value: null,
                                  }
                                : f,
                            ),
                          );
                        }}
                      >
                        <SelectTrigger size="sm" className={FILTER_CONTROL_CLASS_NAME}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {columns.map((col) => (
                            <SelectItem
                              key={col.id}
                              value={col.id}
                              className="text-xs"
                            >
                              {col.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={c.op}
                        onValueChange={(op) =>
                          setConditions((prev) =>
                            prev.map((f) =>
                              f.id === c.id ? { ...f, ...changedFilterOperator(op as FilterOp) } : f,
                            ),
                          )
                        }
                      >
                        <SelectTrigger size="sm" className={FILTER_CONTROL_CLASS_NAME}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ops.map((op) => (
                            <SelectItem key={op} value={op} className="text-xs">
                              {FILTER_OP_LABELS[op]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {filterNeedsValue(c.op) && col && (
                        <FilterValueInput
                          key={`${c.columnId}:${c.op}`}
                          sampleRows={sampleRows}
                          members={members}
                          column={
                            columns.find((column) => column.id === c.columnId)!
                          }
                          value={c.value ?? null}
                          onChange={(value) =>
                            setConditions((prev) =>
                              prev.map((f) =>
                                f.id === c.id ? { ...f, value } : f,
                              ),
                            )
                          }
                        />
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() =>
                          setConditions((prev) =>
                            prev.filter((f) => f.id !== c.id),
                          )
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          </>}
          <section className="rounded-lg border bg-muted/40 p-3">
            <div className="mb-3 flex items-center justify-between gap-2"><p className="text-sm font-semibold">{t("then")}</p><Button type="button" variant="outline" size="sm" onClick={() => { setActionIds(previous => [...previous, crypto.randomUUID()]); setActions(previous => [...previous, { type: "command", command: "updateCells", input: defaultCommandInput("updateCells", source) }]); }}><Plus data-icon="inline-start" />{t("action")}</Button></div>
            <div className="flex flex-col gap-3">{actions.map((action, index) => { const typeControl = <Field className="min-w-0"><FieldLabel>{t("action")}</FieldLabel><Select value={action.type} onValueChange={type => { setInvalidActions(previous => ({ ...previous, [actionIds[index]]: false })); setActions(previous => previous.map((action, position) => position === index ? type === "run_agent" ? { type: "run_agent", agentUserId: agents[0]?.userId ?? null, prompt: "" } : { type: "command", command: "updateCells", input: defaultCommandInput("updateCells", source) } : action)); }}><SelectTrigger aria-label={t("action")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="command">{t("actions.command")}</SelectItem><SelectItem value="run_agent">{t("actions.run_agent")}</SelectItem>{action.type === "update_field" && <SelectItem value="update_field">{t("actions.update_field")}</SelectItem>}</SelectGroup></SelectContent></Select></Field>; const removeControl = <Button className="col-start-2 row-start-1 sm:col-start-3" type="button" variant="destructive-ghost" size="icon" aria-label={t("generic.removeAction")} disabled={actions.length <= 1} onClick={() => { setActionIds(previous => previous.filter((_, position) => position !== index)); setActions(previous => previous.filter((_, position) => position !== index)); }}><Trash2 /></Button>; return <section key={actionIds[index]} className="rounded-md border bg-background p-3" aria-label={t("generic.step", { index: index + 1 })}>
              {action.type !== "command" && <FieldGroup className="mb-3 flex-row items-end gap-3">{typeControl}{removeControl}</FieldGroup>}
              {action.type === "command" && <AutomationDataActionFields actionTypeControl={typeControl} removeControl={removeControl} key={action.command} command={action.command} input={action.input} source={source} step={index} members={members} sourceColumns={columns} onCommandChange={command => setActions(previous => previous.map((action, position) => position === index ? { type: "command", command, input: defaultCommandInput(command, source) } : action))} onChange={input => setActions(previous => previous.map((action, position) => position === index && action.type === "command" ? { ...action, input } : action))} onInvalidChange={invalid => setInvalidActions(previous => previous[actionIds[index]] === invalid ? previous : { ...previous, [actionIds[index]]: invalid })} onPendingChange={pending => setPendingActions(previous => previous[actionIds[index]] === pending ? previous : { ...previous, [actionIds[index]]: pending })} />}
              {action.type === "update_field" && <FieldGroup><Field><FieldLabel>{t("field")}</FieldLabel><Select value={action.columnId} onValueChange={columnId => setActions(previous => previous.map((action, position) => position === index && action.type === "update_field" ? { ...action, columnId, value: null } : action))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{writableColumns.map(column => <SelectItem key={column.id} value={column.id}>{column.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>{columns.find(column => column.id === action.columnId) && <FormFieldControl column={columns.find(column => column.id === action.columnId)!} value={action.value} members={members} onChange={value => setActions(previous => previous.map((action, position) => position === index && action.type === "update_field" ? { ...action, value } : action))} />}</FieldGroup>}
              {action.type === "run_agent" && <FieldGroup><Field><FieldLabel>{t("pickAgent")}</FieldLabel><Select value={action.agentUserId ?? ""} onValueChange={agentUserId => setActions(previous => previous.map((action, position) => position === index ? { type: "run_agent", agentUserId, prompt: action.type === "run_agent" ? action.prompt ?? "" : "" } : action))}><SelectTrigger><SelectValue placeholder={t("pickAgent")} /></SelectTrigger><SelectContent><SelectGroup>{agents.map(agent => <SelectItem key={agent.userId} value={agent.userId}>{agent.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel>{t("generic.prompt")}</FieldLabel><Textarea rows={4} value={action.prompt ?? ""} placeholder="{{event.message.subject}}" onChange={event => setActions(previous => previous.map((action, position) => position === index && action.type === "run_agent" ? { ...action, prompt: event.target.value } : action))} /><p className="text-xs text-muted-foreground">{t("generic.promptHint")}</p></Field></FieldGroup>}
            </section>; })}</div>
          </section>
        </fieldset>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onClose}>
            <X data-icon="inline-start" />{t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || blocked}
            onClick={() => void save()}
          >
            {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}{saving ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </section>
  );
}
