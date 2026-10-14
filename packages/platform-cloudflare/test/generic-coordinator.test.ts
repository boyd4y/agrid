import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestHarness } from "wrangler";

type Metadata = { tables: string[]; scopeRows: { scope_key: string }[]; kvCount: number; constructorMarker: string };
const headers = { authorization: "Bearer fixture-delivery-reader" };
const packet = (payload: string) => ({ category: "mailbox-packet", payload });
const query = (mailbox = "postbox-alpha", room = "generic-scope-probe") => new URLSearchParams({ mailbox, group: "morning-packets", room }).toString();
function packetFrames(text: string) {
  return text.split("\n\n").filter(frame => frame.startsWith("id: ")).map(frame => {
    const [id, data] = frame.split("\n");
    return { cursor: Number(id.slice(4)), packet: JSON.parse(data.slice(6)) };
  });
}

test("generic mailbox DO injects arbitrary reference/payload/state and keeps only reconstructable coordination metadata", { timeout: 45000 }, async () => {
  const server = createTestHarness({ workers: [{ configPath: new URL("./fixture/generic-coordinator/wrangler.jsonc", import.meta.url) }] });
  try {
    await server.listen();
    async function archive(mailbox: string, values: object) {
      assert.equal((await server.fetch(`/archive?${query(mailbox)}`, { method: "PUT", body: JSON.stringify({
        accessAllowed: true, complete: true, deliveryState: "archive-ready", packets: [], ...values,
      }) })).status, 204);
    }
    async function metadata(mailbox = "postbox-alpha", room = "generic-scope-probe") {
      return await (await server.fetch(`/metadata?${query(mailbox,room)}`)).json() as Metadata;
    }
    const packets = [packet("First packet"),packet("Second packet"),packet("Third packet"),packet("Fourth packet"),packet("Fifth packet")];
    await archive("postbox-alpha", { packets });
    await archive("postbox-beta", { packets: [packet("Different mailbox")], deliveryState: "delivery-pending" });
    await archive("unavailable-archive", { failReads: true });

    const denied = await server.fetch(`/stream?${query()}`, { headers: { authorization: "Bearer invalid-fixture-marker" } });
    assert.equal(denied.status, 401);
    assert.deepEqual((await metadata()).scopeRows, [], "failed credentials cannot reserve a scope");
    const failure = await server.fetch(`/stream?${query("unavailable-archive")}`, { headers });
    assert.equal(failure.status, 503);
    assert(!(await failure.text()).includes("Private archive provider failure"));
    assert.deepEqual((await metadata()).scopeRows, [], "a callback exception cannot reserve a scope");
    assert(!(await server.fetch(`/cancel?${query("postbox-beta","cancel-probe")}`, { method: "POST" })).ok);
    assert.deepEqual((await metadata("postbox-beta","cancel-probe")).scopeRows, [], "failed cancellation credentials cannot reserve a scope");
    assert.equal((await server.fetch(`/cancel-event?${query("postbox-beta")}`)).status, 404);

    const response = await server.fetch(`/stream?${query()}`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-mailbox-stream"), "packet-json-v3");
    assert.equal(response.headers.get("x-custom-delivery"), "archive");
    assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), null, "framework does not impose an AI protocol header");
    const text = await response.text();
    assert.deepEqual(packetFrames(text), packets.map((value,index) => ({ cursor: index+1, packet: value })));
    assert(text.endsWith("event: archive-complete\ndata: delivered\n\n"));
    assert(!text.includes("[DONE]"), "the caller controls its completion frame");
    const bound = await metadata();
    assert.deepEqual(bound.tables, ["coordination_scope"]);
    assert.deepEqual(bound.scopeRows, [{ scope_key: "mailbox:postbox-alpha" }]);
    assert.equal(bound.kvCount, 0, "DO KV does not mirror packets, state or cancellation");

    const opaque = await (await server.fetch(`/replay?${query()}`, { headers })).json() as { status: string; terminal: boolean; events: { chunk: unknown }[] };
    assert.equal(opaque.status, "archive-ready", "application state is opaque to the coordinator");
    assert.equal(opaque.terminal, true);
    assert.deepEqual(opaque.events[0].chunk, packets[0]);
    const resumed = await (await server.fetch(`/stream?${query()}`, { headers: { ...headers, "last-event-id": "2" } })).text();
    assert.deepEqual(packetFrames(resumed), packets.slice(2).map((value,index) => ({ cursor: index+3, packet: value })));
    const wrongScope = await server.fetch(`/stream?${query("postbox-beta")}`, { headers });
    assert.equal(wrongScope.status, 409, "a valid second mailbox cannot reuse a bound coordinator");
    const independent = await (await server.fetch(`/stream?${query("postbox-beta","independent-mailbox")}`, { headers })).text();
    assert.deepEqual(packetFrames(independent).map(frame => frame.packet), [packet("Different mailbox")]);
    assert.deepEqual((await metadata("postbox-beta","independent-mailbox")).scopeRows, [{ scope_key: "mailbox:postbox-beta" }]);

    assert.equal((await server.fetch(`/cancel?${query("postbox-beta","cancel-probe")}`, { method: "POST", headers })).status, 204);
    assert.deepEqual(await (await server.fetch(`/cancel-event?${query("postbox-beta")}`)).json(), {
      mailboxKey: "postbox-beta", packetGroup: "morning-packets", requested: true,
    }, "cancel port commits its injected application event before returning");
    assert.equal((await metadata("postbox-beta","cancel-probe")).kvCount, 0);

    assert.equal((await server.fetch(`/evict?${query()}`)).status, 204);
    const rebuilt = await metadata();
    assert.notEqual(rebuilt.constructorMarker, bound.constructorMarker, "ctx.abort caused a fresh DO constructor");
    assert.deepEqual(rebuilt.scopeRows, bound.scopeRows);
    assert.deepEqual(rebuilt.tables, ["coordination_scope"]);
    assert.equal(rebuilt.kvCount, 0);
    const updated = [packet("Archive changed independently")];
    await archive("postbox-alpha", { packets: updated, deliveryState: "delivery-pending" });
    const fresh = await (await server.fetch(`/replay?${query()}`, { headers })).json() as { status: string; events: { chunk: unknown }[] };
    assert.equal(fresh.status, "delivery-pending");
    assert.deepEqual(fresh.events.map(event => event.chunk), updated, "output/state are reloaded from the injected archive, not DO storage");

    await archive("postbox-alpha", { packets: [], complete: false });
    const revocable = await server.fetch(`/stream?${query()}`, { headers });
    await archive("postbox-alpha", { accessAllowed: false, packets: [], complete: false });
    const revoked = await revocable.text();
    assert.equal(revoked, "event: delivery-error\ndata: archive-unavailable\n\n", "a live subscription rechecks credentials and uses the caller's redacted error frame");
    assert.deepEqual((await metadata()).scopeRows, bound.scopeRows);
  } finally { await server.close(); }
});
