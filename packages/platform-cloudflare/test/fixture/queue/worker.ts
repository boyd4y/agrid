// Isolated local test fixture, not a public platform entry point.
import { parseQueueMessage } from "@tabdo/core/queue";
import { createCloudflarePublisher, consumeQueueBatch } from "@tabdo/platform-cloudflare/queue";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/publish" && request.method === "POST") {
      try { await createCloudflarePublisher(env.JOBS).publish(parseQueueMessage(await request.json())); }
      catch { return new Response("Invalid queue message", { status: 400 }); }
      return new Response(null, { status: 202 });
    }
    const receipt = await env.RECEIPTS.get(`receipt/${url.searchParams.get("id")}`);
    return receipt ? new Response(receipt.body) : new Response(null, { status: 404 });
  },
  async queue(batch, env) {
    await consumeQueueBatch(batch, async (message, attempt) => {
      if (await env.RECEIPTS.get(`fail-once/${message.id}`)) {
        await env.RECEIPTS.delete(`fail-once/${message.id}`);
        throw new Error("Fixture acceptance failed before receipt persisted");
      }
      await env.RECEIPTS.put(`receipt/${message.id}`, JSON.stringify({ message, attempt }));
    });
  },
} satisfies ExportedHandler<QueueTestEnv>;
