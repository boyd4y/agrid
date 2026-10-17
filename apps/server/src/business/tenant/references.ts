import type { CommandDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { requireTableInOrg, requireRowInOrg, requireColumnInOrg } from "./scope.js";
import { tableViews } from "../db/schema.js";
import { eq } from "drizzle-orm";

/** Validate literal action references now; deferred bindings are checked by the executing command. */
export async function assertCommandReferences(deps: CommandDependencies, tx: Transaction, organizationId: string, value: unknown): Promise<void> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, field] of Object.entries(value)) {
    if (key === "cells" || key === "value" || key === "values") continue;
    if (typeof field === "string") {
      if (["tableId", "targetTableId"].includes(key)) await requireTableInOrg(deps, field, organizationId, tx);
      if (key === "rowId") await requireRowInOrg(deps, field, organizationId, tx);
      if (["columnId", "targetColumnId", "relationColumnId"].includes(key)) await requireColumnInOrg(deps, field, organizationId, tx);
      if (key === "viewId") {
        const [view] = await tx.select().from(tableViews).where(eq(tableViews.id, field));
        if (!view) throw new Error("视图不存在");
        await requireTableInOrg(deps, view.tableId, organizationId, tx);
      }
    } else if (Array.isArray(field)) {
      for (const item of field) {
        if (typeof item === "string" && key === "rowIds") await requireRowInOrg(deps, item, organizationId, tx);
        else if (typeof item === "string" && key === "columnIds") await requireColumnInOrg(deps, item, organizationId, tx);
        else await assertCommandReferences(deps, tx, organizationId, item);
      }
    } else if (field && typeof field === "object" && !Object.hasOwn(field, "$event") && !Object.hasOwn(field, "$step")) {
      await assertCommandReferences(deps, tx, organizationId, field);
    }
  }
}
