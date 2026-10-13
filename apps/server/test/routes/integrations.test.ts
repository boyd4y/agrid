import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { Webhook } from "svix";
if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { auth } = await import("../../src/auth/index.js");
const { integrationsRoute } = await import("../../src/routes/integrations.js");
const { webhookEndpointsRoute, webhooksRoute } = await import("../../src/routes/webhooks.js");
const { encryptSecret, decryptSecret } = await import("../../src/integrations/secrets.js");
const { hydrateAgentMailEvent } = await import("../../src/integrations/agentmail.js");
const { eventBindingContext, eventConditionsMatch } = await import("../../src/automation/events.js");
const { organization, user, member, session, integrationConnections, webhookEndpoints, integrationDeliveries, automations, automationEvents, automationRuns, automationOutbox } = await import("../../src/db/schema.js");
const app = new Hono().route("/api/integrations", integrationsRoute).route("/api/webhook-endpoints", webhookEndpointsRoute).route("/api/webhooks", webhooksRoute);

test("official AgentMail/Svix protocol, encrypted credentials, tenant permissions and atomic durable delivery", async () => {
  const orgA = randomUUID(), orgB = randomUUID(), orgs = [orgA, orgB], userIds: string[] = [], ruleIds: string[] = [];
  const key = "fixture-agentmail-key", signingSecret = "whsec_" + randomBytes(32).toString("base64");
  const oldEncryption = process.env.INTEGRATION_ENCRYPTION_KEY, oldPublic = process.env.WEBHOOK_PUBLIC_URL, oldLimit = process.env.WEBHOOK_MAX_BODY_BYTES;
  const encryptionFixtureKey = randomBytes(32).toString("base64");
  process.env.INTEGRATION_ENCRYPTION_KEY = encryptionFixtureKey; process.env.WEBHOOK_PUBLIC_URL = "https://workspace.local.test";
  let cookie = "", otherCookie = "", ownerId = "", ownerMember = "", failProvider = false, messageGets = 0;
  const operations: { method: string; path: string; body?: Record<string, unknown> }[] = [], fixtureErrors: unknown[] = [];
  const host = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, `Bearer ${key}`);
      const url = new URL(req.url!, "http://fixture"), chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      operations.push({ method: req.method!, path: url.pathname + url.search, body });
      res.setHeader("Content-Type", "application/json");
      if (failProvider) { res.writeHead(401); res.end(JSON.stringify({ error: key })); return; }
      if (url.pathname === "/v0/inboxes") {
        assert.equal(url.searchParams.get("limit"), "100");
        res.end(JSON.stringify(url.searchParams.get("page_token") === "page2" ? { inboxes: [{ inbox_id: "second@agentmail.to", email: "second@agentmail.to" }] } : { inboxes: [{ inbox_id: "notes@agentmail.to", email: "notes@agentmail.to", display_name: "Notes" }], next_page_token: "page2" }));
      } else if (url.pathname === "/v0/webhooks" && req.method === "POST") {
        assert.deepEqual(body.event_types, ["message.received"]); assert.deepEqual(body.inbox_ids, ["notes@agentmail.to"]);
        assert.match(body.url, /^https:\/\/workspace\.local\.test\/api\/webhooks\/agentmail\/[a-f0-9-]+$/);
        assert.match(body.client_id, /^[a-f0-9-]+$/);
        res.end(JSON.stringify({ webhook_id: `remote-${body.client_id}`, secret: signingSecret }));
      } else if (url.pathname.includes("/messages/")) {
        messageGets++;
        assert.equal(url.pathname, "/v0/inboxes/notes%40agentmail.to/messages/%3Cmissing%40fixture%3E");
        res.end(JSON.stringify({ inbox_id: "notes@agentmail.to", message_id: "<missing@fixture>", from: "Sender <sender@local.test>", to: ["notes@agentmail.to"], text: "Fetched full body", timestamp: "2026-10-14T00:00:00Z" }));
      } else if (req.method === "PATCH" && url.pathname.startsWith("/v0/webhooks/")) { assert.equal(typeof body.enabled, "boolean"); res.end(JSON.stringify({ enabled: body.enabled })); }
      else if (req.method === "DELETE" && url.pathname.startsWith("/v0/webhooks/")) { res.writeHead(204); res.end(); }
      else throw new Error("Unexpected provider operation");
    } catch (error) { fixtureErrors.push(error); res.writeHead(500); res.end("{}"); }
  });
  await new Promise<void>(resolve => host.listen(0, "127.0.0.1", resolve));
  const address = host.address(); assert(address && typeof address !== "string");
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, "https://api.agentmail.to", "host operations never follow payload URLs or private origins");
    assert.equal(init?.redirect, "error");
    return nativeFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
  };
  const request = (path: string, data?: unknown, method = data === undefined ? "GET" : "POST", selectedCookie = cookie) => app.request(`http://localhost:3001/api${path}`, { method, headers: { Cookie: selectedCookie, ...(data === undefined ? {} : { "Content-Type": "application/json" }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const receive = (id: string, payload: unknown, deliveryId = randomUUID(), timestamp = new Date(), signature?: string) => {
    const body = JSON.stringify(payload);
    return app.request(`http://localhost:3001/api/webhooks/agentmail/${id}`, { method: "POST", headers: { "svix-id": deliveryId, "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)), "svix-signature": signature ?? new Webhook(signingSecret).sign(deliveryId, timestamp, body) }, body });
  };
  const addRule = async (source: import("@tabdo/shared").AutomationSource, type: string, org = orgA) => {
    const id = randomUUID(); ruleIds.push(id);
    await db.insert(automations).values({ id, organizationId: org, createdByUserId: ownerId, source, name: "Fixture event rule", trigger: { type }, actions: [{ type: "command", command: "batchAddRows", input: {} }] });
    return id;
  };
  const triggerName = `fixture_delivery_${randomUUID().replaceAll("-", "")}`;
  let installedTrigger = false;
  try {
    const signup = async () => {
      const response = await auth.handler(new Request("http://localhost:3001/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" }, body: JSON.stringify({ email: `integration-${randomUUID()}@local.test`, password: "Test-integration-password-123!", name: "Integration Test" }) }));
      assert.equal(response.status, 200); const account = (await response.json()).user; userIds.push(account.id);
      return { id: account.id as string, cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
    };
    const owner = await signup(); ownerId = owner.id; cookie = owner.cookie;
    const other = await signup(); otherCookie = other.cookie;
    await db.insert(organization).values(orgs.map(id => ({ id, name: "Integration Test", slug: id })));
    ownerMember = randomUUID();
    await db.insert(member).values([{ id: ownerMember, organizationId: orgA, userId: ownerId, role: "owner" }, { id: randomUUID(), organizationId: orgB, userId: other.id, role: "owner" }]);
    await db.update(session).set({ activeOrganizationId: orgA }).where(eq(session.userId, ownerId));
    await db.update(session).set({ activeOrganizationId: orgB }).where(eq(session.userId, other.id));
    assert.equal((await request("/integrations", undefined, "GET", "")).status, 401);
    const createdResponse = await request("/integrations", { provider: "agentmail", name: "Mail", apiKey: key });
    assert.equal(createdResponse.status, 201); const connection = (await createdResponse.json()).connection;
    assert.equal(connection.state, "unverified"); assert.equal(JSON.stringify(connection).includes(key), false);
    const [stored] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, connection.id));
    assert.equal(JSON.stringify(stored).includes(key), false);
    assert.equal(decryptSecret(stored.encryptedCredential, { organizationId: orgA, id: stored.id, purpose: "agentmail-key" }), key);
    assert.throws(() => decryptSecret(stored.encryptedCredential, { organizationId: orgB, id: stored.id, purpose: "agentmail-key" }));
    assert.throws(() => decryptSecret(stored.encryptedCredential, { organizationId: orgA, id: randomUUID(), purpose: "agentmail-key" }));
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    assert.equal((await request("/integrations", { provider: "agentmail", name: "No key", apiKey: key })).status, 503);
    assert.throws(() => encryptSecret(key, { organizationId: orgA, id: stored.id, purpose: "agentmail-key" }));
    process.env.INTEGRATION_ENCRYPTION_KEY = stored.encryptedCredential.keyId; // malformed configuration never falls back to plaintext
    assert.equal((await request(`/integrations/${connection.id}/inboxes`)).status, 503);
    process.env.INTEGRATION_ENCRYPTION_KEY = encryptionFixtureKey;
    assert.equal((await (await request("/integrations", undefined, "GET", otherCookie)).json()).connections.length, 0);
    assert.equal((await request(`/integrations/${connection.id}/inboxes`, undefined, "GET", otherCookie)).status, 404);
    failProvider = true;
    const failed = await (await request(`/integrations/${connection.id}/test`, {})).json(); assert.equal(failed.ok, false); assert.equal(failed.connection.state, "error"); assert.equal(JSON.stringify(failed).includes(key), false);
    failProvider = false;
    const tested = await (await request(`/integrations/${connection.id}/test`, {})).json(); assert.equal(tested.ok, true); assert.equal(tested.connection.state, "connected");
    const inboxes = (await (await request(`/integrations/${connection.id}/inboxes`)).json()).inboxes; assert.equal(inboxes.length, 2); assert.equal(inboxes[0].displayName, "Notes");
    assert.equal((await request(`/integrations/${connection.id}/webhooks`, { inboxIds: ["outside@agentmail.to"] })).status, 400);
    const registered = await request(`/integrations/${connection.id}/webhooks`, { inboxIds: ["notes@agentmail.to"] }); assert.equal(registered.status, 201);
    const endpoint = (await registered.json()).endpoint;
    assert.equal(endpoint.state, "active"); assert.equal(JSON.stringify(endpoint).includes(signingSecret), false);
    assert.equal("encryptedSigningSecret" in endpoint, false); assert.equal("remoteWebhookId" in endpoint, false);
    const endpointList = await (await request("/webhook-endpoints")).json(); assert.equal(endpointList.canManage, true); assert.equal(endpointList.endpoints.length, 1);
    await addRule({ kind: "agentmail", connectionId: connection.id, inboxId: "notes@agentmail.to" }, "message_received");
    await addRule({ kind: "agentmail", connectionId: connection.id, inboxId: "notes@agentmail.to" }, "message_received", orgB);
    const payload = { event_type: "message.received", message: { inbox_id: "notes@agentmail.to", message_id: "<html@fixture>", from_: ["sender@local.test"], to: ["notes@agentmail.to"], html: "<p>HTML only</p>", timestamp: "2026-10-14T00:00:00Z", organization_id: orgB, attachments: [{ attachment_id: "attachment", filename: "note.txt", content_type: "text/plain", size: 12, download_url: "http://127.0.0.1/private" }] } };
    assert.equal((await receive(endpoint.id, payload, randomUUID(), new Date(Date.now() - 10 * 60_000))).status, 401);
    assert.equal((await receive(endpoint.id, payload, randomUUID(), new Date(), "v1,invalid")).status, 401);
    const tamperedId = randomUUID(), signedBody = JSON.stringify(payload), signedAt = new Date();
    assert.equal((await app.request(`http://localhost:3001/api/webhooks/agentmail/${endpoint.id}`, { method: "POST", headers: { "svix-id": tamperedId, "svix-timestamp": String(Math.floor(signedAt.getTime() / 1000)), "svix-signature": new Webhook(signingSecret).sign(tamperedId, signedAt, signedBody) }, body: signedBody + "\n" })).status, 401, "raw bytes matter even when parsed JSON is identical");
    const wrongInbox = { ...payload, message: { ...payload.message, inbox_id: "second@agentmail.to" } };
    assert.equal((await receive(endpoint.id, wrongInbox)).status, 403);
    assert.equal((await db.select().from(integrationDeliveries).where(eq(integrationDeliveries.endpointId, endpoint.id))).length, 0);
    const deliveryId = randomUUID();
    const duplicates = await Promise.all([receive(endpoint.id, payload, deliveryId), receive(endpoint.id, payload, deliveryId)]);
    assert.deepEqual(duplicates.map(value => value.status), [200, 200]);
    assert.equal((await db.select().from(integrationDeliveries).where(eq(integrationDeliveries.endpointId, endpoint.id))).length, 1);
    const [event] = await db.select().from(automationEvents).where(eq(automationEvents.organizationId, orgA)); assert(event);
    assert.equal((await db.select().from(automationRuns).where(eq(automationRuns.eventId, event.id))).length, 1, "cross-workspace rule never matches");
    assert.equal((await db.select().from(automationOutbox).where(eq(automationOutbox.eventId, event.id))).length, 1, "ACK follows durable outbox commit without Redis or model");
    const verifiedEvent = (event.snapshot as unknown as { event: import("../../src/automation/events.js").ExternalAutomationEvent }).event;
    const normalized = verifiedEvent.data.message as Record<string, unknown>;
    assert.equal(normalized.text, null); assert.equal(normalized.html, "<p>HTML only</p>"); assert.deepEqual(normalized.senders, ["sender@local.test"]); assert.equal(normalized.bodyMissing, false);
    assert.equal(JSON.stringify(normalized).includes("download_url"), false); assert.equal(JSON.stringify(normalized).includes(orgB), false);
    await hydrateAgentMailEvent(verifiedEvent); assert.equal(messageGets, 0, "HTML-only is complete without pretending text exists");
    assert.equal((await (await receive(endpoint.id, payload)).json()).duplicate, true, "logical dedupe also rejects a new Svix ID");
    const secondEndpoint = (await (await request(`/integrations/${connection.id}/webhooks`, { inboxIds: ["notes@agentmail.to"] })).json()).endpoint;
    assert.equal((await (await receive(secondEndpoint.id, payload)).json()).duplicate, true, "logical dedupe spans registrations of the same connection/inbox");
    assert.equal((await receive(endpoint.id, { event_type: "message.sent" })).status, 200);
    const ignored = await db.select().from(integrationDeliveries).where(and(eq(integrationDeliveries.endpointId, endpoint.id), eq(integrationDeliveries.status, "ignored"))); assert.equal(ignored.length, 1);
    const missing = { ...payload, message: { inbox_id: "notes@agentmail.to", message_id: "<missing@fixture>", from: "sender@local.test", to: ["notes@agentmail.to"] } };
    const bodyRuleId = await addRule({ kind: "agentmail", connectionId: connection.id, inboxId: "notes@agentmail.to" }, "message_received");
    await db.update(automations).set({ eventConditions: [{ id: randomUUID(), path: "message.text", op: "contains", value: "Fetched full body" }] }).where(eq(automations.id, bodyRuleId));
    assert.equal((await receive(endpoint.id, missing)).status, 200); assert.equal(messageGets, 0, "body fetch cannot block ACK");
    const missingEvent = (await db.select().from(automationEvents).where(eq(automationEvents.organizationId, orgA))).find(value => JSON.stringify(value.snapshot).includes("<missing@fixture>")); assert(missingEvent);
    assert.equal((await db.select().from(automationRuns).where(and(eq(automationRuns.eventId, missingEvent.id), eq(automationRuns.automationId, bodyRuleId)))).length, 1, "missing body cannot discard a rule whose text condition needs hydration");
    const hydrated = await hydrateAgentMailEvent((missingEvent.snapshot as unknown as { event: import("../../src/automation/events.js").ExternalAutomationEvent }).event);
    assert.equal((hydrated.data.message as Record<string, unknown>).text, "Fetched full body"); assert.equal(messageGets, 1);
    const [bodyRule] = await db.select().from(automations).where(eq(automations.id, bodyRuleId));
    assert.equal(eventConditionsMatch(bodyRule as unknown as import("@tabdo/shared").AutomationRule, eventBindingContext({ protocol: 2, event: hydrated, actorId: null, traceId: hydrated.traceId })), true, "the complete body condition is evaluated after hydration");
    const generic = await (await request("/webhook-endpoints", { name: "Incoming notes" })).json(); assert.match(generic.token, /^hook_/);
    assert.equal(JSON.stringify(await (await request("/webhook-endpoints")).json()).includes(generic.token), false);
    await addRule({ kind: "webhook", endpointId: generic.endpoint.id }, "webhook_received");
    const genericBody = { value: "new note", organizationId: orgB, actorId: "forged" };
    const genericReceive = (key?: string, token = generic.token) => app.request(`http://localhost:3001/api/webhooks/${generic.endpoint.id}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(genericBody) });
    assert.equal((await genericReceive(undefined, "wrong")).status, 401);
    // A scoped fixture trigger fails the LAST outbox insert, proving delivery/event/run rollback before ACK.
    await client.unsafe(`CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM automation_events WHERE id=NEW.event_id AND organization_id='${orgA}') THEN RAISE EXCEPTION 'fixture durable failure'; END IF; RETURN NEW; END $$`);
    await client.unsafe(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON automation_outbox FOR EACH ROW EXECUTE FUNCTION ${triggerName}()`); installedTrigger = true;
    const beforeEvents = (await db.select().from(automationEvents).where(eq(automationEvents.organizationId, orgA))).length;
    const beforeRuns = (await db.select().from(automationRuns).where(inArray(automationRuns.automationId, ruleIds))).length;
    assert.equal((await genericReceive("atomic-fixture")).status, 500);
    assert.equal((await db.select().from(integrationDeliveries).where(eq(integrationDeliveries.endpointId, generic.endpoint.id))).length, 0);
    assert.equal((await db.select().from(automationEvents).where(eq(automationEvents.organizationId, orgA))).length, beforeEvents);
    assert.equal((await db.select().from(automationRuns).where(inArray(automationRuns.automationId, ruleIds))).length, beforeRuns);
    await client.unsafe(`DROP TRIGGER ${triggerName} ON automation_outbox`); await client.unsafe(`DROP FUNCTION ${triggerName}()`); installedTrigger = false;
    assert.equal((await genericReceive("atomic-fixture")).status, 200);
    assert.equal((await (await genericReceive("atomic-fixture")).json()).duplicate, true);
    assert.equal((await db.select().from(integrationDeliveries).where(eq(integrationDeliveries.endpointId, generic.endpoint.id))).length, 1);
    process.env.WEBHOOK_MAX_BODY_BYTES = "1024";
    assert.equal((await app.request(`http://localhost:3001/api/webhooks/${generic.endpoint.id}`, { method: "POST", headers: { Authorization: `Bearer ${generic.token}` }, body: JSON.stringify({ value: "x".repeat(2048) }) })).status, 413);
    await db.update(member).set({ role: "member" }).where(eq(member.id, ownerMember));
    assert.equal((await (await request("/integrations")).json()).canManage, false);
    assert.equal((await request(`/integrations/${connection.id}`, { enabled: false }, "PATCH")).status, 403);
    assert.equal((await request("/webhook-endpoints", { name: "Denied" })).status, 403);
    await db.update(member).set({ role: "owner" }).where(eq(member.id, ownerMember));
    assert.equal((await request(`/webhook-endpoints/${generic.endpoint.id}`, undefined, "DELETE", otherCookie)).status, 404);
    assert.equal((await request(`/webhook-endpoints/${generic.endpoint.id}`, undefined, "DELETE")).status, 200);
    assert.equal((await genericReceive()).status, 404);
    assert.equal((await request(`/webhook-endpoints/${secondEndpoint.id}`, { enabled: false }, "PATCH")).status, 200);
    assert.equal((await receive(secondEndpoint.id, payload)).status, 410);
    assert.equal((await request(`/webhook-endpoints/${secondEndpoint.id}`, { enabled: true }, "PATCH")).status, 200);
    assert.equal((await receive(secondEndpoint.id, payload)).status, 200);
    failProvider = true;
    assert.equal((await request(`/webhook-endpoints/${secondEndpoint.id}`, undefined, "DELETE")).status, 502);
    assert.equal((await receive(secondEndpoint.id, payload)).status, 410, "failed provider removal still revokes locally");
    assert.equal((await (await request("/webhook-endpoints")).json()).endpoints.find((item: { id: string }) => item.id === secondEndpoint.id).state, "error");
    failProvider = false;
    assert.equal((await request(`/webhook-endpoints/${secondEndpoint.id}`, undefined, "DELETE")).status, 200, "remote failure keeps a retryable handle");
    assert.equal((await request(`/integrations/${connection.id}`, { enabled: false }, "PATCH")).status, 200);
    assert.equal((await receive(endpoint.id, payload)).status, 410);
    assert.equal((await request(`/integrations/${connection.id}`, { enabled: true }, "PATCH")).status, 200);
    assert.equal((await receive(endpoint.id, payload)).status, 200);
    assert.equal((await request(`/integrations/${connection.id}`, undefined, "DELETE")).status, 200);
    assert.equal((await (await request("/integrations")).json()).connections.length, 0);
    assert.equal((await (await request("/webhook-endpoints")).json()).endpoints.length, 0);
    assert.deepEqual(fixtureErrors, []); assert(operations.length > 0);
  } finally {
    globalThis.fetch = nativeFetch;
    if (installedTrigger) { await client.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON automation_outbox`); await client.unsafe(`DROP FUNCTION IF EXISTS ${triggerName}()`); }
    if (ruleIds.length) await db.delete(automationRuns).where(inArray(automationRuns.automationId, ruleIds));
    await db.delete(automationEvents).where(inArray(automationEvents.organizationId, orgs));
    for (const id of orgs) await db.delete(organization).where(eq(organization.id, id));
    for (const id of userIds) await db.delete(user).where(eq(user.id, id));
    for (const [name, value] of [["INTEGRATION_ENCRYPTION_KEY", oldEncryption], ["WEBHOOK_PUBLIC_URL", oldPublic], ["WEBHOOK_MAX_BODY_BYTES", oldLimit]]) { if (value === undefined) delete process.env[name!]; else process.env[name!] = value; }
    await new Promise<void>((resolve, reject) => host.close(error => error ? reject(error) : resolve()));
    await client.end();
  }
});
