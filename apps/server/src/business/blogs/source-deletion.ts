import { and, eq, sql } from "drizzle-orm";
import { sites, siteRevisions } from "../db/schema.js";
import type { Transaction } from "../db/types.js";
import { BlogError } from "./errors.js";
/** Published copies have separate ownership. Require explicit recall before deleting their source. */
export async function requireUnpublishedBlogSource(tx: Transaction, tableId: string, rowId?: string) {
  const [published] = await tx.select({ id: sites.id }).from(sites).innerJoin(siteRevisions, eq(siteRevisions.id, sites.publishedRevisionId)).where(and(
    eq(sites.kind, "blog"), sql`${sites.blogConfig}->>'tableId' = ${tableId}`,
    rowId ? sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${siteRevisions.blogManifest}->'articles') AS article WHERE article->>'rowId' = ${rowId})` : undefined,
  )).limit(1);
  if (published) throw new BlogError(409, "SOURCE_CHANGED", "Withdraw the published blog article or unpublish its blog before deleting this source");
}
