import "../load-env.js";
import postgres from "postgres";
import { fileURLToPath } from "node:url";

/** Read-only by default. Finalization requires an operator's verified old-writer drain. */
export async function finalizeUnifiedSites(sql: ReturnType<typeof postgres>, finalize = false) {
  return sql.begin(async tx => {
    if (finalize) {
      // Old transactions finish first. New runtime transactions wait and resume
      // after the bridge is removed; all new writes link their own view.
      await tx`SET LOCAL lock_timeout = '10s'`;
      await tx`LOCK TABLE sites, table_views IN ACCESS EXCLUSIVE MODE`;
    }
    const mismatches = await tx`SELECT s.id FROM sites s LEFT JOIN table_views v ON v.site_id = s.id
      WHERE s.kind = 'blog' AND (v.id IS NULL OR v.type <> 'site'
        OR v.table_id::text IS DISTINCT FROM s.blog_config->>'tableId'
        OR v.name IS DISTINCT FROM s.name
        OR v.config IS DISTINCT FROM ((s.blog_config - 'tableId') || '{"template":"blog"}'::jsonb))`;
    if (mismatches.length) throw new Error(`Site/view reconciliation failed for ${mismatches.length} sites; keep bridge and old-writer drain, investigate before retry`);
    const [counts] = await tx<{ sites: number; views: number; published: number; bridge: boolean }[]>`SELECT (SELECT count(*)::int FROM sites WHERE kind='blog') AS sites,
      (SELECT count(*)::int FROM table_views WHERE type='site') AS views,
      (SELECT count(*)::int FROM sites WHERE published_revision_id IS NOT NULL) AS published,
      EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='unified_site_view_cutover' AND NOT tgisinternal) AS bridge`;
    if (finalize) {
      await tx`DROP TRIGGER IF EXISTS unified_site_view_cutover ON sites`;
      await tx`DROP FUNCTION IF EXISTS sync_unified_site_view()`;
    }
    return { ...counts, finalized: finalize };
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const finalize = process.argv.includes("--finalize");
  if (finalize && !process.argv.includes("--old-writers-drained")) throw new Error("Finalization requires --old-writers-drained after old API/worker processes and in-flight transactions are stopped");
  const pooled = process.env.DATABASE_URL, direct = process.env.DATABASE_URL_UNPOOLED;
  if (!pooled || !direct) throw new Error("Set DATABASE_URL and DATABASE_URL_UNPOOLED explicitly");
  const sql = postgres(direct, { max: 1 });
  try { console.log(JSON.stringify(await finalizeUnifiedSites(sql, finalize))); } finally { await sql.end(); }
}
