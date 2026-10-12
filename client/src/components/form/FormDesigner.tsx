import { useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TableForm } from "./TableForm";
import { FORM_THEME_PRESET_META } from "./formThemes";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { FullTable } from "@/types/table";
import type {
  FormFieldConfig,
  FormLayoutMode,
  FormQuestionSettings,
  FormThemePresetId,
  ResolvedFormView,
} from "@table/shared";
import { FORM_THEME_PRESETS } from "@table/shared";

type Props = {
  table: FullTable;
  view: ResolvedFormView;
  onChange: (view: ResolvedFormView) => void;
  onSubmitted?: () => void;
};

function SortableFieldRow({
  id,
  label,
  type,
  hidden,
  selected,
  onSelect,
  onToggleHidden,
}: {
  id: string;
  label: string;
  type: string;
  hidden?: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleHidden: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-1 rounded-lg border px-1.5 py-1.5 text-sm",
        selected
          ? "border-foreground/20 bg-muted"
          : "border-transparent hover:border-border hover:bg-muted/50",
        isDragging && "z-10 bg-background shadow-md",
        hidden && "opacity-50"
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
        aria-label="拖拽排序"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left"
        onClick={onSelect}
      >
        <span className="font-medium">{label}</span>
        <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">
          {type}
        </span>
      </button>
      <button
        type="button"
        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        onClick={onToggleHidden}
        title={hidden ? "显示" : "隐藏"}
      >
        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export function FormDesigner({ table, view, onChange, onSubmitted }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    view.resolvedFields[0]?.columnId ?? null
  );
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"design" | "fill">("design");
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const fields = view.resolvedFields;
  const ids = useMemo(() => fields.map((f) => f.columnId), [fields]);
  const selected = fields.find((f) => f.columnId === selectedId) ?? null;
  const layout = (view.config.layout ?? "classic") as FormLayoutMode;
  const themePreset = (view.config.theme?.preset ?? "notion-light") as FormThemePresetId;

  const persist = (next: ResolvedFormView) => {
    onChange(next);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextIds = arrayMove(ids, oldIndex, newIndex);
    const optimisticFields = nextIds
      .map((id) => fields.find((f) => f.columnId === id)!)
      .filter(Boolean);
    onChange({
      ...view,
      resolvedFields: optimisticFields,
      config: {
        ...view.config,
        fields: optimisticFields.map(
          ({ columnName: _n, columnType: _t, columnConfig: _c, ...f }) => f
        ),
      },
    });
    setSaving(true);
    try {
      const updated = await api.reorderFormFields(view.id, nextIds);
      onChange(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "排序失败");
      // reload
      const fresh = (await api.getView(view.id)) as ResolvedFormView;
      onChange(fresh);
    } finally {
      setSaving(false);
    }
  };

  const patchField = async (columnId: string, patch: Partial<FormFieldConfig>) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.setFormFieldSettings(view.id, columnId, patch);
      onChange(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新字段失败");
    } finally {
      setSaving(false);
    }
  };

  const setLayout = async (next: FormLayoutMode) => {
    setSaving(true);
    try {
      const updated = await api.setFormLayout(view.id, next);
      onChange(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "布局更新失败");
    } finally {
      setSaving(false);
    }
  };

  const setTheme = async (preset: FormThemePresetId) => {
    setSaving(true);
    try {
      const updated = await api.setFormTheme(view.id, preset);
      onChange(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "主题更新失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="form-designer">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background/80 px-3 py-2">
        <div className="flex rounded-lg border border-border bg-muted p-0.5">
          {(["classic", "focus"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => void setLayout(l)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                layout === l
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {l === "classic" ? "经典堆叠" : "一题一屏"}
            </button>
          ))}
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              主题 · {FORM_THEME_PRESET_META[themePreset]?.label ?? themePreset}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start">
            <div className="space-y-1">
              {FORM_THEME_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                    themePreset === p && "bg-muted"
                  )}
                  onClick={() => void setTheme(p)}
                >
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-border"
                    style={{
                      background: FORM_THEME_PRESET_META[p].tokens.button,
                    }}
                  />
                  {FORM_THEME_PRESET_META[p].label}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <div className="ml-auto flex items-center gap-1.5">
          {saving && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              保存中
            </span>
          )}
          <div className="flex rounded-lg border border-border p-0.5">
            <button
              type="button"
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                mode === "design"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground"
              )}
              onClick={() => setMode("design")}
            >
              <Settings2 className="mr-1 inline h-3 w-3" />
              设计
            </button>
            <button
              type="button"
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                mode === "fill"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground"
              )}
              onClick={() => setMode("fill")}
            >
              <Eye className="mr-1 inline h-3 w-3" />
              填写
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
          {error}
        </div>
      )}

      {mode === "fill" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <TableForm table={table} view={view} onSubmitted={onSubmitted} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_260px]">
          {/* Field list */}
          <aside className="min-h-0 overflow-auto border-r border-border p-2">
            <p className="mb-2 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              题目 · 拖拽排序
            </p>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => void onDragEnd(e)}
            >
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <div className="space-y-0.5">
                  {fields.map((f) => (
                    <SortableFieldRow
                      key={f.columnId}
                      id={f.columnId}
                      label={f.label || f.columnName}
                      type={f.columnType}
                      hidden={f.hidden}
                      selected={selectedId === f.columnId}
                      onSelect={() => setSelectedId(f.columnId)}
                      onToggleHidden={() =>
                        void patchField(f.columnId, { hidden: !f.hidden })
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </aside>

          {/* Canvas */}
          <div className="min-h-0 overflow-auto">
            <TableForm
              table={table}
              view={view}
              highlightColumnId={selectedId}
              onSelectField={setSelectedId}
              onSubmitted={onSubmitted}
            />
          </div>

          {/* Inspector */}
          <aside className="min-h-0 overflow-auto border-l border-border p-3">
            <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              题型设置
            </p>
            {!selected ? (
              <p className="text-sm text-muted-foreground">选择一道题进行设置</p>
            ) : (
              <FieldInspector
                field={selected}
                onPatch={(patch) => void patchField(selected.columnId, patch)}
              />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function FieldInspector({
  field,
  onPatch,
}: {
  field: ResolvedFormView["resolvedFields"][number];
  onPatch: (patch: Partial<FormFieldConfig>) => void;
}) {
  const settings = field.settings;
  const type = field.columnType;

  const setSettings = (next: FormQuestionSettings) => {
    onPatch({ settings: next });
  };

  return (
    <div className="space-y-3" data-testid="form-field-inspector">
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">标签</label>
        <Input
          className="h-8"
          defaultValue={field.label || field.columnName}
          key={`label-${field.columnId}-${field.label}`}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== (field.label || field.columnName)) {
              onPatch({ label: v });
            }
          }}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">说明</label>
        <Textarea
          className="min-h-[60px] text-sm"
          defaultValue={field.helpText ?? ""}
          key={`help-${field.columnId}-${field.helpText}`}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== (field.helpText ?? "")) onPatch({ helpText: v || undefined });
          }}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">占位符</label>
        <Input
          className="h-8"
          defaultValue={field.placeholder ?? ""}
          key={`ph-${field.columnId}-${field.placeholder}`}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== (field.placeholder ?? ""))
              onPatch({ placeholder: v || undefined });
          }}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={Boolean(field.required)}
          onCheckedChange={(c) => onPatch({ required: Boolean(c) })}
        />
        必填
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={Boolean(field.readOnly)}
          onCheckedChange={(c) => onPatch({ readOnly: Boolean(c) })}
          disabled={type === "formula"}
        />
        只读
      </label>

      {type === "text" && (
        <div className="space-y-2 rounded-lg border border-border p-2">
          <p className="text-xs font-medium text-muted-foreground">文本</p>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={Boolean(settings?.kind === "text" && settings.multiline)}
              onCheckedChange={(c) =>
                setSettings({
                  kind: "text",
                  multiline: Boolean(c),
                  maxLength: settings?.kind === "text" ? settings.maxLength : undefined,
                  inputMode: settings?.kind === "text" ? settings.inputMode : "text",
                })
              }
            />
            多行
          </label>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">输入模式</label>
            <div className="flex flex-wrap gap-1">
              {(["text", "email", "url"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs",
                    (settings?.kind === "text" ? settings.inputMode : "text") === m
                      ? "border-foreground bg-muted"
                      : "border-border"
                  )}
                  onClick={() =>
                    setSettings({
                      kind: "text",
                      multiline: settings?.kind === "text" ? settings.multiline : false,
                      maxLength: settings?.kind === "text" ? settings.maxLength : undefined,
                      inputMode: m,
                    })
                  }
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {type === "number" && (
        <div className="space-y-2 rounded-lg border border-border p-2">
          <p className="text-xs font-medium text-muted-foreground">数字</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">最小</label>
              <Input
                className="h-8"
                type="number"
                defaultValue={settings?.kind === "number" ? settings.min ?? "" : ""}
                onBlur={(e) => {
                  const n = e.target.value === "" ? undefined : Number(e.target.value);
                  setSettings({
                    kind: "number",
                    min: n,
                    max: settings?.kind === "number" ? settings.max : undefined,
                    step: settings?.kind === "number" ? settings.step : undefined,
                  });
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">最大</label>
              <Input
                className="h-8"
                type="number"
                defaultValue={settings?.kind === "number" ? settings.max ?? "" : ""}
                onBlur={(e) => {
                  const n = e.target.value === "" ? undefined : Number(e.target.value);
                  setSettings({
                    kind: "number",
                    min: settings?.kind === "number" ? settings.min : undefined,
                    max: n,
                    step: settings?.kind === "number" ? settings.step : undefined,
                  });
                }}
              />
            </div>
          </div>
        </div>
      )}

      {(type === "select" || type === "multi_select") && (
        <div className="space-y-2 rounded-lg border border-border p-2">
          <p className="text-xs font-medium text-muted-foreground">选项展示</p>
          <p className="text-[10px] text-muted-foreground">
            选项与表格视图共用
          </p>
          <div className="flex gap-1">
            {(type === "select"
              ? (["dropdown", "buttons"] as const)
              : (["checkbox", "buttons"] as const)
            ).map((d) => (
              <button
                key={d}
                type="button"
                className={cn(
                  "rounded-md border px-2 py-0.5 text-xs",
                  (type === "select"
                    ? settings?.kind === "select"
                      ? settings.display
                      : "dropdown"
                    : settings?.kind === "multi_select"
                      ? settings.display
                      : "checkbox") === d
                    ? "border-foreground bg-muted"
                    : "border-border"
                )}
                onClick={() =>
                  type === "select"
                    ? setSettings({ kind: "select", display: d as "dropdown" | "buttons" })
                    : setSettings({
                        kind: "multi_select",
                        display: d as "checkbox" | "buttons",
                      })
                }
              >
                {d === "buttons" ? "按钮组" : d === "dropdown" ? "下拉" : "勾选"}
              </button>
            ))}
          </div>
        </div>
      )}

      {type === "checkbox" && (
        <div className="space-y-2 rounded-lg border border-border p-2">
          <label className="mb-1 block text-xs text-muted-foreground">同意文案</label>
          <Input
            className="h-8"
            defaultValue={
              settings?.kind === "checkbox" ? settings.agreeLabel ?? "" : ""
            }
            onBlur={(e) =>
              setSettings({
                kind: "checkbox",
                agreeLabel: e.target.value || undefined,
              })
            }
          />
        </div>
      )}

      {type === "formula" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          公式列 — 计算字段，不会随表单提交
        </div>
      )}
    </div>
  );
}
