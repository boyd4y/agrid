import { ColumnTypeIcon } from "./ColumnTypeIcon";
import { ArrowLeft, ArrowRight, EyeOff, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { RelationColumnConfig } from "./RelationColumnConfig";
import { useState } from "react";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Textarea } from "@tabdo/ui/components/textarea";
import { Label } from "@tabdo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tabdo/ui/components/select";
import { ColorPicker } from "@/components/controls/color-picker";
import { SELECT_COLOR_PRESETS } from "@/lib/select-colors";
import type {
  ColumnDef,
  ColumnType,
  DateFormat,
  FormulaResultType,
  SelectOption,
} from "@/types/table";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("table");
  const [name, setName] = useState(column.name);
  const [type, setType] = useState<ColumnType>(column.type as ColumnType);
  const [options, setOptions] = useState<SelectOption[]>(
    column.config?.options ?? [],
  );
  const [formula, setFormula] = useState(column.config?.formula ?? "");
  const [formulaResultType, setFormulaResultType] = useState<FormulaResultType>(
    column.config?.formulaResultType ?? "auto",
  );
  const [dateFormat, setDateFormat] = useState<DateFormat>(
    column.config?.dateFormat ?? "YYYY-MM-DD",
  );
  const [extraConfig, setExtraConfig] = useState(column.config);
  const [saveError, setSaveError] = useState<string | null>(null);
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
          ...extraConfig,
          options: isSelect ? options : column.config?.options,
          ...(isFormula ? { formula: formula.trim(), formulaResultType } : {}),
          ...(isDate ? { dateFormat } : {}),
        },
      });
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const addOption = () => {
    const id = `opt_${Date.now().toString(36)}`;
    setOptions((o) => [
      ...o,
      {
        id,
        label: t("optionN", { n: o.length + 1 }),
        color: COLORS[o.length % COLORS.length],
      },
    ]);
  };

  const refCandidates = allColumns.filter(
    (c) => c.id !== column.id && c.type !== "formula",
  );

  return (
    <div
      className="w-full shrink-0"
      role="region"
      aria-label={t("columnSettings")}
      data-testid="column-settings-editor"
    >
      <div className="flex flex-col gap-1">
        <h3 className="mb-3 text-base font-semibold text-foreground">{t("columnSettings")}</h3>

        <Label htmlFor={`column-name-${column.id}`} className="mb-1 block">{t("columnName")}</Label>
        <Input
          id={`column-name-${column.id}`}
          className="mb-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <Label className="mb-1 block">{t("columnType")}</Label>
        <Select value={type} onValueChange={(v) => setType(v as ColumnType)}>
          <SelectTrigger className="mb-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent><SelectGroup>
            {(Object.keys(COLUMN_TYPE_LABELS) as ColumnType[]).map((t) => (
              <SelectItem
                key={t}
                value={t}
                disabled={
                  t !== column.type &&
                  (["relation", "rollup"].includes(t) ||
                    ["relation", "rollup"].includes(column.type))
                }
              >
                <ColumnTypeIcon type={t} />{COLUMN_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectGroup></SelectContent>
        </Select>

        {(type === "relation" || type === "rollup") && (
          <RelationColumnConfig
            type={type}
            config={extraConfig}
            onChange={setExtraConfig}
            columns={allColumns}
            existing
          />
        )}
        {saveError && (
          <p role="alert" className="py-2 text-xs text-destructive">
            {saveError}
          </p>
        )}
        {isFormula && (
          <div className="mb-3 flex flex-col gap-2">
            <Label className="block">{t("formulaExpression")}</Label>
            <Textarea
              className="min-h-[88px] font-mono text-sm"
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder={
                t("formulaPlaceholder")
              }
              spellCheck={false}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("formulaHelp")}
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
            <Label className="block">{t("resultType")}</Label>
            <Select
              value={formulaResultType}
              onValueChange={(v) =>
                setFormulaResultType(v as FormulaResultType)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent><SelectGroup>
                {(
                  Object.keys(FORMULA_RESULT_TYPE_LABELS) as FormulaResultType[]
                ).map((t) => (
                  <SelectItem
                    key={t}
                    value={t}
                    disabled={
                      t !== column.type &&
                      (["relation", "rollup"].includes(t) ||
                        ["relation", "rollup"].includes(column.type))
                    }
                  >
                    {FORMULA_RESULT_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectGroup></SelectContent>
            </Select>
          </div>
        )}

        {isDate && (
          <div className="mb-3">
            <Label className="mb-1 block">{t("dateDisplayFormat")}</Label>
            <Select
              value={dateFormat}
              onValueChange={(v) => setDateFormat(v as DateFormat)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent><SelectGroup>
                {DATE_FORMAT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.value} · {o.label}
                  </SelectItem>
                ))}
              </SelectGroup></SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("dateFormatHint")}
            </p>
          </div>
        )}

        {isSelect && (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <Label>{t("options")}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={addOption}
              >
                <Plus data-icon="inline-start" />{t("add")}
              </Button>
            </div>
            <div className="flex max-h-48 flex-col gap-2 overflow-auto">
              {options.map((o, i) => (
                <div key={o.id} className="flex items-center gap-1.5">
                  <ColorPicker
                    value={o.color || COLORS[0]}
                    label={t("optionColorOf", { label: o.label })}
                    onChange={(color) =>
                      setOptions((opts) =>
                        opts.map((x, j) => (j === i ? { ...x, color } : x)),
                      )
                    }
                  />
                  <Input
                    size="sm"
                    className="flex-1"
                    value={o.label}
                    onChange={(e) =>
                      setOptions((opts) =>
                        opts.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("deleteOption", { label: o.label })}
                    onClick={() =>
                      setOptions((opts) => opts.filter((_, j) => j !== i))
                    }
                  >
                    <Trash2 data-icon="inline-start" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onMove("left")}>
            <ArrowLeft data-icon="inline-start" />{t("moveLeft")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onMove("right")}>
            <ArrowRight data-icon="inline-start" />{t("moveRight")}
          </Button>
          <Button variant="outline" size="sm" onClick={onHide}>
            <EyeOff data-icon="inline-start" />{t("hideColumn")}
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 data-icon="inline-start" />{t("deleteColumn")}
          </Button>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={saving} onClick={onClose}>
            <X data-icon="inline-start" />{t("cancel")}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || (isFormula && !formula.trim())}
          >
            {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}{saving ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
