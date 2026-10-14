import assert from "node:assert/strict";
import { test } from "node:test";
import { HTTPException } from "hono/http-exception";
import { createChatAdmission, releaseChatAdmission } from "../../src/harness/admission.js";

const exhausted = (error: unknown) => error instanceof HTTPException && error.status === 429;

test("user admission spans organizations and release is idempotent", () => {
  const acquire = createChatAdmission();
  const a = acquire({ userId: "user", organizationId: "a" });
  const b = acquire({ userId: "user", organizationId: "b" });
  assert.throws(() => acquire({ userId: "user", organizationId: "c" }), exhausted);
  releaseChatAdmission(a);releaseChatAdmission(a);
  const c = acquire({ userId: "user", organizationId: "c" });
  assert.throws(() => acquire({ userId: "user", organizationId: "d" }), exhausted);
  releaseChatAdmission(b);releaseChatAdmission(c);
  const d = acquire({ userId: "user", organizationId: "d" });
  releaseChatAdmission(d);
});

test("organization and platform limits reject atomically without leaking counts", () => {
  const acquire = createChatAdmission();
  const handles = Array.from({ length: 4 }, (_, i) => acquire({ userId: `u${i}`, organizationId: "org" }));
  assert.throws(() => acquire({ userId: "next", organizationId: "org" }), exhausted);
  handles.push(acquire({ userId: "next", organizationId: "other" }));
  for (let i = 5; i < 32; i++) handles.push(acquire({ userId: `u${i}`, organizationId: `org${i}` }));
  assert.throws(() => acquire({ userId: "overflow", organizationId: "overflow" }), exhausted);
  releaseChatAdmission(handles[0]);
  handles.push(acquire({ userId: "overflow", organizationId: "overflow" }));
  handles.forEach(releaseChatAdmission);
});
