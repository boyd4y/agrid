import { requireRelease, ReleaseError } from "./guards.mjs";

// Bounded reads only. Never retry mutations: a lost response can still mean the
// provider accepted the snapshot. Report that uncertainty instead.
export async function poll(read, ready, { attempts = 60, intervalMs = 5000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await read();
    if (ready(value)) return value;
    if (attempt + 1 < attempts) await sleep(intervalMs);
  }
  throw new ReleaseError("platform_wait_timeout_outcome_unknown");
}

export function createNeon(env, config, fetcher = fetch, pollOptions = {}) {
  async function request(url, options, code) {
    try {
      const response = await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(30000) });
      requireRelease(response.ok, code);
      return response;
    } catch { throw new ReleaseError(code); }
  }
  async function neon(path, method = "GET") {
    const response = await request(`https://console.neon.tech/api/v2/projects/${config.neonProjectId}${path}`, {
      method, headers: { Authorization: `Bearer ${env.NEON_API_KEY}` },
    }, "neon_request_failed");
    return response.json();
  }
  return {
    async verifyTarget() {
      const { branch } = await neon(`/branches/${config.neonBranchId}`);
      requireRelease(branch?.id === config.neonBranchId && branch.project_id === config.neonProjectId, "neon_branch_mismatch");
      const { endpoints } = await neon(`/branches/${config.neonBranchId}/endpoints`);
      requireRelease(endpoints?.some(endpoint => endpoint.branch_id === config.neonBranchId && endpoint.host === new URL(config.databaseUrl).hostname && endpoint.type === "read_write"), "neon_endpoint_mismatch");
    },
    async snapshot(deploymentId, onCreated = () => {}) {
      const params = new URLSearchParams({ name: `tabdo-${deploymentId}-${Date.now()}`, expires_at: new Date(Date.now() + 7 * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z") });
      const created = await neon(`/branches/${config.neonBranchId}/snapshot?${params}`, "POST");
      const id = created.snapshot?.id;
      requireRelease(typeof id === "string" && /^[a-z0-9-]{1,80}$/.test(id), "snapshot_id_missing");
      onCreated(id);
      // Create can be asynchronous. Wait for its operations, then independently
      // read back a durable restore point from the project's snapshot list.
      requireRelease(Array.isArray(created.operations) && created.operations.length <= 20, "invalid_snapshot_operations");
      await Promise.all(created.operations.map(async operation => {
        requireRelease(/^[a-zA-Z0-9-]{1,80}$/.test(operation.id), "invalid_snapshot_operation");
        await poll(async () => (await neon(`/operations/${operation.id}`)).operation, value => {
          requireRelease(value?.status !== "failed" && value?.status !== "cancelled", "snapshot_operation_failed");
          return value?.status === "finished";
        }, pollOptions);
      }));
      await poll(async () => (await neon("/snapshots")).snapshots?.find(value => value.id === id), value => {
        if (!value) return false;
        requireRelease(value.source_branch_id === config.neonBranchId && value.lsn && value.timestamp && Date.parse(value.expires_at) > Date.now(), "snapshot_readback_mismatch");
        return true;
      }, pollOptions);
      return id;
    },
  };
}
