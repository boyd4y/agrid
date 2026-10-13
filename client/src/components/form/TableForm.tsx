import { useMemberOptions } from "@/hooks/useMemberOptions";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { FormFieldControl } from "./FormFieldControls";
import { formThemeStyle } from "./formThemes";
import { api } from "@/lib/api";
import type { CellValue, ColumnDef, FullTable } from "@/types/table";
import type {
  FormFieldConfig,
  FormViewConfig,
  ResolvedFormField,
  ResolvedFormView,
} from "@tabdo/shared";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

type Props = {
  table: FullTable;
  view?: ResolvedFormView | null;
  onSubmitted?: () => void;
  className?: string;
  /** Force fill-only (no designer chrome) */
  fillOnly?: boolean;
  /** Highlight a field in design canvas */
  highlightColumnId?: string | null;
  onSelectField?: (columnId: string) => void;
};

function buildZod(
  fields: Array<FormFieldConfig & { columnType: string; columnName: string }>,
  columnsById: Record<string, ColumnDef>
) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    if (f.hidden) continue;
    const col = columnsById[f.columnId];
    if (!col || (col.type === "formula" || col.type === "rollup") || f.readOnly) continue;
    const label = f.label || col.name;
    let schema: z.ZodTypeAny;
    switch (col.type) {
      case "number":
        schema = z.union([z.number(), z.null()]);
        break;
      case "checkbox":
        schema = z.boolean();
        break;
      case "relation":
      case "multi_select":
        schema = z.array(z.string());
        break;
      case "select":
      case "person":
      case "date":
      case "text":
      default:
        schema = z.union([z.string(), z.null()]);
        break;
    }
    if (f.required) {
      if ((col.type === "multi_select" || col.type === "relation")) {
        schema = z.array(z.string()).min(1, i18n.t("form:requiredField", { label }));
      } else if (col.type === "checkbox") {
        schema = z.boolean();
      } else if (col.type === "number") {
        schema = z.number({ error: i18n.t("form:requiredField", { label }) });
      } else {
        schema = z.string({ error: i18n.t("form:requiredField", { label }) }).min(1, i18n.t("form:requiredField", { label }));
      }
    } else {
      schema = schema.optional().nullable();
    }
    // soft settings
    if (f.settings?.kind === "text" && f.settings.maxLength) {
      const max = f.settings.maxLength;
      schema = schema.refine(
        (v) => v == null || typeof v !== "string" || v.length <= max,
        { message: i18n.t("form:maxChars", { label, max }) }
      );
    }
    if (f.settings?.kind === "number") {
      const { min, max } = f.settings;
      schema = schema.refine(
        (v) => {
          if (v == null || typeof v !== "number") return true;
          if (min != null && v < min) return false;
          if (max != null && v > max) return false;
          return true;
        },
        { message: i18n.t("form:outOfRange", { label }) }
      );
    }
    shape[f.columnId] = schema;
  }
  return z.object(shape);
}

function defaultValues(
  fields: Array<FormFieldConfig & { columnType?: string }>,
  columnsById: Record<string, ColumnDef>
): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const f of fields) {
    if (f.hidden) continue;
    const col = columnsById[f.columnId];
    if (!col || (col.type === "formula" || col.type === "rollup")) continue;
    if (f.defaultValue !== undefined) {
      out[f.columnId] = f.defaultValue as CellValue;
      continue;
    }
    switch (col.type) {
      case "checkbox":
        out[f.columnId] = false;
        break;
      case "relation":
      case "multi_select":
        out[f.columnId] = [];
        break;
      case "number":
        out[f.columnId] = null;
        break;
      default:
        out[f.columnId] = "";
    }
  }
  return out;
}

export function TableForm({
  table,
  view,
  onSubmitted,
  className,
  highlightColumnId,
  onSelectField,
}: Props) {
  const { t } = useTranslation("form");
  const members = useMemberOptions();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<-1 | number>(-1); // -1 = welcome
  const [welcomeDone, setWelcomeDone] = useState(false);



  const columnsById = useMemo(
    () => Object.fromEntries(table.columns.map((c) => [c.id, c])),
    [table.columns]
  );

  const config: FormViewConfig = view?.config ?? {
    title: table.name,
    description: table.description ?? undefined,
    submitLabel: t("submit"),
    successMessage: t("submitSuccess"),
    mode: "create",
    layout: "classic",
    theme: { preset: "notion-light" },
    fields: table.columns
      .filter((c) => c.type !== "formula" && c.type !== "rollup" && !c.config?.hidden)
      .map((c) => ({ columnId: c.id, required: c.name === "标题" /* seed */ })),
  };

  const fields = useMemo(() => {
    const raw: ResolvedFormField[] =
      view?.resolvedFields ??
      config.fields.map((f) => {
        const col = columnsById[f.columnId];
        return {
          ...f,
          columnName: col?.name ?? f.columnId,
          columnType: col?.type ?? "text",
          columnConfig: (col?.config ?? {}) as Record<string, unknown>,
        };
      });
    return raw.filter((f) => !f.hidden && columnsById[f.columnId]);
  }, [view, config.fields, columnsById]);

  const layout = config.layout ?? "classic";
  const themeStyle = formThemeStyle(config.theme);
  const hasWelcome = Boolean(config.welcome?.title || config.welcome?.description);

  const schema = useMemo(
    () => buildZod(fields, columnsById),
    [fields, columnsById]
  );

  const form = useForm({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
    defaultValues: defaultValues(fields, columnsById),
  });

  useEffect(() => {
    form.reset(defaultValues(fields, columnsById));
    setDone(false);
    setError(null);
    setStep(hasWelcome ? -1 : 0);
    setWelcomeDone(!hasWelcome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.id, view?.id, layout, config.theme?.preset]);

  const submitValues = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    setError(null);
    try {
      const cells: Record<string, CellValue> = {};
      for (const f of fields) {
        const col = columnsById[f.columnId];
        if (!col || (col.type === "formula" || col.type === "rollup") || f.readOnly) continue;
        let v = values[f.columnId] as CellValue;
        if (col.type === "text" && v === "") v = null;
        if (col.type === "number" && (v === "" || v === undefined)) v = null;
        cells[f.columnId] = v ?? null;
      }
      await api.addRow(table.id, cells);
      setDone(true);
      form.reset(defaultValues(fields, columnsById));
      onSubmitted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = form.handleSubmit(submitValues);

  const endingTitle =
    config.ending?.title || config.successMessage || t("submitSuccess");
  const endingDesc = config.ending?.description;

  if (done) {
    return (
      <div
        className={cn("flex min-h-[420px] items-center justify-center p-6", className)}
        style={themeStyle}
        data-testid="table-form-success"
      >
        <div className="mx-auto max-w-lg text-center">
          <p className="text-2xl font-semibold tracking-tight" style={{ color: "var(--form-question)" }}>
            {endingTitle}
          </p>
          {endingDesc && (
            <p className="mt-2 text-sm opacity-70" style={{ color: "var(--form-question)" }}>
              {endingDesc}
            </p>
          )}
          <Button
            className="mt-6"
            style={{
              background: "var(--form-button)",
              color: "var(--form-button-text)",
              borderRadius: "var(--form-radius)",
            }}
            onClick={() => {
              setDone(false);
              setStep(hasWelcome ? -1 : 0);
              setWelcomeDone(!hasWelcome);
            }}
          >
            {t("fillAgain")}
          </Button>
        </div>
      </div>
    );
  }

  const renderField = (f: ResolvedFormField, opts?: { large?: boolean }) => {
    const col = columnsById[f.columnId];
    if (!col) return null;
    const readOnly = f.readOnly || (col.type === "formula" || col.type === "rollup");
    const large = opts?.large ?? layout === "focus";
    return (
      <FormField
        key={f.columnId}
        control={form.control}
        name={f.columnId}
        render={({ field }) => (
          <FormItem
            className={cn(
              onSelectField && "cursor-pointer rounded-xl p-2 transition-shadow",
              highlightColumnId === f.columnId &&
                "ring-2 ring-[var(--form-accent)] ring-offset-2 ring-offset-[var(--form-bg)]"
            )}
            onClick={() => onSelectField?.(f.columnId)}
          >
            <FormLabel
              className={cn(large && "text-xl font-medium leading-snug md:text-2xl")}
              style={{ color: "var(--form-question)" }}
            >
              {f.label || col.name}
              {f.required && !readOnly && (
                <span className="ml-1 text-[var(--form-accent)]">*</span>
              )}
            </FormLabel>
            <FormControl>
              <div className="w-full pt-2">
                <FormFieldControl
                  column={col}
                  value={field.value as CellValue}
                  onChange={field.onChange}
                  placeholder={f.placeholder}
                  disabled={readOnly}
                  members={members}
                  settings={f.settings}
                  variant="typeform"
                />
              </div>
            </FormControl>
            {f.helpText && (
              <FormDescription
                className="opacity-60"
                style={{ color: "var(--form-question)" }}
              >
                {f.helpText}
              </FormDescription>
            )}
            <FormMessage />
          </FormItem>
        )}
      />
    );
  };

  // Focus / one-at-a-time
  if (layout === "focus") {
    const showWelcome = hasWelcome && !welcomeDone && step === -1;
    const idx = typeof step === "number" && step >= 0 ? step : 0;
    const current = fields[idx];
    const progress = fields.length ? ((welcomeDone ? idx + 1 : 0) / fields.length) * 100 : 0;

    const advance = async () => {
      if (showWelcome) {
        setWelcomeDone(true);
        setStep(0);
        return;
      }
      if (!current) return;
      const ok = await form.trigger(current.columnId);
      if (!ok) return;
      if (idx >= fields.length - 1) {
        await onSubmit();
      } else {
        setStep(idx + 1);
      }
    };

    const back = () => {
      if (idx <= 0) {
        if (hasWelcome) {
          setWelcomeDone(false);
          setStep(-1);
        }
        return;
      }
      setStep(idx - 1);
    };

    return (
      <div
        className={cn("relative flex min-h-[480px] flex-col", className)}
        style={themeStyle}
        data-testid="table-form"
        data-layout="focus"
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-accent">
          <div
            className="h-full transition-all"
            style={{ width: `${progress}%`, background: "var(--form-accent)" }}
          />
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-xl">
            {showWelcome ? (
              <div className="space-y-4">
                <h2
                  className="text-3xl font-semibold tracking-tight md:text-4xl"
                  style={{ color: "var(--form-question)" }}
                >
                  {config.welcome?.title || config.title || t("start")}
                </h2>
                {(config.welcome?.description || config.description) && (
                  <p className="text-base opacity-70" style={{ color: "var(--form-question)" }}>
                    {config.welcome?.description || config.description}
                  </p>
                )}
                <Button
                  type="button"
                  className="mt-4 h-11 px-6"
                  style={{
                    background: "var(--form-button)",
                    color: "var(--form-button-text)",
                    borderRadius: "var(--form-radius)",
                  }}
                  onClick={() => void advance()}
                >
                  {config.welcome?.ctaLabel || t("start")}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Form {...form}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void advance();
                  }}
                  className="space-y-6"
                >
                  {current && renderField(current, { large: true })}
                  {error && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {error}
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={back}
                      className="opacity-70"
                      style={{ color: "var(--form-question)" }}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      type="submit"
                      disabled={submitting}
                      className="h-11 min-w-[7rem] px-5"
                      style={{
                        background: "var(--form-button)",
                        color: "var(--form-button-text)",
                        borderRadius: "var(--form-radius)",
                      }}
                    >
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                      {idx >= fields.length - 1
                        ? config.submitLabel || t("submit")
                        : "OK"}
                      {idx < fields.length - 1 && (
                        <ArrowRight className="ml-1 h-4 w-4" />
                      )}
                    </Button>
                    <span className="text-xs opacity-50" style={{ color: "var(--form-question)" }}>
                      press Enter ↵
                    </span>
                  </div>
                </form>
              </Form>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Classic stacked
  return (
    <div
      className={cn("min-h-[420px] p-6 md:p-10", className)}
      style={themeStyle}
      data-testid="table-form"
      data-layout="classic"
    >
      <div
        className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8"
        style={{ borderRadius: "var(--form-radius)" }}
      >
        <div className="mb-6">
          <h2
            className="text-2xl font-semibold tracking-tight"
            style={{ color: "var(--form-question)" }}
          >
            {config.title || view?.name || t("form")}
          </h2>
          {config.description && (
            <p className="mt-1 text-sm opacity-70" style={{ color: "var(--form-question)" }}>
              {config.description}
            </p>
          )}
        </div>

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-5">
            {fields.map((f) => renderField(f, { large: false }))}

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="h-11 w-full"
              disabled={submitting}
              style={{
                background: "var(--form-button)",
                color: "var(--form-button-text)",
                borderRadius: "var(--form-radius)",
              }}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {config.submitLabel || t("submit")}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
