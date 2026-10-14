// Local contract fixture only. This is not a public Tabdo deployment entry point.
import { createR2Storage } from "../../src/storage.js";
import { createAutomationPublisher, acceptAutomationBatch } from "../../src/queue.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/deliver" && request.method === "POST") {
      try { await createAutomationPublisher(env.AUTOMATION).publish(await request.json()); }
      catch { return new Response("Invalid automation delivery", { status: 400 }); }
      return new Response(null, { status: 202 });
    }
    const store = createR2Storage(env.OBJECTS);
    const key = decodeURIComponent(url.pathname.slice(1));
    try {
      if (request.method === "PUT") {
        await store.put(key, new Uint8Array(await request.arrayBuffer()), request.headers.get("content-type") ?? "application/octet-stream");
        return new Response(null, { status: 201 });
      }
      if (request.method === "DELETE") { await store.remove(key); return new Response(null, { status: 204 }); }
      return new Response(await store.open(key));
    } catch (error) {
      return new Response(error instanceof Error ? error.message : "Storage failure", { status: error instanceof Error && error.message === "Object not found" ? 404 : 400 });
    }
  },
  async queue(batch, env) {
    await acceptAutomationBatch(batch, async (delivery, attempt) => {
      const failKey = `fail-once/${delivery.eventId}`;
      if (await env.OBJECTS.get(failKey)) {
        await env.OBJECTS.delete(failKey);
        throw new Error("Fixture acceptance failed before receipt persisted");
      }
      const key = `${delivery.eventId.slice(0, 2)}/${delivery.eventId}`;
      await createR2Storage(env.OBJECTS).put(key, new TextEncoder().encode(JSON.stringify({ delivery, attempt })), "application/json");
    });
  },
} satisfies ExportedHandler<Env>;
