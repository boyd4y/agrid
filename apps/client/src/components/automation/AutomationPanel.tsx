import { FilterValueInput } from "@/components/table/FilterBar";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tabdo/ui/components/select";
import { api, type MemberOption } from "@/lib/api";
import type { ColumnDef, CellValue, FullTable } from "@/types/table";
import {
  FILTER_OP_LABELS,
  filterNeedsValue,
  opsForType,
  type AutomationAction,
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
  const selectCol = columns.find((c) => c.type === "select");
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
      return i18n.t("automation:runAgent");
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
        members={members.filter((m) => m.kind === "agent")}
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
  tableId: string;
  columns: ColumnDef[];
  members: MemberOption[];
  initial: AutomationRule | null;
  onClose: () => void;
  onSaved: (rule: AutomationRule) => void;
};

export function AutomationEditor({
  tableId,
  columns,
  members,
  initial,
  onClose,
  onSaved,
}: EditorProps) {
  const { t } = useTranslation("automation");
  const [name, setName] = useState(initial?.name ?? t("newAutomation"));
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    initial?.trigger ?? defaultTrigger(columns),
  );
  const [conditions, setConditions] = useState<FilterCondition[]>(
    initial?.conditions ?? [],
  );
  const [conditionLogic, setConditionLogic] = useState<FilterLogic>(
    initial?.conditionLogic ?? "and",
  );
  const [actions, setActions] = useState<AutomationAction[]>(
    initial?.actions?.length ? initial.actions : [defaultAction(columns)],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectColumns = columns.filter((c) => c.type === "select");

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (!actions.length) throw new Error(t("needAction"));
      const payload = {
        name: name.trim() || t("unnamed"),
        enabled,
        trigger,
        conditions,
        conditionLogic,
        actions,
      };
      const rule = initial
        ? await api.updateAutomation(initial.id, payload)
        : await api.createAutomation(tableId, payload);
      onSaved(rule);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
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
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
          {error && (
            <ListErrorState className="min-h-0 rounded-md border border-border py-4" title={error} />
          )}

          <div className="flex items-center gap-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 flex-1 text-sm font-medium"
              placeholder={t("namePlaceholder")}
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
                  <SelectItem key={k} value={k} className="text-xs">
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
                    <div className="min-w-36 flex-1">
                      <FormFieldControl
                        column={columns.find((c) => c.id === trigger.columnId)!}
                        value={trigger.toValue}
                        onChange={(value) =>
                          setTrigger({ ...trigger, toValue: value })
                        }
                        members={members}
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
                    {(selectColumns.length ? selectColumns : columns).map(
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
                        op: opsForType(col.type)[0],
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
                  const ops = opsForType(col?.type ?? "text");
                  return (
                    <div
                      key={c.id}
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
                                    op: opsForType(nc?.type ?? "text")[0],
                                    value: null,
                                  }
                                : f,
                            ),
                          );
                        }}
                      >
                        <SelectTrigger className="h-8 w-[120px] bg-background text-xs">
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
                              f.id === c.id ? { ...f, op: op as FilterOp } : f,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="h-8 w-[100px] bg-background text-xs">
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

          {/* THEN */}
          <section className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold text-success">
                {t("then")}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() =>
                  setActions((prev) => [...prev, defaultAction(columns)])
                }
              >
                <Plus className="mr-1 h-3 w-3" />
                {t("action")}
              </Button>
            </div>
            <div className="space-y-3">
              {actions.map((action, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "rounded-md border border-border bg-background p-2.5",
                  )}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Select
                      value={action.type}
                      onValueChange={(v) => {
                        setActions((prev) =>
                          prev.map((a, i) => {
                            if (i !== idx) return a;
                            if (v === "update_field")
                              return defaultAction(columns);
                            return {
                              type: "run_agent",
                              agentUserId: members[0]?.userId ?? null,
                              prompt: "",
                            };
                          }),
                        );
                      }}
                    >
                      <SelectTrigger className="h-8 flex-1 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="update_field" className="text-xs">
                          {t("actions.update_field")}
                        </SelectItem>
                        <SelectItem value="run_agent" className="text-xs">
                          {t("actions.run_agent")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      disabled={actions.length <= 1}
                      onClick={() =>
                        setActions((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {action.type === "update_field" && (
                    <div className="flex flex-wrap gap-2">
                      <Select
                        value={action.columnId}
                        onValueChange={(columnId) =>
                          setActions((prev) =>
                            prev.map((a, i) =>
                              i === idx && a.type === "update_field"
                                ? { ...a, columnId, value: null }
                                : a,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="h-8 w-[140px] text-xs">
                          <SelectValue placeholder={t("fieldPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {columns
                            .filter(
                              (c) => !["formula", "rollup"].includes(c.type),
                            )
                            .map((c) => (
                              <SelectItem
                                key={c.id}
                                value={c.id}
                                className="text-xs"
                              >
                                {c.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      {columns.find((c) => c.id === action.columnId) && (
                        <div className="min-w-40 flex-1">
                          <FormFieldControl
                            column={
                              columns.find((c) => c.id === action.columnId)!
                            }
                            value={action.value}
                            onChange={(value) =>
                              setActions((prev) =>
                                prev.map((a, i) =>
                                  i === idx && a.type === "update_field"
                                    ? { ...a, value }
                                    : a,
                                ),
                              )
                            }
                            members={members}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {action.type === "run_agent" && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {t("agentNotWired")}
                      </p>
                      <Select
                        value={action.agentUserId ?? "__none__"}
                        onValueChange={(v) =>
                          setActions((prev) =>
                            prev.map((a, i) =>
                              i === idx && a.type === "run_agent"
                                ? {
                                    ...a,
                                    agentUserId: v === "__none__" ? null : v,
                                  }
                                : a,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder={t("pickAgent")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs">
                            {t("systemAgent")}
                          </SelectItem>
                          {members.map((m) => (
                            <SelectItem
                              key={m.userId}
                              value={m.userId}
                              className="text-xs"
                            >
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Textarea
                        className="min-h-[64px] text-xs"
                        placeholder={t("promptOptional")}
                        value={action.prompt ?? ""}
                        onChange={(e) =>
                          setActions((prev) =>
                            prev.map((a, i) =>
                              i === idx && a.type === "run_agent"
                                ? { ...a, prompt: e.target.value }
                                : a,
                            ),
                          )
                        }
                      />
                      <div className="flex flex-wrap gap-2">
                        <Select
                          value={action.resultColumnId ?? "__none__"}
                          onValueChange={(v) =>
                            setActions((prev) =>
                              prev.map((a, i) =>
                                i === idx && a.type === "run_agent"
                                  ? {
                                      ...a,
                                      resultColumnId:
                                        v === "__none__" ? undefined : v,
                                    }
                                  : a,
                              ),
                            )
                          }
                        >
                          <SelectTrigger className="h-8 w-[160px] text-xs">
                            <SelectValue placeholder={t("writeBackField")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__" className="text-xs">
                              {t("noWriteBack")}
                            </SelectItem>
                            {columns.map((c) => (
                              <SelectItem
                                key={c.id}
                                value={c.id}
                                className="text-xs"
                              >
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {action.resultColumnId && (
                          <Input
                            className="h-8 flex-1 text-xs"
                            placeholder={t("writeBackValue")}
                            value={
                              action.resultValue === null ||
                              action.resultValue === undefined
                                ? ""
                                : String(action.resultValue)
                            }
                            onChange={(e) =>
                              setActions((prev) =>
                                prev.map((a, i) =>
                                  i === idx && a.type === "run_agent"
                                    ? {
                                        ...a,
                                        resultValue:
                                          e.target.value === ""
                                            ? null
                                            : e.target.value,
                                      }
                                    : a,
                                ),
                              )
                            }
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onClose}>
            <X data-icon="inline-start" />{t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}{saving ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </section>
  );
}
