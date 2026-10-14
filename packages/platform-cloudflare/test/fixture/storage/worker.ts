// Isolated local test fixture, not a public platform entry point.
import { createR2Storage } from "@tabdo/platform-cloudflare/storage/r2";

export default {
  async fetch(request, env) {
    const store = createR2Storage(env.OBJECTS);
    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
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
} satisfies ExportedHandler<StorageTestEnv>;
