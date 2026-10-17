import { workspaceScope, requireWorkspace } from "../tenant/workspace.js";
import { and, eq } from "drizzle-orm";
import type { CommandDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { tables } from "../db/schema.js";
import { inTransaction } from "../db/context.js";

export function updateTableMetadata(deps: CommandDependencies, organizationId: string, id: string,
  body: { name?: string; description?: string | null; icon?: string | null; pinned?: boolean }, transaction?: Transaction) {
  return inTransaction(deps, transaction, async tx => {
    const [updated] = await tx.update(tables).set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.icon !== undefined ? { icon: body.icon } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}), updatedAt: deps.now(),
    }).where(and(eq(tables.id, id), and(eq(tables.organizationId, organizationId), workspaceScope(deps, organizationId, tables.workspaceId)))).returning();
    return updated;
  });
}
