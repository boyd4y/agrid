/** Only our named database constraints are translated; no SQL or parameters leak. */
export function nameConflictMessage(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const cause = error as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
    if (cause.code === "23505") {
      const constraint = cause.constraint_name ?? cause.constraint;
      if (constraint === "tables_org_name_unique") return "同一工作区已存在同名表格，请使用其他名称";
      if (constraint === "columns_table_name_unique") return "同一表格已存在同名字段，请使用其他名称";
    }
    error = cause.cause;
  }
}
