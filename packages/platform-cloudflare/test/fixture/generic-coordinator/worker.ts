import { createSessionCoordinator } from "../../../src/coordination/coordinator.js";
import { CoordinationError, type AccessCredentials } from "../../../src/coordination/contracts.js";

type MailboxReference = Readonly<{ mailboxKey: string; packetGroup: string }>;
type Packet = Readonly<{ category: string; payload: string }>;
type DeliveryState = "archive-ready" | "delivery-pending";
type Archive = {
  accessAllowed: boolean;
  failReads?: boolean;
  packets: Packet[];
  complete: boolean;
  deliveryState: DeliveryState;
};

function parseMailbox(value: unknown): MailboxReference {
  if (!value || typeof value !== "object") throw new CoordinationError("Invalid mailbox reference", 400);
  const record = value as Record<string, unknown>;
  if (typeof record.mailboxKey !== "string" || !/^[a-z0-9-]{1,80}$/.test(record.mailboxKey)
    || typeof record.packetGroup !== "string" || !/^[a-z0-9-]{1,80}$/.test(record.packetGroup)) {
    throw new CoordinationError("Invalid mailbox reference", 400);
  }
  return { mailboxKey: record.mailboxKey, packetGroup: record.packetGroup };
}

const archiveKey = (reference: MailboxReference) => `archives/${reference.mailboxKey}/${reference.packetGroup}.json`;
const cancelKey = (reference: MailboxReference) => `cancel-events/${reference.mailboxKey}/${reference.packetGroup}.json`;
async function authorizedArchive(env: MailboxCoordinatorEnv, reference: MailboxReference, credentials: AccessCredentials): Promise<Archive> {
  // This isolated fixture marker is not a production authentication provider or secret.
  if (credentials.authorization !== "Bearer fixture-delivery-reader") throw new CoordinationError("Mailbox access denied", 401);
  const object = await env.PACKET_ARCHIVE.get(archiveKey(reference));
  if (!object) throw new CoordinationError("Mailbox archive missing", 404);
  const archive = await object.json<Archive>();
  if (!archive.accessAllowed) throw new CoordinationError("Mailbox access denied", 403);
  return archive;
}

const BaseCoordinator = createSessionCoordinator<MailboxCoordinatorEnv, MailboxReference, Packet, DeliveryState>(env => ({
  async readOutput({ reference, after, limit, credentials }) {
    const archive = await authorizedArchive(env, reference, credentials);
    if (archive.failReads) throw new Error("Private archive provider failure must stay hidden");
    return {
      events: archive.packets.slice(after, after+limit).map((chunk, index) => ({ cursor: after+index+1, chunk })),
      terminal: archive.complete,
      status: archive.deliveryState,
    };
  },
  async cancel({ reference, credentials }) {
    await authorizedArchive(env, reference, credentials);
    // The event belongs to the injected application archive, not to the DO storage schema.
    await env.PACKET_ARCHIVE.put(cancelKey(reference), JSON.stringify({ mailboxKey: reference.mailboxKey, packetGroup: reference.packetGroup, requested: true }));
  },
}), {
  parseReference: parseMailbox,
  scopeKeyOf: reference => `mailbox:${reference.mailboxKey}`,
  referenceFromRequest(request) {
    const url = new URL(request.url);
    return { mailboxKey: url.searchParams.get("mailbox"), packetGroup: url.searchParams.get("group") };
  },
  headers: { "x-mailbox-stream": "packet-json-v3", "x-custom-delivery": "archive" },
  errorFrame: "event: delivery-error\ndata: archive-unavailable\n\n",
  endFrame: "event: archive-complete\ndata: delivered\n\n",
}, { pageSize: 2, pollIntervalMs: 25 });

export class MailboxCoordinator extends BaseCoordinator {
  #constructorMarker = crypto.randomUUID();
  async metadata() {
    const tables = this.ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").toArray()
      .map(row => row.name).filter(name => !name.startsWith("_") && !name.startsWith("sqlite_"));
    const scopeRows = this.ctx.storage.sql.exec<{ scope_key: string }>("SELECT scope_key FROM coordination_scope").toArray();
    return { tables, scopeRows, kvCount: (await this.ctx.storage.list()).size, constructorMarker: this.#constructorMarker };
  }
  evict(): void { this.ctx.abort("Reconstruct generic coordinator"); }
}

export default {
  async fetch(request: Request, env: MailboxCoordinatorEnv): Promise<Response> {
    const url = new URL(request.url);
    const reference = parseMailbox({ mailboxKey: url.searchParams.get("mailbox"), packetGroup: url.searchParams.get("group") });
    // Fixture-only administrative routes prepare the independent authoritative archive.
    if (url.pathname === "/archive" && request.method === "PUT") {
      await env.PACKET_ARCHIVE.put(archiveKey(reference), await request.text());
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/cancel-event") {
      const event = await env.PACKET_ARCHIVE.get(cancelKey(reference));
      return event ? new Response(event.body, { headers: { "content-type": "application/json" } }) : new Response(null, { status: 404 });
    }
    const coordinator = env.MAILBOX_COORDINATORS.getByName(url.searchParams.get("room") ?? `mailbox:${reference.mailboxKey}`);
    if (url.pathname === "/metadata") return Response.json(await coordinator.metadata());
    if (url.pathname === "/evict") {
      try { await coordinator.evict(); } catch { /* Expected abort drops this RPC. */ }
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/stream") return coordinator.fetch(request);
    const credentials = { authorization: request.headers.get("authorization") ?? undefined };
    try {
      if (url.pathname === "/replay") return Response.json(await coordinator.replay({ reference, after: Number(url.searchParams.get("after") ?? 0), limit: 2, credentials }));
      if (url.pathname === "/cancel") {
        await coordinator.cancel({ reference, credentials });
        return new Response(null, { status: 204 });
      }
    } catch { return new Response(null, { status: 409 }); }
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<MailboxCoordinatorEnv>;
