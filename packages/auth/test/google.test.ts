import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuth, DEV_SECRET, isGoogleAuthConfigured, resolveSocialProviders } from "../src/factory.js";

const credentials = { clientId: " google-client ", clientSecret: " google-secret " };

test("Google configuration requires both trimmed credentials", () => {
  for (const google of [undefined, { clientId: "", clientSecret: "secret" }, { clientId: "id", clientSecret: " \n " }]) {
    assert.equal(isGoogleAuthConfigured(google), false);
    assert.equal(resolveSocialProviders(google), undefined);
  }
  assert.equal(isGoogleAuthConfigured(credentials), true);
  assert.deepEqual(resolveSocialProviders(credentials), { google: { clientId: "google-client", clientSecret: "google-secret" } });
});

test("createAuth optionally configures Google without connecting to a database", () => {
  for (const google of [undefined, { clientId: "id", clientSecret: " " }, credentials]) {
    const auth = createAuth({
      database: {} as Parameters<typeof createAuth>[0]["database"],
      appUrl: "http://localhost:5173",
      baseURL: "http://localhost:3001",
      secret: DEV_SECRET,
      production: false,
      sendInviteEmail: async () => {},
      google,
    });
    assert.deepEqual(auth.options.socialProviders, resolveSocialProviders(google));
    assert.deepEqual(auth.options.account?.accountLinking, { enabled: true });
    assert.deepEqual(auth.options.trustedOrigins, ["http://localhost:5173", "http://localhost:5173", "http://127.0.0.1:5173"]);
  }
});
