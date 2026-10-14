import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createTestHarness } from "wrangler";

type Metadata = { objectId: string; constructorMarker: string; running: boolean; tables: string[];
  rows: { resource_id: string; launch_token: string; phase: string; pid: number | null; reference_hash: string }[] };
type Snapshot = { resource: { id: string; provider: string; reference: string }; state: string; exit?: { code: number | null; signal: string | null } };

test("real DO Container adapter acknowledges compute, isolates identity and refuses unknown cold-launch replay", { timeout: 240000 }, async () => {
  const fixture = new URL("../fixture/container-execution/", import.meta.url);
  const server = createTestHarness({ root: fileURLToPath(fixture), workers: [{ config: JSON.parse(await readFile(new URL("wrangler.jsonc",fixture),"utf8")) }] });
  const prefix = `control-${randomUUID()}`;
  const ids = ["normal","cold","failed","racing","isolated","probe","broken","unavailable"].map(suffix => `${prefix}-${suffix}`);
  const objectIds = new Set<string>();
  const reference = { mailboxKey: "accepted-mailbox" };
  function path(route: string, id: string, room?: string) { return `${route}?${new URLSearchParams({ id, ...(room ? { room } : {}) })}`; }
  async function fetchJson<T>(route: string,id: string, room?: string) {
    const response = await server.fetch(path(route,id,room));
    assert.equal(response.status,200,await response.clone().text());return await response.json() as T;
  }
  async function metadata(id: string) {
    const value = await fetchJson<Metadata>("/metadata",id);objectIds.add(value.objectId);return value;
  }
  async function accepted(id: string, extra = {}) {
    assert.equal((await server.fetch(path("/receipt",id), { method: "PUT", body: JSON.stringify({ reference, allow: true, ...extra }) })).status,204);
  }
  function start(id: string, ref: unknown = reference, room?: string) {
    return server.fetch(path("/start",id,room), { method: "POST", body: JSON.stringify({ reference: ref }) });
  }
  async function marker(id: string) {
    for (let index = 0;index < 20;index++) {
      const result = await fetchJson<{ count: number; active: boolean; limitedEnvironment: string } | null>("/marker",id);
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve,50));
    }
    assert.fail(`Finite program did not produce its marker: ${JSON.stringify(await metadata(id))}`);
  }
  try {
    await server.listen();
    const [normal,cold,failed,racing,isolated,probe,broken,unavailable] = ids;
    const denied = await start(normal);
    assert.equal(denied.status,409);
    const pristine = await metadata(normal);
    assert.deepEqual(pristine.rows,[]);assert.equal(pristine.running,false);
    await accepted(normal);
    const started = await start(normal);
    assert.equal(started.status,200,await started.clone().text());
    const resource = await started.json() as Snapshot["resource"];
    assert.equal(resource.provider,"cloudflare-container");assert.equal(resource.id,normal);
    assert.equal((await fetchJson<Snapshot>("/lookup",normal)).state,"running");
    const firstMarker = await marker(normal);
    assert.equal(firstMarker.count,1);assert(firstMarker.active);assert.equal(firstMarker.limitedEnvironment,"fixture-capability","exec receives only explicitly injected execution credentials");
    assert.equal((await start(normal)).status,200);
    assert.equal((await marker(normal)).count,1,"duplicate start cannot execute the program twice");
    const changed = await start(normal,{ mailboxKey: "different-accepted-mailbox" });
    assert.equal(changed.status,409);
    await accepted(isolated);
    const wrongRoom = await start(isolated,reference,normal);
    assert.equal(wrongRoom.status,409,"another accepted id cannot adopt a container already bound to an id");
    assert.equal((await metadata(normal)).rows[0].resource_id,normal);
    const independent = await start(isolated);
    assert.equal(independent.status,200,await independent.clone().text());
    assert.notEqual((await independent.json() as Snapshot["resource"]).reference,resource.reference);
    await metadata(isolated);
    const ended = await fetchJson<{ code: number | null; signal: string | null }>("/completion",normal);
    assert.deepEqual(ended,{ code: 0,signal: null },"actual ExecProcess completion is observed without waiting in start");
    const terminated = await fetchJson<Snapshot>("/terminate",isolated);
    assert.equal(terminated.state,"exited");assert.equal((await metadata(isolated)).running,false);

    await accepted(cold);
    const coldStart = await start(cold);
    assert.equal(coldStart.status,200,await coldStart.clone().text());
    await marker(cold);
    const beforeCold = await metadata(cold);
    assert.equal((await server.fetch(path("/evict",cold))).status,204);
    const rebuilt = await metadata(cold);
    assert.notEqual(rebuilt.constructorMarker,beforeCold.constructorMarker,"ctx.abort rebuilt the actual durable object");
    assert.equal(rebuilt.rows[0].launch_token,beforeCold.rows[0].launch_token);
    assert.deepEqual(rebuilt.tables,["execution_resource"]);
    assert.equal((await fetchJson<Snapshot>("/lookup",cold)).state,"unknown","PID metadata alone is never treated as a live process handle");
    assert.equal((await start(cold)).status,409,"unknown start must not blindly replay accepted work");
    assert.equal((await fetchJson<{ prepares: number }>("/receipt",cold)).prepares,1);
    assert.equal((await server.fetch(path("/destroy-compute",cold))).status,204);
    assert.equal((await server.fetch(path("/evict",cold))).status,204);
    assert.equal((await metadata(cold)).running,false);
    assert.equal((await start(cold)).status,409,"destroyed compute does not erase the persistent launch fence");
    assert.equal((await metadata(cold)).rows[0].launch_token,beforeCold.rows[0].launch_token);
    assert.equal((await fetchJson<{ prepares: number }>("/receipt",cold)).prepares,1);

    await accepted(failed,{ prepareFails: true });
    const prepareFailed = await start(failed);
    assert.equal(prepareFailed.status,409);assert(!(await prepareFailed.text()).includes("Secret fixture"));
    assert.equal((await fetchJson<Snapshot>("/lookup",failed)).state,"unknown");
    assert.equal((await start(failed)).status,409);assert.equal((await metadata(failed)).running,false);
    assert.equal((await fetchJson<{ prepares: number }>("/receipt",failed)).prepares,1,"accepted preparation failure is fenced before retry");

    await accepted(racing,{ prepareDelayMs: 500 });
    const pending = start(racing);
    for (let index = 0;index < 30;index++) {
      if ((await metadata(racing)).rows.length) break;
      await new Promise(resolve => setTimeout(resolve,20));
    }
    assert.equal((await fetchJson<Snapshot>("/terminate",racing)).state,"exited");
    assert.equal((await pending).status,200);
    assert.equal((await metadata(racing)).running,false,"termination during preparation cannot be followed by a late container start");
    assert.equal((await fetchJson<Snapshot>("/lookup",racing)).state,"exited");

    await accepted(probe,{ probe: true });
    assert.equal((await start(probe)).status,200);
    await marker(probe);
    const probeBefore = await metadata(probe);
    assert.equal((await server.fetch(path("/evict",probe))).status,204);
    const probeAfter = await metadata(probe);
    assert.notEqual(probeAfter.constructorMarker,probeBefore.constructorMarker);
    assert(probeAfter.running,"fixture container survives eviction so the real readonly reconciliation callback is exercised");
    assert.equal((await fetchJson<Snapshot>("/lookup",probe)).state,"running","only an explicit token-bound readonly probe recovers cold resource liveness");
    assert.equal((await start(probe)).status,200);
    assert.equal((await marker(probe)).count,1);
    assert.equal((await fetchJson<{ prepares: number }>("/receipt",probe)).prepares,1);

    await accepted(broken);
    objectIds.add((await fetchJson<{ objectId: string }>("/broken-identity",broken)).objectId);
    const brokenStart = await server.fetch(path("/broken-start",broken),{ method: "POST",body: JSON.stringify({ reference }) });
    assert.equal(brokenStart.status,200,await brokenStart.clone().text());
    let invalidExit = await fetchJson<Snapshot>("/broken-lookup",broken);
    for (let index = 0;index < 30 && invalidExit.state !== "exited";index++) {
      await new Promise(resolve => setTimeout(resolve,100));invalidExit = await fetchJson<Snapshot>("/broken-lookup",broken);
    }
    assert.equal(invalidExit.state,"exited");assert.notEqual(invalidExit.exit!.code,0,"spawn ACK is not proof that the application runner program succeeded");
    assert.equal((await server.fetch(path("/broken-start",broken),{ method: "POST",body: JSON.stringify({ reference }) })).status,200);
    assert.equal((await fetchJson<{ prepares: number }>("/receipt",broken)).prepares,1,"a failed program cannot replay accepted work");

    await accepted(unavailable);
    objectIds.add((await fetchJson<{ objectId: string }>("/unavailable-identity",unavailable)).objectId);
    const unavailableStart = await server.fetch(path("/unavailable-start",unavailable),{ method: "POST",body: JSON.stringify({ reference }) });
    assert.equal(unavailableStart.status,409,await unavailableStart.clone().text());
    assert.equal((await fetchJson<Snapshot>("/unavailable-lookup",unavailable)).state,"unknown");
    assert.equal((await server.fetch(path("/unavailable-start",unavailable),{ method: "POST",body: JSON.stringify({ reference }) })).status,200);
    assert.equal((await fetchJson<{ prepares: number }>("/receipt",unavailable)).prepares,1,"a failed trusted provider configuration cannot blindly replay accepted work");
  } finally {
    for (const id of ids) await server.fetch(path("/clean",id)).catch(() => {});
    await server.fetch(path("/broken-clean",ids[6])).catch(() => {});
    await server.fetch(path("/unavailable-clean",ids[7])).catch(() => {});
    await server.close();
    for (const objectId of objectIds) {
      if (!/^[a-f0-9]{64}$/.test(objectId)) continue;
      for (const className of ["ControlledContainer","InvalidProgramContainer","UnavailableImageContainer"]) {
        const owned = execFileSync("docker",["ps","-aq","--filter",`name=workerd-generic-container-control-fixture-${className}-${objectId}`],{ encoding: "utf8" }).trim().split(/\s+/).filter(id => /^[a-f0-9]{12,64}$/.test(id));
        if (owned.length) execFileSync("docker",["rm","-f",...owned],{ stdio: "ignore" });
      }
    }
  }
});
