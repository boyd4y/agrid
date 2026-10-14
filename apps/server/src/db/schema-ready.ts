import { client } from "./index.js";

/**
 * Detect common "forgot to migrate" failure modes that surface as opaque 500s
 * (e.g. create/list tables → toast「服务暂时不可用」).
 */
export async function checkSchemaReady(): Promise<{ ok: true } | { ok: false; missing: string[] }> {
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

  const [{ fileGc }] = await client`SELECT to_regclass('public.storage_gc_jobs') IS NOT NULL AS "fileGc"`;
  if (!fileGc) missing.push("storage_gc_jobs (run pnpm db:migrate — migration 0026)");

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
