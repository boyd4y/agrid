import { sha256 } from "@tabdo/core/crypto";
import { and, eq } from "drizzle-orm";
import { createViewSchema, updateViewSchema, type TableView, type CreateViewInput, type UpdateViewInput } from "@tabdo/shared";
import type { CommandDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { inTransaction } from "../db/context.js";
import { tableViews, tables } from "../db/schema.js";
import { executeBlog, type BlogCaller } from "../blogs/service.js";
import { BlogError } from "../blogs/errors.js";
import { requireSiteTable, resolveSiteKey } from "../data-api/keys.js";
import { requireWorkspace } from "../tenant/workspace.js";
import { withRowReceipt } from "./row-body.js";
import { insertView, toTableView } from "./views.js";

export async function siteViewDetail(deps: CommandDependencies, caller: BlogCaller, view: typeof tableViews.$inferSelect, tx?: Transaction): Promise<TableView> {
  if (!view.siteId) throw new BlogError(404, "NOT_FOUND", "Site view artifact not found");
  const detail = await executeBlog(deps, caller, "getBlog", { siteId: view.siteId }, tx);
  const { tableId: _, ...config } = detail.config;
  return { ...toTableView(view), name: detail.name, config: { ...config, template: "blog" }, site: {
    id: detail.id, version: detail.version, revisionId: detail.revisionId, publishedRevisionId: detail.publishedRevisionId,
    publicUrl: detail.publicUrl, pendingChanges: detail.pendingChanges, publishedRows: detail.publishedArticles,
  } };
}

/** One view mutation boundary, including publication receipt and artifact writes. */
export async function executeSiteView(deps: CommandDependencies, caller: BlogCaller, command: "createView" | "updateView", raw: unknown, transaction?: Transaction): Promise<TableView> {
  const input = (command === "createView" ? createViewSchema : updateViewSchema).parse(raw);
  return inTransaction(deps, transaction, root => root.transaction(async tx => {
    let view: typeof tableViews.$inferSelect | undefined;
    if ("viewId" in input) {
      [view] = await tx.select().from(tableViews).where(eq(tableViews.id, input.viewId));
      if (!view || view.type !== "site" || !view.siteId) throw new BlogError(404, "NOT_FOUND", "Site view not found");
    }
    const tableId = view?.tableId ?? (input as CreateViewInput).tableId;
    const principal = caller.kind === "key" ? await resolveSiteKey(tx, caller.secret, true) : undefined;
    const organizationId = principal?.organizationId ?? (caller as Exclude<BlogCaller, { kind: "key" }>).organizationId;
    if (principal) { requireSiteTable(principal, tableId, "read"); requireSiteTable(principal, tableId, "update"); }
    const [table] = await tx.select().from(tables).where(and(eq(tables.id, tableId), eq(tables.organizationId, organizationId))).for("update");
    if (!table || !principal && table.workspaceId !== (await requireWorkspace(deps, organizationId, tx)).id) throw new BlogError(404, "NOT_FOUND", "Table not found");
    if (view) {
      [view] = await tx.select().from(tableViews).where(eq(tableViews.id, view.id)).for("update");
      if (!view) throw new BlogError(404, "NOT_FOUND", "View not found");
    }
    return withRowReceipt(tx, { workspaceId: table.workspaceId, principalId: principal ? `key:${principal.id}` : `user:${(caller as Exclude<BlogCaller, { kind: "key" }>).actorId}` }, command, input, async () => {
      const digest = await sha256(input.idempotencyKey);
      const key = (step: string) => `view:${command}:${digest}:${step}`;
      if (command === "createView") {
        const create = input as CreateViewInput, { template, ...config } = create.config;
        const artifact = await executeBlog(deps, caller, "saveBlog", { name: create.name, config: { ...config, tableId }, idempotencyKey: key("save") }, tx);
        [view] = await tx.select().from(tableViews).where(eq(tableViews.siteId, artifact.id));
        view ??= await insertView(deps, tableId, { type: "site", name: create.name, config: create.config, siteId: artifact.id }, tx);
      } else {
        const patch = input as UpdateViewInput;
        let current = await executeBlog(deps, caller, "getBlog", { siteId: view!.siteId! }, tx);
        if (current.version !== patch.expectedVersion || patch.publication && current.publishedRevisionId !== patch.publication.expectedPublishedRevisionId)
          throw new BlogError(409, "VERSION_CONFLICT", "View changed; retain your draft and reload");
        if (patch.config || patch.name !== undefined) {
          const { template, ...config } = patch.config ?? { ...current.config, template: "blog" };
          current = await executeBlog(deps, caller, "saveBlog", { siteId: current.id, expectedVersion: current.version, name: patch.name ?? current.name, config: { ...config, tableId }, idempotencyKey: key("save") }, tx);
        }
        if (patch.publication) {
          const publication = patch.publication;
          if (publication.action === "publish") {
            current = await executeBlog(deps, caller, "buildBlog", { siteId: current.id, expectedVersion: current.version, idempotencyKey: key("snapshot") }, tx);
            current = await executeBlog(deps, caller, "publishBlog", { siteId: current.id, expectedVersion: current.version, expectedPublishedRevisionId: publication.expectedPublishedRevisionId, buildId: current.revisionId, idempotencyKey: key("pin") }, tx, { ephemeralBuild: true });
          } else {
            current = await executeBlog(deps, caller, publication.action === "unpublish" ? "unpublishBlog" : "withdrawBlogArticle", { siteId: current.id, expectedVersion: current.version, expectedPublishedRevisionId: publication.expectedPublishedRevisionId, ...(publication.action === "withdraw" ? { rowId: publication.rowId } : {}), idempotencyKey: key(publication.action) }, tx);
          }
        }
        const { tableId: _, ...config } = current.config;
        [view] = await tx.update(tableViews).set({ name: current.name, config: { ...config, template: "blog" }, updatedAt: deps.now() }).where(eq(tableViews.id, view!.id)).returning();
      }
      return siteViewDetail(deps, caller, view!, tx);
    });
  }));
}

type Identity = { organizationId?: string; actorId?: string };
const caller = (input: Identity): BlogCaller => {
  if (!input.organizationId || !input.actorId) throw new BlogError(403, "FORBIDDEN", "Current membership is required");
  return { kind: "member", organizationId: input.organizationId, actorId: input.actorId };
};
export function createView(deps: CommandDependencies, input: CreateViewInput & Identity, tx?: Transaction) {
  const { organizationId, actorId, ...raw } = input;
  return executeSiteView(deps, caller(input), "createView", raw, tx);
}
export function updateView(deps: CommandDependencies, input: UpdateViewInput & Identity, tx?: Transaction) {
  const { organizationId, actorId, ...raw } = input;
  return executeSiteView(deps, caller(input), "updateView", raw, tx);
}
