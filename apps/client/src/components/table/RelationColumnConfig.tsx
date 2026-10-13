import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Input } from "@tabdo/ui/components/input";
import { Label } from "@tabdo/ui/components/label";
import { Checkbox } from "@tabdo/ui/components/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tabdo/ui/components/select";
import { useTranslation } from "react-i18next";
import type {
  ColumnConfig,
  ColumnDef,
  FullTable,
  TableMeta,
} from "@/types/table";
export function RelationColumnConfig({
  type,
  config,
  onChange,
  columns,
  existing = false,
}: {
  type: "relation" | "rollup";
  config: ColumnConfig;
  onChange: (config: ColumnConfig) => void;
  columns: ColumnDef[];
  existing?: boolean;
}) {
  const { t } = useTranslation("table");
  const operations = {
    count: t("rollupOps.count"),
    sum: t("rollupOps.sum"),
    average: t("rollupOps.average"),
    min: t("rollupOps.min"),
    max: t("rollupOps.max"),
    earliest: t("rollupOps.earliest"),
    latest: t("rollupOps.latest"),
  } as const;
  const [tables, setTables] = useState<TableMeta[]>([]),
    [target, setTarget] = useState<FullTable | null>(null),
    [error, setError] = useState<string | null>(null);
  const relation = config.relation,
    rollup = config.rollup;
  const selectedRelation = columns.find(
    (c) => c.id === rollup?.relationColumnId && c.type === "relation",
  );
  const targetId =
    type === "relation"
      ? relation?.targetTableId
      : selectedRelation?.config.relation?.targetTableId;
  useEffect(() => {
    let cancelled = false;
    api
      .listTables()
      .then((list) => {
        if (!cancelled) setTables(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setTarget(null);
    if (targetId)
      api
        .getTable(targetId)
        .then((value) => {
          if (!cancelled) setTarget(value);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [targetId]);
  const updateRelation = (
    patch: Partial<NonNullable<ColumnConfig["relation"]>>,
  ) =>
    onChange({
      ...config,
      relation: {
        targetTableId: relation?.targetTableId ?? "",
        limit: relation?.limit ?? "many",
        ...relation,
        ...patch,
      },
    });
  const updateRollup = (patch: Partial<NonNullable<ColumnConfig["rollup"]>>) =>
    onChange({
      ...config,
      rollup: {
        relationColumnId: rollup?.relationColumnId ?? "",
        operation: rollup?.operation ?? "count",
        ...rollup,
        ...patch,
      },
    });
  const valueType = ["earliest", "latest"].includes(rollup?.operation ?? "")
    ? "date"
    : "number";
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {type === "relation" ? (
        <>
          <div className="space-y-1">
            <Label>{t("relationTable")}</Label>
            <Select
              value={relation?.targetTableId ?? ""}
              onValueChange={(targetTableId) =>
                updateRelation({ targetTableId })
              }
              disabled={existing}
            >
              <SelectTrigger aria-label={t("relationTable")}>
                <SelectValue placeholder={t("pickTargetTable")} />
              </SelectTrigger>
              <SelectContent>
                {tables.map((table) => (
                  <SelectItem key={table.id} value={table.id}>
                    {table.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("relationAllow")}</Label>
            <Select
              value={relation?.limit ?? "many"}
              onValueChange={(limit) =>
                updateRelation({ limit: limit as "one" | "many" })
              }
              disabled={existing}
            >
              <SelectTrigger aria-label={t("relationAllow")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="one">{t("relationLimitOne")}</SelectItem>
                <SelectItem value="many">{t("relationLimitMany")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {existing ? (
            <p className="text-xs text-muted-foreground">
              {t("relationChangeHint")}
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={Boolean(relation?.inverseName)}
                  onCheckedChange={(checked) =>
                    updateRelation({
                      inverseName: checked ? t("inverseDefaultName") : undefined,
                    })
                  }
                />
                {t("showInverse")}
              </label>
              {relation?.inverseName !== undefined && (
                <div className="space-y-2">
                  <Input
                    aria-label={t("inverseFieldName")}
                    value={relation.inverseName}
                    onChange={(e) =>
                      updateRelation({ inverseName: e.target.value })
                    }
                    placeholder={t("inverseFieldName")}
                  />
                  <Select
                    value={relation.inverseLimit ?? "many"}
                    onValueChange={(limit) =>
                      updateRelation({ inverseLimit: limit as "one" | "many" })
                    }
                  >
                    <SelectTrigger aria-label={t("inverseLimit")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="one">{t("inverseLimitOne")}</SelectItem>
                      <SelectItem value="many">{t("inverseLimitMany")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="space-y-1">
            <Label>{t("rollupVia")}</Label>
            <Select
              value={rollup?.relationColumnId ?? ""}
              onValueChange={(relationColumnId) =>
                updateRollup({ relationColumnId, targetColumnId: undefined })
              }
            >
              <SelectTrigger aria-label={t("rollupRelationField")}>
                <SelectValue placeholder={t("pickRelationField")} />
              </SelectTrigger>
              <SelectContent>
                {columns
                  .filter((c) => c.type === "relation")
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {!columns.some((c) => c.type === "relation") && (
              <p className="text-xs text-muted-foreground">
                {t("needRelationFirst")}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label>{t("rollupMethod")}</Label>
            <Select
              value={rollup?.operation ?? "count"}
              onValueChange={(operation) =>
                updateRollup({
                  operation: operation as keyof typeof operations,
                  targetColumnId: undefined,
                })
              }
            >
              <SelectTrigger aria-label={t("rollupMethodAria")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(operations).map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {rollup?.operation && rollup.operation !== "count" && (
            <div className="space-y-1">
              <Label>{t("targetField")}</Label>
              <Select
                value={rollup.targetColumnId ?? ""}
                onValueChange={(targetColumnId) =>
                  updateRollup({ targetColumnId })
                }
              >
                <SelectTrigger aria-label={t("rollupTargetField")}>
                  <SelectValue
                    placeholder={valueType === "date" ? t("pickDateField") : t("pickNumberField")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {target?.columns
                    .filter((c) => c.type === valueType)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t("rollupReadonlyHint")}
          </p>
        </>
      )}
    </div>
  );
}
