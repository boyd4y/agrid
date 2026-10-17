import { z } from "zod";
import { and, eq, sql, type AnyColumn } from "drizzle-orm";
import { workspaces } from "../db/workspaces-schema.js";
import type { DatabaseDependencies } from "../dependencies.js";
import type { Database } from "../db/types.js";
import { ServiceError } from "../errors.js";

/** Explicit, immutable invocation scope. No session/ALS lookups in business operations. */
export function workspaceScope(deps: Pick<DatabaseDependencies, "workspaceId">, organizationId: string, column: AnyColumn) {
  return deps.workspaceId ? eq(column, deps.workspaceId) : sql`${column} = (select id from workspaces where organization_id = ${organizationId} and is_default = true)`;
}
export async function requireWorkspace(deps: Readonly<{ database: Database; workspaceId?: string }>, organizationId: string, database: Database = deps.database) {
  if (deps.workspaceId !== undefined && !z.uuid().safeParse(deps.workspaceId).success) throw new ServiceError(403, { message: "工作区不可访问" });
  if (!organizationId) throw new ServiceError(400, { message: "缺少企业上下文" });
  const [workspace] = await database.select().from(workspaces).where(and(eq(workspaces.organizationId, organizationId),
    deps.workspaceId ? eq(workspaces.id, deps.workspaceId) : eq(workspaces.isDefault, true))).limit(1).for("key share");
  if (!workspace) throw new ServiceError(403, { message: "工作区不可访问" });
  return workspace;
}
export async function workspaceMatches(deps: Readonly<{ database: Database; workspaceId?: string }>, resource: { organizationId: string; workspaceId: string }, database: Database = deps.database) {
  return resource.workspaceId === (await requireWorkspace(deps, resource.organizationId, database)).id;
}
