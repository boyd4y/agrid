import { createContainerExecutionObject, type ContainerExecutionCallbacks } from "../../../src/execution/container-object.js";
import { createCloudflareContainerExecution } from "../../../src/execution/container.js";
import type { ExecutionRequest, ExecutionResource } from "@tabdo/core/execution";

type Receipt = { reference: unknown; allow: boolean; prepareFails?: boolean; prepareDelayMs?: number; probe?: boolean; prepares?: number };
const key = (id: string) => `accepted/${id}`;
async function receipt(env: ContainerFixtureEnv, id: string) {
  return await (await env.ACCEPTED.get(key(id)))?.json<Receipt>();
}
const callbacks: ContainerExecutionCallbacks<ContainerFixtureEnv> = {
  async verifyAccepted(env, request) {
    const value = await receipt(env, request.id);
    if (!value?.allow || JSON.stringify(value.reference) !== JSON.stringify(request.reference)) throw new Error("Durable accepted receipt is absent");
  },
  async prepare(env, request) {
    const value = (await receipt(env, request.id))!;
    await env.ACCEPTED.put(key(request.id), JSON.stringify({ ...value, prepares: (value.prepares ?? 0) + 1 }));
    if (value.prepareDelayMs) await new Promise(resolve => setTimeout(resolve, value.prepareDelayMs));
    if (value.prepareFails) throw new Error("Secret fixture preparation failure");
    return { env: { LIMITED_CONTEXT: "fixture-capability" } };
  },
  async probe(env, resource, container) {
    if (!(await receipt(env, resource.id))?.probe) return undefined;
    const result = await readMarker(container, resource);
    return result?.active ? { resource, state: "running" } : undefined;
  },
};
const lifecycle = { startupTimeoutMs: 15000, inactivityTimeoutMs: 60000 };
const Base = createContainerExecutionObject<ContainerFixtureEnv>(() => ({
  imageKey: "runner", entrypoint: ["sleep", "infinity"], command: ["node", "/control/program.mjs"], enableInternet: false,
}), callbacks, lifecycle);
const BrokenBase = createContainerExecutionObject<ContainerFixtureEnv>(() => ({
  imageKey: "runner", entrypoint: ["sleep", "infinity"], command: ["/nonexistent-trusted-entry"], enableInternet: false,
}), callbacks, lifecycle);
const UnavailableBase = createContainerExecutionObject<ContainerFixtureEnv>(() => ({
  imageKey: "unavailable-trusted-image", entrypoint: ["sleep", "infinity"], command: ["node", "/control/program.mjs"], enableInternet: false,
}), callbacks, lifecycle);

export class InvalidProgramContainer extends BrokenBase {
  identity() { return this.ctx.id.toString(); }
  async clean() { await this.ctx.container?.destroy(); }
}
export class UnavailableImageContainer extends UnavailableBase {
  identity() { return this.ctx.id.toString(); }
  async clean() { await this.ctx.container?.destroy(); }
}

async function readMarker(container: Container, resource: ExecutionResource) {
  const [_objectId, token, pid] = resource.reference.split("/");
  const process = await container.exec(["node", "/control/probe.mjs", token, pid], { stdout: "pipe", stderr: "ignore" });
  const output = await process.output();
  if (output.exitCode !== 0 || output.stdout.byteLength > 4096) return undefined;
  return JSON.parse(new TextDecoder().decode(output.stdout)) as { active: boolean; count: number; limitedEnvironment: string };
}

export class ControlledContainer extends Base {
  #constructorMarker = crypto.randomUUID();
  metadata() {
    return { constructorMarker: this.#constructorMarker, objectId: this.ctx.id.toString(), running: this.ctx.container?.running,
      tables: this.ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE '__miniflare_%'").toArray().map(item => item.name),
      rows: this.ctx.storage.sql.exec("SELECT * FROM execution_resource").toArray() };
  }
  async marker(id: string) {
    const snapshot = await this.lookupExecution(id);
    if (!snapshot || !this.ctx.container?.running) return undefined;
    return readMarker(this.ctx.container, snapshot.resource);
  }
  async destroyCompute() { await this.ctx.container?.destroy(); }
  evict() { this.ctx.abort("Intentional container-control fixture eviction"); }
  async clean() { await this.ctx.container?.destroy(); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), id = url.searchParams.get("id") ?? "";
    if (!/^[a-z0-9-]{1,100}$/.test(id)) return new Response("Invalid fixture id", { status: 400 });
    const stub = env.EXECUTIONS.getByName(url.searchParams.get("room") ?? id);
    if (url.pathname.startsWith("/unavailable-")) {
      const unavailable = env.UNAVAILABLE_EXECUTIONS.getByName(id);
      if (url.pathname === "/unavailable-identity") return Response.json({ objectId: await unavailable.identity() });
      if (url.pathname === "/unavailable-clean") { await unavailable.clean();return new Response(null,{ status: 204 }); }
      try {
        if (url.pathname === "/unavailable-start") return Response.json(await unavailable.startExecution({ id,reference: (await request.json<ExecutionRequest>()).reference }));
        return Response.json(await unavailable.lookupExecution(id));
      } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unavailable fixture launch failed" },{ status: 409 }); }
    }
    if (url.pathname.startsWith("/broken-")) {
      const broken = env.INVALID_EXECUTIONS.getByName(id);
      if (url.pathname === "/broken-identity") return Response.json({ objectId: await broken.identity() });
      if (url.pathname === "/broken-clean") { await broken.clean();return new Response(null,{ status: 204 }); }
      try {
        if (url.pathname === "/broken-start") return Response.json(await broken.startExecution({ id,reference: (await request.json<ExecutionRequest>()).reference }));
        return Response.json(await broken.lookupExecution(id));
      } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Broken fixture launch failed" },{ status: 409 }); }
    }
    if (url.pathname === "/receipt") {
      if (request.method === "PUT") { await env.ACCEPTED.put(key(id), await request.text());return new Response(null, { status: 204 }); }
      return Response.json(await receipt(env,id));
    }
    if (url.pathname === "/metadata") return Response.json(await stub.metadata());
    if (url.pathname === "/marker") return Response.json(await stub.marker(id) ?? null);
    if (url.pathname === "/evict") { try { await stub.evict(); } catch { /* ctx.abort intentionally disconnects this RPC. */ }return new Response(null, { status: 204 }); }
    if (url.pathname === "/destroy-compute") { await stub.destroyCompute();return new Response(null, { status: 204 }); }
    if (url.pathname === "/clean") { await stub.clean();return new Response(null, { status: 204 }); }
    const adapter = createCloudflareContainerExecution({ resolve: () => stub, pollIntervalMs: 100 });
    try {
      if (url.pathname === "/start") {
        const handle = await adapter.start({ id, reference: (await request.json<ExecutionRequest>()).reference });
        return Response.json(handle.resource);
      }
      if (url.pathname === "/lookup") return Response.json(await stub.lookupExecution(id) ?? null);
      if (url.pathname === "/terminate") return Response.json(await stub.terminateExecution(id) ?? null);
      if (url.pathname === "/completion") {
        const handle = await adapter.lookup(id);
        return Response.json(handle ? await handle.completion : null);
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Control failed" }, { status: 409 });
    } finally { await adapter.close(); }
  },
} satisfies ExportedHandler<ContainerFixtureEnv>;
