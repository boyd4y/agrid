import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Zap,
  History,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type MemberOption } from "@/lib/api";
import type { ColumnDef, CellValue, FullTable } from "@/types/table";
import {
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_TRIGGER_LABELS,
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
} from "@table/shared";
import { cn } from "@/lib/utils";

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
  const col = columns.find((c) => c.type === "text") ?? columns[0];
  return {
    type: "update_field",
    columnId: col?.id ?? "",
    value: "",
  };
}

function summarizeTrigger(t: AutomationTrigger, columns: ColumnDef[]) {
  const col = (id: string) => columns.find((c) => c.id === id)?.name ?? id.slice(0, 6);
  if (t.type === "row_created") return AUTOMATION_TRIGGER_LABELS.row_created;
  if (t.type === "field_changed") {
    const base = `${AUTOMATION_TRIGGER_LABELS.field_changed} · ${col(t.columnId)}`;
    if (t.toValue !== undefined && t.toValue !== null && t.toValue !== "") {
      return `${base} → ${String(t.toValue)}`;
    }
    return base;
  }
  const opt = columns
    .find((c) => c.id === t.columnId)
    ?.config?.options?.find((o) => o.id === t.optionId)?.label;
  return `${AUTOMATION_TRIGGER_LABELS.enter_status} · ${col(t.columnId)}=${opt ?? t.optionId}`;
}

function summarizeActions(actions: AutomationAction[], columns: ColumnDef[]) {
  return actions
    .map((a) => {
      if (a.type === "update_field") {
        const name = columns.find((c) => c.id === a.columnId)?.name ?? "字段";
        return `更新「${name}」`;
      }
      return "执行智能体";
    })
    .join(" · ");
}

type Props = {
  table: FullTable;
};

export function AutomationPanel({ table }: Props) {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AutomationRule | "new" | null>(null);
  const [showRuns, setShowRuns] = useState(false);

  const columns = useMemo(
    () => table.columns.filter((c) => !c.config?.hidden),
    [table.columns]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, memberRes] = await Promise.all([
        api.listAutomations(table.id),
        api.listMembers(),
      ]);
      setRules(list);
      setMembers(memberRes.members ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [table.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadRuns = async () => {
    try {
      setRuns(await api.listAutomationRuns(table.id, { limit: 30 }));
      setShowRuns(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载运行记录失败");
    }
  };

  const toggleEnabled = async (rule: AutomationRule, enabled: boolean) => {
    try {
      const updated = await api.updateAutomation(rule.id, { enabled });
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失败");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("确定删除这条自动化？")) return;
    try {
      await api.deleteAutomation(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
      if (editing !== "new" && editing?.id === id) setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  return (
    <div className="space-y-4" data-testid="automation-panel">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          当 / 如果 / 就 · 字段回写与智能体跟进
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={() => void loadRuns()}
        >
          <History className="h-3.5 w-3.5" />
          运行记录
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={() => setEditing("new")}
        >
          <Plus className="h-3.5 w-3.5" />
          新建规则
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
          {error}
        </div>
      )}
      {loading && (
        <p className="text-xs text-muted-foreground">加载中…</p>
      )}
      {!loading && rules.length === 0 && !editing && (
        <div className="rounded-xl border border-dashed border-border bg-[#FBFBFA] px-4 py-10 text-center">
          <Zap className="mx-auto mb-2 h-7 w-7 text-[#D9730D]/80" />
          <p className="text-sm font-medium text-foreground">还没有自动化</p>
          <p className="mt-1 text-xs text-muted-foreground">
            用「当 / 如果 / 就」让字段回写或智能体跟进。
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-4 h-8 gap-1 text-xs"
            onClick={() => setEditing("new")}
          >
            <Plus className="h-3.5 w-3.5" />
            新建规则
          </Button>
        </div>
      )}

      <ul className="space-y-2">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 shadow-[0_4px_12px_rgba(55,53,47,0.04)]"
          >
            <Switch
              checked={rule.enabled}
              onCheckedChange={(v) => void toggleEnabled(rule, v)}
              aria-label="启用自动化"
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
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground"
              onClick={() => void remove(rule.id)}
              aria-label="删除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>

      {showRuns && (
        <div className="rounded-lg border border-border bg-muted p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">最近运行</span>
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
            <p className="text-[11px] text-muted-foreground">暂无记录</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-auto text-[11px]">
              {runs.map((r) => (
                <li
                  key={r.id}
                  className="flex justify-between gap-2 rounded px-1.5 py-1 hover:bg-accent"
                >
                  <span className="truncate">
                    {r.triggerType} · {r.status}
                    {r.error ? ` · ${r.error}` : ""}
                  </span>
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

      {editing && (
        <AutomationEditor
          tableId={table.id}
          columns={columns}
          members={members.filter((m) => m.kind === "agent")}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(rule) => {
            setRules((prev) => {
              const i = prev.findIndex((r) => r.id === rule.id);
              if (i >= 0) {
                const next = [...prev];
                next[i] = rule;
                return next;
              }
              return [...prev, rule];
            });
            setEditing(null);
          }}
        />
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

function AutomationEditor({
  tableId,
  columns,
  members,
  initial,
  onClose,
  onSaved,
}: EditorProps) {
  const [name, setName] = useState(initial?.name ?? "新建自动化");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    initial?.trigger ?? defaultTrigger(columns)
  );
  const [conditions, setConditions] = useState<FilterCondition[]>(
    initial?.conditions ?? []
  );
  const [conditionLogic, setConditionLogic] = useState<FilterLogic>(
    initial?.conditionLogic ?? "and"
  );
  const [actions, setActions] = useState<AutomationAction[]>(
    initial?.actions?.length ? initial.actions : [defaultAction(columns)]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectColumns = columns.filter((c) => c.type === "select");

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (!actions.length) throw new Error("至少添加一个动作");
      const payload = {
        name: name.trim() || "未命名自动化",
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
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/20 p-4 sm:items-center">
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-[0_12px_40px_rgba(55,53,47,0.16)]"
        role="dialog"
        aria-label="编辑自动化"
        data-testid="automation-editor"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-[#D9730D]" />
            <span className="text-sm font-semibold">当 / 如果 / 就</span>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 flex-1 text-sm font-medium"
              placeholder="自动化名称"
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="启用" />
              启用
            </div>
          </div>

          {/* WHEN */}
          <section className="rounded-lg border border-border bg-[#FBFBFA] p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#D9730D]">
              当
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
                {(Object.keys(AUTOMATION_TRIGGER_LABELS) as Array<
                  keyof typeof AUTOMATION_TRIGGER_LABELS
                >).map((k) => (
                  <SelectItem key={k} value={k} className="text-xs">
                    {AUTOMATION_TRIGGER_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {trigger.type === "field_changed" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Select
                  value={trigger.columnId}
                  onValueChange={(columnId) =>
                    setTrigger({ ...trigger, columnId })
                  }
                >
                  <SelectTrigger className="h-8 w-[160px] bg-background text-xs">
                    <SelectValue placeholder="字段" />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="h-8 w-[140px] text-xs"
                  placeholder="变为（可选）"
                  value={
                    trigger.toValue === null || trigger.toValue === undefined
                      ? ""
                      : String(trigger.toValue)
                  }
                  onChange={(e) =>
                    setTrigger({
                      ...trigger,
                      toValue: e.target.value === "" ? undefined : e.target.value,
                    })
                  }
                />
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
                    <SelectValue placeholder="状态列" />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectColumns.length ? selectColumns : columns).map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={trigger.optionId}
                  onValueChange={(optionId) =>
                    setTrigger({ ...trigger, optionId })
                  }
                >
                  <SelectTrigger className="h-8 w-[140px] bg-background text-xs">
                    <SelectValue placeholder="状态" />
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
          <section className="rounded-lg border border-border bg-[#FBFBFA] p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                如果
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
                      全部满足
                    </SelectItem>
                    <SelectItem value="or" className="text-xs">
                      任一满足
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
                  条件
                </Button>
              </div>
            </div>
            {conditions.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                无条件则始终执行动作
              </p>
            ) : (
              <div className="space-y-2">
                {conditions.map((c) => {
                  const col = columns.find((x) => x.id === c.columnId);
                  const ops = opsForType(col?.type ?? "text");
                  return (
                    <div key={c.id} className="flex flex-wrap items-center gap-1.5">
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
                                : f
                            )
                          );
                        }}
                      >
                        <SelectTrigger className="h-8 w-[120px] bg-background text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {columns.map((col) => (
                            <SelectItem key={col.id} value={col.id} className="text-xs">
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
                              f.id === c.id ? { ...f, op: op as FilterOp } : f
                            )
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
                      {filterNeedsValue(c.op) && (
                        <Input
                          className="h-8 w-[120px] text-xs"
                          value={
                            c.value === null || c.value === undefined
                              ? ""
                              : String(c.value)
                          }
                          onChange={(e) =>
                            setConditions((prev) =>
                              prev.map((f) =>
                                f.id === c.id
                                  ? {
                                      ...f,
                                      value:
                                        e.target.value === ""
                                          ? null
                                          : (e.target.value as CellValue),
                                    }
                                  : f
                              )
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
                          setConditions((prev) => prev.filter((f) => f.id !== c.id))
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
          <section className="rounded-lg border border-border bg-[#FBFBFA] p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-[#0F7B6C]">
                就
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
                动作
              </Button>
            </div>
            <div className="space-y-3">
              {actions.map((action, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "rounded-md border border-border bg-background p-2.5"
                  )}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Select
                      value={action.type}
                      onValueChange={(v) => {
                        setActions((prev) =>
                          prev.map((a, i) => {
                            if (i !== idx) return a;
                            if (v === "update_field") return defaultAction(columns);
                            return {
                              type: "run_agent",
                              agentUserId: members[0]?.userId ?? null,
                              prompt: "",
                            };
                          })
                        );
                      }}
                    >
                      <SelectTrigger className="h-8 flex-1 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="update_field" className="text-xs">
                          {AUTOMATION_ACTION_LABELS.update_field}
                        </SelectItem>
                        <SelectItem value="run_agent" className="text-xs">
                          {AUTOMATION_ACTION_LABELS.run_agent}
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
                                ? { ...a, columnId }
                                : a
                            )
                          )
                        }
                      >
                        <SelectTrigger className="h-8 w-[140px] text-xs">
                          <SelectValue placeholder="字段" />
                        </SelectTrigger>
                        <SelectContent>
                          {columns.map((c) => (
                            <SelectItem key={c.id} value={c.id} className="text-xs">
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        className="h-8 flex-1 text-xs"
                        placeholder="写入值"
                        value={
                          action.value === null || action.value === undefined
                            ? ""
                            : String(action.value)
                        }
                        onChange={(e) =>
                          setActions((prev) =>
                            prev.map((a, i) =>
                              i === idx && a.type === "update_field"
                                ? {
                                    ...a,
                                    value:
                                      e.target.value === ""
                                        ? null
                                        : e.target.value,
                                  }
                                : a
                            )
                          )
                        }
                      />
                    </div>
                  )}

                  {action.type === "run_agent" && (
                    <div className="space-y-2">
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
                                : a
                            )
                          )
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="选择智能体" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs">
                            系统（无指定智能体）
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
                        placeholder="提示词（可选）"
                        value={action.prompt ?? ""}
                        onChange={(e) =>
                          setActions((prev) =>
                            prev.map((a, i) =>
                              i === idx && a.type === "run_agent"
                                ? { ...a, prompt: e.target.value }
                                : a
                            )
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
                                  : a
                              )
                            )
                          }
                        >
                          <SelectTrigger className="h-8 w-[160px] text-xs">
                            <SelectValue placeholder="结果写回字段" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__" className="text-xs">
                              不写回
                            </SelectItem>
                            {columns.map((c) => (
                              <SelectItem key={c.id} value={c.id} className="text-xs">
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {action.resultColumnId && (
                          <Input
                            className="h-8 flex-1 text-xs"
                            placeholder="写回值"
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
                                    : a
                                )
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
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
