import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createPlatforms, poll } from "../release/platforms.mjs";

const sha = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const image = `ghcr.io/boyd4y/agrid@${digest}`;
const config = { projectId: "project", environmentId: "production", services: ["api", "worker"], neonProjectId: "neon", neonBranchId: "branch", publicUrl: "https://tabdo.example", databaseUrl: "postgresql://owner:secret@ep-demo.eu-central-1.aws.neon.tech/db?sslmode=require" };
const env = { RAILWAY_API_TOKEN: "project-secret", NEON_API_KEY: "neon-secret" };
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const hash = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fast = { attempts: 3, intervalMs: 0 };

test("anonymous OCI pull follows a legitimate 307 to HTTPS CDN, strips auth across origins and hashes final bytes", async () => {
  const blob = Buffer.from(JSON.stringify({ os: "linux", architecture: "amd64", config: { Labels: { "org.opencontainers.image.revision": sha } } }));
  const manifest = Buffer.from(JSON.stringify({ config: { digest: hash(blob) } }));
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    assert(!JSON.stringify(options).includes(env.RAILWAY_API_TOKEN));
    if (url.includes("/token?")) { assert(!options.headers); return json({ token: "anonymous-pull-token" }); }
    if (url.includes("/manifests/")) return new Response(null, { status: 307, headers: { location: "https://cdn.example/manifest" } });
    if (url === "https://cdn.example/manifest") { assert.equal(options.headers.Authorization, undefined); return new Response(manifest); }
    if (url.includes("/blobs/")) return new Response(null, { status: 307, headers: { location: "https://cdn.example/config" } });
    assert.equal(url, "https://cdn.example/config");
    assert.equal(options.headers.Authorization, undefined);
    return new Response(blob);
  };
  await createPlatforms(env, config, fetcher).anonymousImage(`ghcr.io/boyd4y/agrid@${hash(manifest)}`, sha);
  assert.equal(calls.length, 5);
  assert.equal(calls[1].options.headers.Authorization, "Bearer anonymous-pull-token");
});

test("OCI pull rejects private packages, bad digests/commit, unsafe and unbounded redirects", async () => {
  for (const mode of ["private", "http", "credentials", "loop", "manifest-corrupt", "blob-corrupt", "wrong-commit"]) {
    const blob = Buffer.from(JSON.stringify({ os: "linux", architecture: "amd64", config: { Labels: { "org.opencontainers.image.revision": mode === "wrong-commit" ? "c".repeat(40) : sha } } }));
    const manifest = Buffer.from(JSON.stringify({ config: { digest: hash(blob) } }));
    let requests = 0;
    const fetcher = async url => {
      requests++;
      if (url.includes("/token?")) return mode === "private" ? new Response(null, { status: 403 }) : json({ token: "anonymous" });
      if (["http", "credentials", "loop"].includes(mode)) return new Response(null, { status: 307, headers: { location: mode === "http" ? "http://cdn.example/config" : mode === "credentials" ? "https://user:password@cdn.example/config" : url } });
      if (url.includes("/manifests/")) return new Response(mode === "manifest-corrupt" ? "{}" : manifest);
      return new Response(mode === "blob-corrupt" ? "{}" : blob);
    };
    await assert.rejects(() => createPlatforms(env, config, fetcher).anonymousImage(`ghcr.io/boyd4y/agrid@${hash(manifest)}`, sha));
    assert(requests <= 7);
  }
});

function fixture(overrides = {}) {
  const calls = [];
  let source = "old-image";
  let pollIndex = 0;
  let snapshotReads = 0;
  let operationReads = 0;
  const deploy = (id = "new-api", status = "SUCCESS", target = {}) => ({ id, status, projectId: "project", environmentId: "production", serviceId: "api", meta: { image: source }, ...target });
  function instance(serviceId) {
    return {
      serviceId, environmentId: "production", service: { projectId: "project" }, source: { image: source, repo: null }, preDeployCommand: [],
      startCommand: serviceId === "api" ? "node dist/index.js" : "node dist/queue/main.js", healthcheckPath: "/api/health",
      activeDeployments: [deploy(`old-${serviceId}`, "SUCCESS", { serviceId })], latestDeployment: { id: `old-${serviceId}` }, ...overrides.instance,
    };
  }
  const variables = { NODE_ENV: "production", TABDO_ENV: "production", AUTH_REQUIRED: "true", QUEUE_PREFIX: "tabdo-production", DATABASE_URL: config.databaseUrl, DATABASE_URL_UNPOOLED: config.databaseUrl, APP_URL: config.publicUrl, BETTER_AUTH_URL: config.publicUrl, ...overrides.variables };
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("backboard.railway.com")) {
      assert.equal(options.headers["Project-Access-Token"], "project-secret");
      assert(!options.headers.Authorization);
      assert.equal(options.redirect, "error");
      const { query, variables: args } = JSON.parse(options.body);
      if (overrides.graphqlError) return json({ errors: [{ message: "database postgres://private-secret" }] });
      if (query.startsWith("query Token")) return json({ data: { projectToken: { projectId: "project", environmentId: overrides.tokenEnvironment || "production" } } });
      if (query.startsWith("query Environment")) return json({ data: { environment: { id: "production", projectId: "project", deploymentTriggers: { edges: overrides.trigger ? [{ node: { serviceId: "api" } }] : [], pageInfo: { hasNextPage: false } } } } });
      if (query.startsWith("query Instance")) {
        const value = instance(args.serviceId);
        if (source === image && overrides.active !== false) value.activeDeployments = [deploy("new-api")];
        return json({ data: { serviceInstance: value } });
      }
      if (query.startsWith("query Variables")) return json({ data: { variables } });
      if (query.startsWith("mutation Source")) { source = args.input.source.image; assert.deepEqual(args.input.preDeployCommand, []); return json({ data: { serviceInstanceUpdate: true } }); }
      if (query.startsWith("mutation Deploy")) return json({ data: { serviceInstanceDeployV2: "new-api" } });
      if (query.startsWith("query Deployment")) return json({ data: { deployment: deploy("new-api", (overrides.statuses || ["SUCCESS"])[pollIndex++] || "SUCCESS", overrides.deployment) } });
      assert.fail(query);
    }
    if (url.includes("console.neon.tech")) {
      assert.equal(options.headers.Authorization, "Bearer neon-secret");
      assert.equal(options.redirect, "error");
      if (url.endsWith("/endpoints")) return json({ endpoints: [{ branch_id: "branch", type: "read_write", host: overrides.endpoint || new URL(config.databaseUrl).hostname }] });
      if (url.endsWith("/branches/branch")) return json({ branch: { id: "branch", project_id: "neon" } });
      if (url.includes("/snapshot?")) { assert.equal(options.method, "POST"); return json({ snapshot: { id: "snap-1" }, operations: [{ id: "op-1" }] }); }
      if (url.includes("/operations/")) return json({ operation: { status: operationReads++ ? "finished" : "running" } });
      if (url.endsWith("/snapshots")) return json({ snapshots: snapshotReads++ ? [{ id: "snap-1", source_branch_id: overrides.snapshotBranch || "branch", lsn: "0/1234", timestamp: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() }] : [] });
      assert.fail(url);
    }
    if (url.endsWith("/api/health")) return json({ ok: true, service: "tabdo", schema: { ok: overrides.schemaOk ?? true } });
    if (url.endsWith("/api/public/auth-features")) return json({ google: false });
    return new Response('<html><div id="root"></div></html>', { headers: { "content-type": "text/html" } });
  };
  return { calls, platforms: createPlatforms(env, config, fetcher, fast) };
}

test("production preflight uses only environment project token and verifies runtime and Neon targets", async () => {
  const f = fixture();
  assert.deepEqual(await f.platforms.preflight(), [{ serviceId: "api", deploymentId: "old-api" }, { serviceId: "worker", deploymentId: "old-worker" }]);
  assert(f.calls.every(c => c.options.method !== "POST" || c.url.includes("railway")), "no Neon writes in preflight");
  for (const override of [{ tokenEnvironment: "staging" }, { trigger: true }, { endpoint: "ep-other.neon.tech" }, { variables: { DATABASE_URL: config.databaseUrl.replace("/db?", "/other?") } }, { instance: { source: { repo: "boyd4y/agrid" } } }, { instance: { preDeployCommand: ["node dist/db/migrate.js"] } }, { instance: { activeDeployments: [] } }]) await assert.rejects(() => fixture(override).platforms.preflight());
});

test("snapshot create waits for operations and independently reads back exact branch restore point", async () => {
  const f = fixture();
  assert.equal(await f.platforms.snapshot("v1.2.3"), "snap-1");
  assert.equal(f.calls.filter(c => c.options.method === "POST").length, 1);
  await assert.rejects(() => fixture({ snapshotBranch: "wrong" }).platforms.snapshot("v1.2.3"), /snapshot_readback_mismatch/);
});

test("deployment tracks returned ID through QUEUED/PENDING/SUCCESS and checks actual image plus target", async () => {
  const f = fixture({ statuses: ["QUEUED", "PENDING", "SUCCESS"] });
  const id = await f.platforms.deploy("api", image);
  assert.equal(id, "new-api");
  await f.platforms.wait("api", id, image);
  for (const override of [{ deployment: { meta: { image: image.replace(digest, `sha256:${"c".repeat(64)}`) } } }, { deployment: { serviceId: "worker" } }, { statuses: ["FAILED"] }, { statuses: ["UNKNOWN"] }, { active: false }]) {
    const p = fixture(override).platforms;
    await p.deploy("api", image);
    await assert.rejects(() => p.wait("api", id, image));
  }
});

test("waiting is bounded; failed GraphQL never leaks raw error messages", async () => {
  let reads = 0;
  await assert.rejects(() => poll(async () => { reads++; return "QUEUED"; }, () => false, fast), /timeout_outcome_unknown/);
  assert.equal(reads, 3);
  await assert.rejects(() => fixture({ graphqlError: true }).platforms.preflight(), error => {
    assert.doesNotMatch(error.message, /private-secret|postgres:/); return true;
  });
});

test("read-only smoke requires healthy schema and valid auth-features/frontend responses", async () => {
  const f = fixture();
  await f.platforms.smoke();
  assert.equal(f.calls.length, 3);
  assert(f.calls.every(c => !c.options.method && !c.options.headers));
  await assert.rejects(() => fixture({ schemaOk: false }).platforms.smoke(), /schema_health/);
});
