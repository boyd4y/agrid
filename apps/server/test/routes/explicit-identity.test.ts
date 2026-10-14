import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "@tabdo/backend/database";
import { createPlatformAuth } from "@tabdo/backend/auth";
import { resolveActor, listOrgMembers, hashApiKey, type ActorDependencies } from "@tabdo/backend/auth/actor";
import { memberAvatarUrl } from "@tabdo/backend/auth/avatar";
import { user, organization, member, userApiKeys, session, agentProfile } from "@tabdo/backend/schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");

test("identity service uses explicit database/session ports without resource scope and retains live permissions", async () => {
  const resource = createDatabase({ connectionString: databaseUrl, poolMax: 2 });
  const db = resource.db;
  const auth = createPlatformAuth({ database: db, appUrl: "http://localhost:5173", baseURL: "http://localhost:3001",
    secret: "explicit-identity-fixture-secret-32-bytes-minimum", production: false, sendInviteEmail: async () => {} });
  const orgA = randomUUID(), orgB = randomUUID(), ownerMembership = randomUUID(), agentUser = randomUUID(), agentMembership = randomUUID();
  const createdUsers: string[] = [];
  let cookieReads = 0;
  const deps: ActorDependencies = { database: db, resolveSession: headers => { cookieReads++;return auth.api.getSession({ headers }); } };
  const request = (authorization?: string, cookie?: string) => new Request("http://localhost:3001/api/tables", { headers: {
    ...(authorization ? { Authorization: authorization } : {}), ...(cookie ? { Cookie: cookie } : {}), "X-Tabdo-Organization-Id": orgB,
  } });
  try {
    const signup = await auth.handler(new Request("http://localhost:3001/api/auth/sign-up/email", { method: "POST", headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
      body: JSON.stringify({ email: `identity-${randomUUID()}@local.test`, password: "Explicit-identity-password-123!", name: "Explicit owner" }) }));
    assert.equal(signup.status, 200);
    const owner = (await signup.json()).user as { id: string; name: string; email: string };
    createdUsers.push(owner.id, agentUser);
    const cookie = signup.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    await db.insert(organization).values([{ id: orgA, name: "Identity A", slug: orgA }, { id: orgB, name: "Identity B", slug: orgB }]);
    await db.insert(member).values([{ id: ownerMembership, userId: owner.id, organizationId: orgA, role: "owner" }, { id: randomUUID(), userId: owner.id, organizationId: orgB, role: "member" }]);
    await db.update(session).set({ activeOrganizationId: orgB }).where(eq(session.userId, owner.id));
    assert.equal((await resolveActor(request(undefined, cookie), deps))?.organizationId, orgB);
    const raw = `tab_${randomBytes(32).toString("base64url")}`;
    const [key] = await db.insert(userApiKeys).values({ userId: owner.id, organizationId: orgA, name: "Explicit fixture", keyHash: await hashApiKey(raw), prefix: raw.slice(0, 12) }).returning();
    const bearer = request(`Bearer ${raw}`, cookie);
    const readsBeforeKey = cookieReads;
    const actor = await resolveActor(bearer, deps);
    assert.equal(actor?.organizationId, orgA);assert.equal(actor?.memberId, ownerMembership);assert.equal(cookieReads, readsBeforeKey);
    await db.update(member).set({ role: "member" }).where(eq(member.id, ownerMembership));
    assert.equal((await resolveActor(bearer, deps))?.role, "member");
    await db.delete(member).where(eq(member.id, ownerMembership));
    assert.equal(await resolveActor(bearer, deps), null);
    await db.insert(member).values({ id: ownerMembership, userId: owner.id, organizationId: orgA, role: "owner" });
    await db.update(userApiKeys).set({ revokedAt: new Date() }).where(eq(userApiKeys.id, key.id));
    assert.equal(await resolveActor(bearer, deps), null);assert.equal(cookieReads, readsBeforeKey, "revoked key never falls back to cookie");
    await db.delete(userApiKeys).where(eq(userApiKeys.id, key.id));
    assert.equal(await resolveActor(bearer, deps), null);
    assert.equal(await resolveActor(request("Bearer tab_invalid", cookie), deps), null);
    assert.equal(cookieReads, readsBeforeKey);

    const legacy = `agt_${randomUUID()}`;
    await db.insert(user).values({ id: agentUser, name: "Agent identity", email: `${agentUser}@local.test`, kind: "agent" });
    await db.insert(member).values({ id: agentMembership, organizationId: orgA, userId: agentUser });
    const [profile] = await db.insert(agentProfile).values({ organizationId: orgA, userId: agentUser, memberId: agentMembership,
      displayName: "Explicit legacy agent", apiKeyHash: await hashApiKey(legacy), persona: {} }).returning();
    assert.equal((await resolveActor(request(`Bearer ${legacy}`), deps))?.kind, "agent");
    await db.update(member).set({ organizationId: orgB }).where(eq(member.id, agentMembership));
    assert.equal(await resolveActor(request(`Bearer ${legacy}`, cookie), deps), null);
    await db.update(member).set({ organizationId: orgA, userId: owner.id }).where(eq(member.id, agentMembership));
    assert.equal(await resolveActor(request(`Bearer ${legacy}`, cookie), deps), null);
    await db.update(member).set({ userId: agentUser }).where(eq(member.id, agentMembership));
    const avatar = "data:image/png;base64,iVBORw0KGgo=";
    await db.update(user).set({ image: avatar }).where(eq(user.id, owner.id));
    const listed = await db.transaction(tx => listOrgMembers(orgA, { database: tx }));
    assert.equal(listed.find(entry => entry.userId === owner.id)?.image, `/api/members/${ownerMembership}/avatar?v=${createHash("sha256").update(avatar).digest("hex").slice(0, 16)}`);
    assert.equal(listed.find(entry => entry.userId === agentUser)?.agent?.displayName, profile.displayName);
    await db.update(session).set({ activeOrganizationId: orgA }).where(eq(session.userId, owner.id));
    await db.delete(member).where(eq(member.id, ownerMembership));
    assert.equal(await resolveActor(request(undefined, cookie), deps), null, "active workspace without membership is denied");
    let warnings = 0;
    assert.equal(await resolveActor(request(undefined, cookie), { database: db, resolveSession: async () => { throw new Error("Session unavailable"); }, logger: { warn() { warnings++; } } }), null);
    assert.equal(warnings, 1);
  } finally {
    await db.delete(organization).where(eq(organization.id, orgA));await db.delete(organization).where(eq(organization.id, orgB));
    for (const id of createdUsers) await db.delete(user).where(eq(user.id, id));
    await resource.close();
  }
});

test("portable credential hash and avatar projection match existing UTF-8 SHA256 bytes", async () => {
  for (const input of ["", "tab_fixture", "中文-key-🚀\ud800"]) assert.equal(await hashApiKey(input), createHash("sha256").update(input).digest("hex"));
  assert.equal(await memberAvatarUrl("member-id", null), null);
  assert.equal(await memberAvatarUrl("member-id", "bot:round:happy:teal"), "bot:round:happy:teal");
  assert.equal(await memberAvatarUrl("member-id", "https://example.test/avatar.png"), "https://example.test/avatar.png");
});
