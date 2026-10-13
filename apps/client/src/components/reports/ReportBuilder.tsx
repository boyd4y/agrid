import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Hash,
  Type,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Settings2,
} from "lucide-react";
import { BuilderLayout } from "@/components/builder/BuilderLayout";
import { Button } from "@tabdo/ui/components/button";
import { Separator } from "@tabdo/ui/components/separator";
import { Field, FieldLabel, FieldGroup } from "@tabdo/ui/components/field";
import { Input } from "@tabdo/ui/components/input";
import { Textarea } from "@tabdo/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tabdo/ui/components/select";
import { ReportChart } from "./ReportChart";
import { ReportDataPopover } from "./ReportDataPopover";
import { DashboardCanvas } from "./DashboardCanvas";
import { reportChartOptions } from "./chart-types";
import { resolveReportLayout } from "@tabdo/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ColumnDef, TableMeta } from "@/types/table";
import type {
  ReportConfig,
  ReportData,
  ReportMetricData,
  ReportMetricQuery,
  ReportPageConfig,
  ReportPageData,
  ReportWidget,
  ReportWidgetResult,
} from "@tabdo/shared";
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";

function widgetTypes() {
  return {
    chart: { label: i18n.t("reports:widgetTypes.chart"), icon: BarChart3 },
    metric: { label: i18n.t("reports:widgetTypes.metric"), icon: Hash },
    text: { label: i18n.t("reports:widgetTypes.text"), icon: Type },
  } as const;
}
function Choice({
  id,
  label,
  value,
  options,
  onChange,
  placeholder = i18n.t("reports:pleaseSelect"),
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  options: { id: string; name: string; glyph?: typeof BarChart3 }[];
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const unavailable = disabled || options.length === 0;
  return (
    <Field data-disabled={unavailable}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange} disabled={unavailable}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        {!unavailable && (
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem
                  key={option.id}
                  value={option.id}
                  textValue={option.name}
                >
                  {option.glyph && <option.glyph aria-hidden="true" />}
                  <span className="truncate">{option.name}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        )}
      </Select>
    </Field>
  );
}
function WidgetContent({
  widget,
  result,
  loading,
}: {
  widget: ReportWidget;
  result?: ReportWidgetResult;
  loading: boolean;
}) {
  if (widget.type === "text")
    return (
      <p className="min-h-12 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
        {widget.content || i18n.t("reports:addTextPlaceholder")}
      </p>
    );
  if (result?.error)
    return (
      <p className="py-8 text-sm text-destructive" role="alert">
        {result.error}
      </p>
    );
  if (loading && !result?.data)
    return (
      <p className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
        {i18n.t("reports:aggregating")}
      </p>
    );
  if (!result?.data)
    return (
      <p className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
        {widget.type === "chart" ? i18n.t("reports:pickSourceGroup") : i18n.t("reports:pickSourceMetric")}
      </p>
    );
  if (widget.type === "metric") {
    const data = result.data as ReportMetricData;
    return (
      <div className="py-3">
        <p className="text-4xl font-semibold tabular-nums tracking-tight">
          {data.value == null
            ? "—"
            : data.value.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          {data.sourceName} · {data.metricLabel}
        </p>
      </div>
    );
  }
  const data = result.data as ReportData;
  const query = {
    ...widget.query,
    tableId: widget.query.tableId!,
    groupColumnId: widget.query.groupColumnId!,
    name: widget.title || i18n.t("reports:chart"),
  } as ReportConfig;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="mb-2 text-xs text-muted-foreground">
        {i18n.t("reports:recordsMetric", { source: data.sourceName, total: data.totalRows, metric: data.metricLabel })}
      </p>
      <div className="min-h-0 flex-1">
        <ReportChart config={query} data={data} />
      </div>
      {data.truncated && (
        <p className="mt-2 text-xs text-warning">
          {i18n.t("reports:groupTruncated")}
        </p>
      )}
      {!!data.points.length && <ReportDataPopover data={data} title={widget.title || i18n.t("reports:chart")} />}
    </div>
  );
}
function DashboardWidget({
  widget,
  result,
  selected,
  loading,
  onSelect,
  onDelete,
  onMove,
  first,
  last,
}: {
  widget: ReportWidget;
  result?: ReportWidgetResult;
  selected: boolean;
  loading: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  return (
    <article
      data-widget-id={widget.id}
      onClick={onSelect}
      className={cn(
        "group relative flex h-full min-h-0 min-w-0 flex-col rounded-xl border bg-card p-4",
        selected ? "border-primary ring-1 ring-primary/20" : "border-border",
      )}
    >
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={i18n.t("reports:dragWidget", { title: widget.title || widgetTypes()[widget.type].label })}
          className="report-drag-handle size-7 touch-none cursor-grab"
        >
          <GripVertical />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 flex-1 justify-start text-left"
          onClick={onSelect}
        >
          <span className="truncate">{widget.title || widgetTypes()[widget.type].label}</span>
        </Button>
        <div
          className={cn(
            "report-widget-actions flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
            selected && "opacity-100",
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={i18n.t("reports:moveWidgetUp")}
            disabled={first}
            onClick={(e) => {
              e.stopPropagation();
              onMove(-1);
            }}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={i18n.t("reports:moveWidgetDown")}
            disabled={last}
            onClick={(e) => {
              e.stopPropagation();
              onMove(1);
            }}
          >
            <ArrowDown />
          </Button>
          <Button
            variant="destructive-ghost"
            size="icon"
            className="size-7"
            aria-label={i18n.t("reports:deleteWidget")}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <WidgetContent widget={widget} result={result} loading={loading} />
      </div>
    </article>
  );
}
export function ReportBuilder({
  config,
  onChange,
  tables,
  mode,
  refreshToken,
  onError,
}: {
  config: ReportPageConfig;
  onChange: (next: ReportPageConfig) => void;
  tables: TableMeta[];
  mode: "design" | "preview";
  refreshToken: number;
  onError: (error: Error) => void;
}) {
  const { t } = useTranslation("reports");
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [columns, setColumns] = useState<ColumnDef[]>([]),
    [data, setData] = useState<ReportPageData>({ widgets: [] }),
    [loading, setLoading] = useState(false),
    [columnsLoading, setColumnsLoading] = useState(false),
    [columnsError, setColumnsError] = useState(false);
  const selected = config.widgets.find((w) => w.id === selectedId) ?? null;
  const sourceId =
    selected && selected.type !== "text" ? selected.query.tableId : null;
  // Page labels/layout do not trigger aggregate queries; only widget queries do.
  const queryKey = JSON.stringify({
    name: i18n.t("reports:report"),
    description: "",
    columns: 2,
    widgets: config.widgets
      .filter((w) => w.type !== "text")
      .map((w) => ({
        ...w,
        layout: undefined,
        width: "full",
        title: "",
        ...(w.type === "chart"
          ? { query: { ...w.query, chartType: "bar" } }
          : {}),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  const queries = useMemo(
    () => JSON.parse(queryKey) as ReportPageConfig,
    [queryKey],
  );
  useEffect(() => {
    let cancelled = false;
    setColumns([]);
    setColumnsError(false);
    setColumnsLoading(!!sourceId);
    if (sourceId)
      void api
        .getTable(sourceId)
        .then((table) => {
          if (!cancelled) setColumns(table.columns);
        })
        .catch((e) => {
          if (!cancelled) {
            setColumnsError(true);
            onError(e);
          }
        })
        .finally(() => {
          if (!cancelled) setColumnsLoading(false);
        });
    return () => {
      cancelled = true;
    };
  }, [sourceId, refreshToken, onError]);
  const columnPlaceholder = (empty: string) =>
    !sourceId
      ? i18n.t("reports:pickSourceFirst")
      : columnsLoading
        ? i18n.t("reports:loadingFields")
        : columnsError
          ? i18n.t("reports:fieldsLoadFailed")
          : empty;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api
        .previewReportPage(queries)
        .then((data) => {
          if (!cancelled) setData(data);
        })
        .catch((e) => {
          if (!cancelled) onError(e);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [queries, refreshToken, onError]);
  const patch = (widget: ReportWidget) =>
    onChange({
      ...config,
      widgets: config.widgets.map((w) => (w.id === widget.id ? widget : w)),
    });
  const patchQuery = (
    widget: Exclude<ReportWidget, { type: "text" }>,
    fields: Partial<ReportMetricQuery>,
  ) => {
    if (widget.type === "chart")
      patch({ ...widget, query: { ...widget.query, ...fields } });
    else patch({ ...widget, query: { ...widget.query, ...fields } });
  };
  const add = (type: ReportWidget["type"]) => {
    if (config.widgets.length >= 40) return;
    const base = {
      id: crypto.randomUUID(),
      title: widgetTypes()[type].label,
      width: type === "text" ? ("full" as const) : ("half" as const),
    };
    const widget: ReportWidget =
      type === "text"
        ? { ...base, type, content: "" }
        : type === "metric"
          ? {
              ...base,
              type,
              query: { tableId: null, metric: "count", valueColumnId: null },
            }
          : {
              ...base,
              type,
              query: {
                tableId: null,
                groupColumnId: null,
                chartType: "bar",
                metric: "count",
                valueColumnId: null,
                dateBucket: "month",
              },
            };
    onChange({ ...config, widgets: [...config.widgets, widget] });
    setSelectedId(widget.id);
  };
  const remove = (id: string) => {
    onChange({ ...config, widgets: config.widgets.filter((w) => w.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };
  const move = (id: string, direction: -1 | 1) => {
    const index = config.widgets.findIndex((w) => w.id === id),
      target = index + direction;
    if (target < 0 || target >= config.widgets.length) return;
    const widgets = [...config.widgets];
    [widgets[index], widgets[target]] = [widgets[target], widgets[index]];
    let y = 0;
    onChange({
      ...config,
      widgets: widgets.map((w) => {
        const p = resolveReportLayout(config).find((p) => p.id === w.id)!;
        const layout = { x: 0, y, w: p.w, h: p.h };
        y += p.h;
        return { ...w, layout };
      }),
    });
  };
  const canvas = (
    <div className="min-h-full bg-muted/30 p-5 md:p-7" aria-label={t("canvasAria")}>
      <div className="mx-auto w-full max-w-[1600px]">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold tracking-tight">
            {config.name || t("unnamedReport")}
          </h2>
          {config.description && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {config.description}
            </p>
          )}
        </div>
        {!config.widgets.length ? (
          <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-background text-center">
            <BarChart3 className="size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t("addWidgetHint")}
            </p>
            {mode === "design" && (
              <Button variant="outline" size="sm" onClick={() => add("chart")}>
                <Plus data-icon="inline-start" />
                {t("addChart")}
              </Button>
            )}
          </div>
        ) : (
          <DashboardCanvas
            config={config}
            editable={mode === "design"}
            onChange={onChange}
            render={(widget, index) =>
              mode === "preview" ? (
                <article
                  data-widget-id={widget.id}
                  className="flex h-full min-h-0 min-w-0 flex-col rounded-xl border border-border bg-card p-4"
                >
                  <h3 className="mb-3 shrink-0 text-sm font-medium">
                    {widget.title || widgetTypes()[widget.type].label}
                  </h3>
                  <div className="min-h-0 flex-1 overflow-auto">
                    <WidgetContent
                      widget={widget}
                      result={data.widgets.find((r) => r.id === widget.id)}
                      loading={loading}
                    />
                  </div>
                </article>
              ) : (
                <DashboardWidget
                  widget={widget}
                  result={data.widgets.find((r) => r.id === widget.id)}
                  selected={selectedId === widget.id}
                  loading={loading}
                  onSelect={() => setSelectedId(widget.id)}
                  onDelete={() => remove(widget.id)}
                  onMove={(direction) => move(widget.id, direction)}
                  first={index === 0}
                  last={index === config.widgets.length - 1}
                />
              )
            }
          />
        )}
      </div>
    </div>
  );
  if (mode === "preview")
    return <div className="min-h-0 flex-1 overflow-auto">{canvas}</div>;
  return (
    <>
      <BuilderLayout
        sidebar={
          <>
            <Button variant="ghost" size="sm" className="mb-4 w-full justify-start" onClick={() => setSelectedId(null)}>
              <Settings2 data-icon="inline-start" />{t("pageSettings")}
            </Button>
            <p className="mb-3 text-xs font-medium text-muted-foreground">
              {t("addWidget")}
            </p>
            <div className="flex flex-col gap-1">
              {(Object.keys(widgetTypes()) as ReportWidget["type"][]).map((type) => {
                const Icon = widgetTypes()[type].icon;
                return (
                  <Button
                    key={type}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    disabled={config.widgets.length >= 40}
                    onClick={() => add(type)}
                  >
                    <Icon data-icon="inline-start" />
                    {widgetTypes()[type].label}
                    <Plus data-icon="inline-end" className="ml-auto" />
                  </Button>
                );
              })}
            </div>
            <Separator className="my-4" />
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {t("pageWidgets", { count: config.widgets.length })}
            </p>
            <div className="flex flex-col gap-1">
              {config.widgets.map((w) => {
                const Icon = widgetTypes()[w.type].icon;
                return (
                  <Button
                    key={w.id}
                    variant={selectedId === w.id ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setSelectedId(w.id)}
                    aria-pressed={selectedId === w.id}
                    className="w-full justify-start"
                  >
                    <Icon data-icon="inline-start" />
                    <span className="truncate">
                      {w.title || widgetTypes()[w.type].label}
                    </span>
                  </Button>
                );
              })}
            </div>
          </>
        }
        canvas={canvas}
        inspector={
          <FieldGroup>
            <p className="text-xs font-medium text-muted-foreground">
              {selected ? t("widgetSettings") : t("pageSettings")}
            </p>
            {!selected ? (
              <>
                <Field>
                  <FieldLabel htmlFor="report-name">{t("reportName")}</FieldLabel>
                  <Input
                    id="report-name"
                    value={config.name}
                    maxLength={120}
                    onChange={(e) =>
                      onChange({ ...config, name: e.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="report-description">{t("pageDescription")}</FieldLabel>
                  <Textarea
                    id="report-description"
                    value={config.description}
                    maxLength={2000}
                    onChange={(e) =>
                      onChange({ ...config, description: e.target.value })
                    }
                  />
                </Field>
                <Choice
                  id="report-columns"
                  label={t("defaultLayout")}
                  value={String(config.columns)}
                  options={[
                    { id: "1", name: t("layoutOneCol") },
                    { id: "2", name: t("layoutTwoCol") },
                  ]}
                  onChange={(id) =>
                    onChange({ ...config, columns: id === "1" ? 1 : 2 })
                  }
                />
              </>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="widget-title">{t("widgetTitle")}</FieldLabel>
                  <Input
                    id="widget-title"
                    value={selected.title}
                    maxLength={120}
                    onChange={(e) =>
                      patch({ ...selected, title: e.target.value })
                    }
                  />
                </Field>
                {selected.type === "text" ? (
                  <Field>
                    <FieldLabel htmlFor="widget-content">{t("textContent")}</FieldLabel>
                    <Textarea
                      id="widget-content"
                      value={selected.content}
                      maxLength={10_000}
                      rows={8}
                      onChange={(e) =>
                        patch({ ...selected, content: e.target.value })
                      }
                    />
                  </Field>
                ) : (
                  <>
                    <Choice
                      id="report-source"
                      label={t("sourceTable")}
                      value={selected.query.tableId ?? ""}
                      options={tables}
                      placeholder={tables.length ? t("pickSourceTable") : t("noTables")}
                      onChange={(tableId) =>
                        patch(
                          selected.type === "chart"
                            ? {
                                ...selected,
                                query: {
                                  ...selected.query,
                                  tableId,
                                  groupColumnId: null,
                                  valueColumnId: null,
                                },
                              }
                            : {
                                ...selected,
                                query: {
                                  ...selected.query,
                                  tableId,
                                  valueColumnId: null,
                                },
                              },
                        )
                      }
                    />
                    {selected.type === "chart" && (
                      <Choice
                        id="report-group"
                        label={t("groupField")}
                        value={selected.query.groupColumnId ?? ""}
                        options={columns.filter((c) =>
                          ["text", "select", "date", "checkbox"].includes(
                            c.type,
                          ),
                        )}
                        disabled={!sourceId || columnsLoading || columnsError}
                        placeholder={columnPlaceholder(
                          columns.some((c) =>
                            ["text", "select", "date", "checkbox"].includes(
                              c.type,
                            ),
                          )
                            ? t("pickGroupField")
                            : t("noGroupField"),
                        )}
                        onChange={(groupColumnId) =>
                          patch({
                            ...selected,
                            query: { ...selected.query, groupColumnId },
                          })
                        }
                      />
                    )}
                    <Choice
                      id="report-metric"
                      label={t("metric")}
                      value={selected.query.metric}
                      options={[
                        { id: "count", name: t("metricCount") },
                        { id: "sum", name: t("metricSum") },
                        { id: "average", name: t("metricAvg") },
                      ]}
                      onChange={(metric) =>
                        patchQuery(selected, {
                          metric: metric as ReportConfig["metric"],
                        })
                      }
                    />
                    {selected.query.metric !== "count" && (
                      <Choice
                        id="report-value"
                        label={t("numberField")}
                        value={selected.query.valueColumnId ?? ""}
                        options={columns.filter((c) => c.type === "number")}
                        disabled={!sourceId || columnsLoading || columnsError}
                        placeholder={columnPlaceholder(
                          columns.some((c) => c.type === "number")
                            ? t("pickNumberField")
                            : t("noNumberField"),
                        )}
                        onChange={(valueColumnId) =>
                          patchQuery(selected, { valueColumnId })
                        }
                      />
                    )}
                    {selected.type === "chart" && (
                      <>
                        <Choice
                          id="report-chart"
                          label={t("chartType")}
                          value={selected.query.chartType}
                          options={reportChartOptions().map(
                            ({ icon: glyph, ...option }) => ({
                              ...option,
                              glyph,
                            }),
                          )}
                          onChange={(chartType) =>
                            patch({
                              ...selected,
                              query: {
                                ...selected.query,
                                chartType:
                                  chartType as ReportConfig["chartType"],
                              },
                            })
                          }
                        />
                        {columns.find(
                          (c) => c.id === selected.query.groupColumnId,
                        )?.type === "date" && (
                          <Choice
                            id="report-date"
                            label={t("dateBucket")}
                            value={selected.query.dateBucket}
                            options={[
                              { id: "month", name: t("byMonth") },
                              { id: "day", name: t("byDay") },
                            ]}
                            onChange={(dateBucket) =>
                              patch({
                                ...selected,
                                query: {
                                  ...selected.query,
                                  dateBucket: dateBucket as "day" | "month",
                                },
                              })
                            }
                          />
                        )}
                      </>
                    )}
                  </>
                )}
                <Button
                  variant="destructive-ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => remove(selected.id)}
                >
                  <Trash2 data-icon="inline-start" />
                  {t("deleteWidget")}
                </Button>
              </>
            )}
          </FieldGroup>
        }
      />
    </>
  );
}
