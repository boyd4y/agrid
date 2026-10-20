import { requireRelease, ReleaseError, checkRuntimeVariables } from "./guards.mjs";

const deploymentFields = "id status projectId environmentId serviceId";
const terminalFailures = new Set(["FAILED", "CRASHED", "REMOVED", "SKIPPED", "CANCELED", "SLEEPING"]);
const pendingStatuses = new Set(["INITIALIZING", "BUILDING", "DEPLOYING", "WAITING", "QUEUED"]);

// Bounded reads only. Never retry mutations: a lost response can still mean the
// platform accepted the deployment/snapshot. Report that uncertainty instead.
export async function poll(read, ready, { attempts = 60, intervalMs = 5000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await read();
    if (ready(value)) return value;
    if (attempt + 1 < attempts) await sleep(intervalMs);
  }
  throw new ReleaseError("platform_wait_timeout_outcome_unknown");
}

export function createPlatforms(env, config, fetcher = fetch, pollOptions = {}) {
  async function request(url, options, code) {
    try {
      const response = await fetcher(url, { ...options, redirect: options?.redirect || "error", signal: AbortSignal.timeout(30000) });
      requireRelease(response.ok, code);
      return response;
    } catch { throw new ReleaseError(code); }
  }
  async function railway(query, variables = {}) {
    const response = await request("https://backboard.railway.com/graphql/v2", {
      method: "POST", headers: { "Content-Type": "application/json", "Project-Access-Token": env.RAILWAY_API_TOKEN }, body: JSON.stringify({ query, variables }),
    }, "railway_request_failed_check_environment_token_permissions");
    const body = await response.json();
    requireRelease(!body.errors?.length && body.data, "railway_graphql_failed_check_environment_token_permissions");
    return body.data;
  }
  async function instance(serviceId) {
    const data = await railway(`query Instance($serviceId: String!, $environmentId: String!) {
      serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
        serviceId environmentId service { projectId } source { repo image }
        startCommand healthcheckPath railwayConfigFile rootDirectory
        activeDeployments { ${deploymentFields} }
        latestDeployment { ${deploymentFields} }
      }
    }`, { serviceId, environmentId: config.environmentId });
    return data.serviceInstance;
  }
  async function deployment(id) {
    const data = await railway(`query Deployment($id: String!) { deployment(id: $id) { ${deploymentFields} } }`, { id });
    return data.deployment;
  }
  function checkDeployment(value, serviceId, id) {
    requireRelease(value?.id === id && value.projectId === config.projectId && value.environmentId === config.environmentId && value.serviceId === serviceId, "deployment_target_mismatch");
  }

  return {
    async preflight() {
      const { projectToken } = await railway("query Token { projectToken { projectId environmentId } }");
      requireRelease(projectToken?.projectId === config.projectId && projectToken.environmentId === config.environmentId, "railway_token_scope_mismatch");
      const { environment } = await railway("query Environment($id: String!) { environment(id: $id) { id projectId deploymentTriggers { edges { node { serviceId } } pageInfo { hasNextPage } } } }", { id: config.environmentId });
      requireRelease(environment?.id === config.environmentId && environment.projectId === config.projectId, "railway_environment_target_mismatch");
      requireRelease(environment.deploymentTriggers?.pageInfo.hasNextPage === false && !environment.deploymentTriggers.edges.some(({ node }) => !node.serviceId || config.services.includes(node.serviceId)), "disable_existing_github_autodeploy_before_bootstrap");
      const previous = [];
      let databaseUrl;
      for (const [index, serviceId] of config.services.entries()) {
        const value = await instance(serviceId);
        requireRelease(value?.serviceId === serviceId && value.environmentId === config.environmentId && value.service.projectId === config.projectId, "service_target_mismatch");
        requireRelease(!value.source?.repo && !value.source?.image, "disconnect_existing_deployment_source");
        requireRelease(value.railwayConfigFile?.replace(/^\//, "") === (index === 0 ? "railway.api.json" : "railway.worker.json"), "service_config_file_mismatch");
        requireRelease(!value.rootDirectory || value.rootDirectory === "/", "service_root_directory_mismatch");
        requireRelease(value.startCommand === (index === 0 ? "node dist/index.js" : "node dist/queue/main.js"), "service_start_command_mismatch");
        requireRelease(index !== 0 || value.healthcheckPath === "/api/health", "api_healthcheck_required");
        requireRelease(value.activeDeployments.length === 1 && value.activeDeployments[0].status === "SUCCESS" && value.latestDeployment?.id === value.activeDeployments[0].id, "stable_service_required_no_pending_deployments");
        const data = await railway("query Variables($projectId: String!, $environmentId: String!, $serviceId: String!) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }", { projectId: config.projectId, environmentId: config.environmentId, serviceId });
        const values = data.variables;
        if (index === 0) {
          databaseUrl = values.DATABASE_URL_UNPOOLED;
          requireRelease(values.RELEASE_RAILWAY_PROJECT_ID === config.projectId && values.RELEASE_RAILWAY_ENVIRONMENT_ID === config.environmentId && values.RELEASE_RAILWAY_API_SERVICE_ID === serviceId, "predeploy_target_config_required");
          requireRelease(values.NEON_API_KEY && values.NEON_PROJECT_ID && values.NEON_BRANCH_ID, "predeploy_neon_config_required");
        }
        checkRuntimeVariables(values, { ...config, databaseUrl });
        requireRelease(!values.MIGRATION_ALLOW_ORPHAN_DELETE && !values.MIGRATION_ORPHAN_ORG_ID, "special_migration_plan_required");
        requireRelease(/^[a-zA-Z0-9-]{1,80}$/.test(value.activeDeployments[0].id), "invalid_previous_deployment_id");
        previous.push({ serviceId, deploymentId: value.activeDeployments[0].id });
      }
      return previous;
    },

    async wait(serviceId, id) {
      await poll(() => deployment(id), value => {
        checkDeployment(value, serviceId, id);
        requireRelease(!terminalFailures.has(value.status), "deployment_failed_manual_recovery_required");
        requireRelease(value.status === "SUCCESS" || pendingStatuses.has(value.status), "unknown_deployment_status");
        return value.status === "SUCCESS";
      }, pollOptions);
      const current = await instance(serviceId);
      requireRelease(!current.source?.repo && !current.source?.image && current.latestDeployment?.id === id && current.activeDeployments.some(value => value.id === id && value.status === "SUCCESS"), "active_deployment_mismatch");
    },

    async smoke() {
      const response = await request(`${config.publicUrl}/api/health`, {}, "public_health_failed");
      const value = await response.json();
      requireRelease(value.ok === true && value.service === "tabdo" && value.schema?.ok === true, "public_schema_health_failed");
      const features = await request(`${config.publicUrl}/api/public/auth-features`, {}, "public_readonly_smoke_failed");
      requireRelease(typeof (await features.json()).google === "boolean", "public_readonly_smoke_failed");
      const frontend = await request(config.publicUrl, {}, "public_frontend_smoke_failed");
      requireRelease(frontend.headers.get("content-type")?.includes("text/html") && (await frontend.text()).includes('<div id="root">'), "public_frontend_smoke_failed");
    },
  };
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
    async snapshot(version, onCreated = () => {}) {
      const params = new URLSearchParams({ name: `tabdo-${version}-${Date.now()}`, expires_at: new Date(Date.now() + 7 * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z") });
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
