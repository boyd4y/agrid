import {
  filterTypeForColumn,
  opsForType,
  type CellValue,
  type ColumnDef,
  type ColumnType,
  type FilterOp,
  type RowData,
} from "@tabdo/shared";

/** Computed columns use their declared result type, or actual homogeneous loaded values. */
export function filterValueType(
  column: ColumnDef,
  sampleRows: Pick<RowData, "cells">[] = [],
): ColumnType | string {
  const resolved = filterTypeForColumn(column);
  if (resolved !== "formula") return resolved;
  const types = new Set(
    sampleRows
      .map((row) => row.cells[column.id])
      .filter(
        (value) =>
          value !== null &&
          value !== undefined &&
          value !== "" &&
          !(typeof value === "string" && value.startsWith("#ERR:")),
      )
      .map((value) =>
        typeof value === "number"
          ? "number"
          : typeof value === "boolean"
            ? "checkbox"
            : typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
              ? "date"
              : "text",
      ),
  );
  return types.size === 1 ? ([...types][0] as ColumnType) : "text";
}

export function filterOpsForColumn(
  column: ColumnDef | undefined,
  sampleRows: Pick<RowData, "cells">[] = [],
): FilterOp[] {
  return opsForType(column ? filterValueType(column, sampleRows) : "text");
}

/** Incomplete numeric drafts stay local; a query never receives NaN/Infinity or a sign. */
export function parseFilterNumber(raw: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim()))
    return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

/** Comparison operators for a column share one scalar value; switching column resets it. */
export function changedFilterOperator(op: FilterOp): {
  op: FilterOp;
  value: CellValue;
} {
  return { op, value: null };
}
