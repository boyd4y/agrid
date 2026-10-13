import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ColumnConfig,
  ColumnDef,
  FullTable,
  TableMeta,
} from "@/types/table";
const operations = {
  count: "关联记录数",
  sum: "求和",
  average: "平均值",
  min: "最小值",
  max: "最大值",
  earliest: "最早日期",
  latest: "最晚日期",
} as const;
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
            <Label>关联表格</Label>
            <Select
              value={relation?.targetTableId ?? ""}
              onValueChange={(targetTableId) =>
                updateRelation({ targetTableId })
              }
              disabled={existing}
            >
              <SelectTrigger aria-label="关联表格">
                <SelectValue placeholder="选择目标表格" />
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
            <Label>允许关联</Label>
            <Select
              value={relation?.limit ?? "many"}
              onValueChange={(limit) =>
                updateRelation({ limit: limit as "one" | "many" })
              }
              disabled={existing}
            >
              <SelectTrigger aria-label="允许关联">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="one">一条记录</SelectItem>
                <SelectItem value="many">多条记录</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {existing ? (
            <p className="text-xs text-muted-foreground">
              更换目标表或关联限制，请创建新关联字段。删除此字段也会移除对应的反向字段。
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={Boolean(relation?.inverseName)}
                  onCheckedChange={(checked) =>
                    updateRelation({
                      inverseName: checked ? "关联记录" : undefined,
                    })
                  }
                />
                在目标表显示反向关联
              </label>
              {relation?.inverseName !== undefined && (
                <div className="space-y-2">
                  <Input
                    aria-label="反向字段名称"
                    value={relation.inverseName}
                    onChange={(e) =>
                      updateRelation({ inverseName: e.target.value })
                    }
                    placeholder="反向字段名称"
                  />
                  <Select
                    value={relation.inverseLimit ?? "many"}
                    onValueChange={(limit) =>
                      updateRelation({ inverseLimit: limit as "one" | "many" })
                    }
                  >
                    <SelectTrigger aria-label="反向关联限制">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="one">反向最多一条记录</SelectItem>
                      <SelectItem value="many">反向允许多条记录</SelectItem>
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
            <Label>通过哪个关联汇总</Label>
            <Select
              value={rollup?.relationColumnId ?? ""}
              onValueChange={(relationColumnId) =>
                updateRollup({ relationColumnId, targetColumnId: undefined })
              }
            >
              <SelectTrigger aria-label="汇总关联字段">
                <SelectValue placeholder="选择本表关联字段" />
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
                请先创建一个关联字段。
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label>计算方式</Label>
            <Select
              value={rollup?.operation ?? "count"}
              onValueChange={(operation) =>
                updateRollup({
                  operation: operation as keyof typeof operations,
                  targetColumnId: undefined,
                })
              }
            >
              <SelectTrigger aria-label="汇总计算方式">
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
              <Label>目标字段</Label>
              <Select
                value={rollup.targetColumnId ?? ""}
                onValueChange={(targetColumnId) =>
                  updateRollup({ targetColumnId })
                }
              >
                <SelectTrigger aria-label="汇总目标字段">
                  <SelectValue
                    placeholder={`选择${valueType === "date" ? "日期" : "数字"}字段`}
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
            汇总由关联记录计算，只读，不支持嵌套汇总。
          </p>
        </>
      )}
    </div>
  );
}
