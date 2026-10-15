import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveActor, type Actor, type AuthDatabase } from "../src/actor.js";
import { assertProductionAuthSecret, DEV_SECRET } from "../src/factory.js";

const database: AuthDatabase = {
  select() { throw new Error("Unexpected database access"); },
  insert() { throw new Error("Unexpected database access"); },
  delete() { throw new Error("Unexpected database access"); },
};
const actor: Actor = { kind: "agent", userId: "user", memberId: "member", organizationId: "org", role: "member", name: "Test", email: "test@local.test" };
test("authentication delegates credential extensions without importing product schemas", async () => {
  let calls = 0;
  const result = await resolveActor(new Request("http://auth.test", { headers: { authorization: "Bearer custom-credential" } }), {
    database, resolveSession: async () => { throw new Error("Unexpected cookie fallback"); },
    resolveBearer: async token => { calls++;assert.equal(token, "custom-credential");return actor; },
  });
  assert.equal(result, actor);assert.equal(calls, 1);
});
test("invalid personal keys cannot bypass verification through a credential extension", async () => {
  const result = await resolveActor(new Request("http://auth.test", { headers: { authorization: "Bearer tab_invalid" } }), {
    database, resolveSession: async () => null,
    resolveBearer: async () => { throw new Error("An invalid personal key must not delegate"); },
  });
  assert.equal(result, null);
});
test("session resolution failures fail closed even if diagnostic logging throws", async () => {
  assert.equal(await resolveActor(new Request("http://auth.test"), {
    database, resolveSession: async () => { throw new Error("session unavailable"); },
    logger: { warn() { throw new Error("logger unavailable"); } },
  }), null);
});
test("production authentication rejects placeholder secrets and accepts explicit signing configuration", () => {
  for (const secret of [undefined, "", DEV_SECRET, "replace-with-32+-char-secret", "a".repeat(40)]) assert.throws(() => assertProductionAuthSecret(secret));
  const secret = "auth-test-explicit-32-character-independent-secret";
  assert.equal(assertProductionAuthSecret(secret), secret);
});
