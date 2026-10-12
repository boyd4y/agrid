import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ColorPicker } from "@/components/ui/color-picker";
import { SELECT_COLOR_PRESETS } from "@/lib/select-colors";
import type {
  ColumnDef,
  ColumnType,
  DateFormat,
  FormulaResultType,
  SelectOption,
} from "@/types/table";
import {
  COLUMN_TYPE_LABELS,
  DATE_FORMAT_OPTIONS,
  FORMULA_RESULT_TYPE_LABELS,
} from "@/types/table";

const COLORS = [...SELECT_COLOR_PRESETS];

type Props = {
  column: ColumnDef;
  /** sibling columns for formula ref chips */
  allColumns?: ColumnDef[];
  onSave: (patch: {
    name?: string;
    type?: ColumnType;
    config?: ColumnDef["config"];
  }) => Promise<void>;
  onClose: () => void;
  onDelete: () => void;
  onHide: () => void;
  onMove: (dir: "left" | "right") => void;
};

export function ColumnSettings({
  column,
  allColumns = [],
  onSave,
  onClose,
  onDelete,
  onHide,
  onMove,
}: Props) {
  const [name, setName] = useState(column.name);
  const [type, setType] = useState<ColumnType>(column.type as ColumnType);
  const [options, setOptions] = useState<SelectOption[]>(
    column.config?.options ?? []
  );
  const [formula, setFormula] = useState(column.config?.formula ?? "");
  const [formulaResultType, setFormulaResultType] = useState<FormulaResultType>(
    column.config?.formulaResultType ?? "auto"
  );
  const [dateFormat, setDateFormat] = useState<DateFormat>(
    column.config?.dateFormat ?? "YYYY-MM-DD"
  );
  const [saving, setSaving] = useState(false);

  const isSelect = type === "select" || type === "multi_select";
  const isFormula = type === "formula";
  const isDate = type === "date";

  const insertRef = (colName: string) => {
    setFormula((f) => `${f}{${colName}}`);
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        name: name.trim() || column.name,
        type,
        config: {
          ...column.config,
          options: isSelect ? options : column.config?.options,
          ...(isFormula
            ? { formula: formula.trim(), formulaResultType }
            : {}),
          ...(isDate ? { dateFormat } : {}),
        },
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const addOption = () => {
    const id = `opt_${Date.now().toString(36)}`;
    setOptions((o) => [
      ...o,
      { id, label: `选项 ${o.length + 1}`, color: COLORS[o.length % COLORS.length] },
    ]);
  };

  const refCandidates = allColumns.filter(
    (c) => c.id !== column.id && c.type !== "formula"
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-xl border border-border bg-background p-4 shadow-xl">
        <h3 className="mb-3 text-base font-semibold text-foreground">列设置</h3>

        <Label className="mb-1 block">列名</Label>
        <Input className="mb-3" value={name} onChange={(e) => setName(e.target.value)} />

        <Label className="mb-1 block">类型</Label>
        <Select value={type} onValueChange={(v) => setType(v as ColumnType)}>
          <SelectTrigger className="mb-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(COLUMN_TYPE_LABELS) as ColumnType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {COLUMN_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isFormula && (
          <div className="mb-3 space-y-2">
            <Label className="block">公式表达式</Label>
            <Textarea
              className="min-h-[88px] font-mono text-sm"
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder={'例如：{预估工时} * 8\nIF({已完成}, "完成", "进行中")'}
              spellCheck={false}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              用 {"{列名}"} 引用单元格。支持 + - * / &amp;、IF / AND / OR / NOT、CONCAT、LEN、ABS、ROUND、EMPTY、VALUE、TEXT。
            </p>
            {refCandidates.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {refCandidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
                    onClick={() => insertRef(c.name)}
                  >
                    {"{"}
                    {c.name}
                    {"}"}
                  </button>
                ))}
              </div>
            )}
            <Label className="block">结果类型</Label>
            <Select
              value={formulaResultType}
              onValueChange={(v) => setFormulaResultType(v as FormulaResultType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FORMULA_RESULT_TYPE_LABELS) as FormulaResultType[]).map(
                  (t) => (
                    <SelectItem key={t} value={t}>
                      {FORMULA_RESULT_TYPE_LABELS[t]}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
        )}

        {isDate && (
          <div className="mb-3">
            <Label className="mb-1 block">日期显示格式</Label>
            <Select
              value={dateFormat}
              onValueChange={(v) => setDateFormat(v as DateFormat)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_FORMAT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.value} · {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              存储仍为 YYYY-MM-DD；单元格按此格式显示，可手输或点日历。
            </p>
          </div>
        )}

        {isSelect && (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <Label>选项</Label>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={addOption}>
                + 添加
              </Button>
            </div>
            <div className="max-h-40 space-y-1.5 overflow-auto">
              {options.map((o, i) => (
                <div key={o.id} className="flex items-center gap-1.5">
                  <ColorPicker
                    value={o.color || COLORS[0]}
                    onChange={(color) =>
                      setOptions((opts) =>
                        opts.map((x, j) => (j === i ? { ...x, color } : x))
                      )
                    }
                  />
                  <Input
                    size="sm"
                    className="flex-1"
                    value={o.label}
                    onChange={(e) =>
                      setOptions((opts) =>
                        opts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-destructive"
                    onClick={() => setOptions((opts) => opts.filter((_, j) => j !== i))}
                  >
                    删
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onMove("left")}>
            左移
          </Button>
          <Button variant="outline" size="sm" onClick={() => onMove("right")}>
            右移
          </Button>
          <Button variant="outline" size="sm" onClick={onHide}>
            隐藏列
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            删除列
          </Button>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving || (isFormula && !formula.trim())}>
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
