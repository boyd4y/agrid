import { getDatabaseClient } from "../resources/scope.js";

/**
 * Detect common "forgot to migrate" failure modes that surface as opaque 500s
 * (e.g. create/list tables → toast「服务暂时不可用」).
 */
export async function checkSchemaReady(): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  const client = getDatabaseClient();
  const missing: string[] = [];
  const [{ icon }] = await client`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tables' AND column_name = 'icon'
    ) AS icon
  `;
  if (!icon) missing.push("tables.icon (run pnpm db:migrate — migration 0011)");

  const [{ pinned }] = await client`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tables' AND column_name = 'pinned'
    ) AS pinned
  `;
  if (!pinned) missing.push("tables.pinned (run pnpm db:migrate — migration 0011)");

  const [{ chat }] = await client`
    SELECT to_regclass('public.chat_threads') IS NOT NULL AS chat
  `;
  if (!chat) missing.push("chat_threads (run pnpm db:migrate — migration 0009)");

  const [{ reports }] = await client`
    SELECT to_regclass('public.reports') IS NOT NULL AS reports
  `;
  if (!reports) missing.push("reports (run pnpm db:migrate — migration 0013)");

  for (const name of ["automations", "automation_runs", "table_views", "agent_runtime_sessions", "agent_runs", "agent_executions", "agent_execution_chunks", "file_objects", "api_keys", "api_key_tables", "sites", "site_revisions", "site_previews"]) {
    const [{ present }] = await client`SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS present`;
    if (!present) missing.push(`${name} (run pnpm db:migrate)`);
  }
  const [{ viewPreferences }] = await client`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='table_views' AND column_name='is_default') AS "viewPreferences"
  `;
  if (!viewPreferences) missing.push("table_views.is_default (run pnpm db:migrate — migration 0020; audit recorded migration if still missing)");
  const [{ scopedNames }] = await client`
    SELECT count(*) = 2 AS "scopedNames" FROM pg_trigger
    WHERE NOT tgisinternal AND tgenabled IN ('O', 'A') AND
      ((tgrelid = to_regclass('public.tables') AND tgname = 'tables_org_name_unique') OR
       (tgrelid = to_regclass('public.columns') AND tgname = 'columns_table_name_unique'))
  `;
  if (!scopedNames) missing.push("scoped name constraint triggers (run pnpm db:migrate — migration 0024)");
  const [{ orgRequired, eventAutomations }] = await client`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tables' AND column_name='organization_id' AND is_nullable='NO') AS "orgRequired",
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='automations' AND column_name='organization_id') AS "eventAutomations"
  `;
  if (!orgRequired) missing.push("tables.organization_id NOT NULL (run pnpm db:migrate — migration 0004)");
  if (!eventAutomations) missing.push("automations.organization_id (run pnpm db:migrate — migration 0023)");

  return missing.length ? { ok: false, missing } : { ok: true };
}

export async function assertSchemaReady(): Promise<void> {
  const result = await checkSchemaReady();
  if (!result.ok) {
    throw new Error(
      `Database schema is behind the app. Missing: ${result.missing.join("; ")}. Fix: pnpm db:migrate && pnpm db:seed`
    );
  }
}
