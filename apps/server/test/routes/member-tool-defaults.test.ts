import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgent, type MemberDependencies } from "../../src/business/services/members.js";
import type { Actor } from "../../src/business/auth/actor.js";
import { agentProfile } from "../../src/business/db/schema.js";

for (const persona of [undefined, {}, { disabledTools: [] }, { disabledTools: ["update_cell"] }]) {
  test("agent creation honors omitted and explicit tool settings: " + JSON.stringify(persona), async () => {
    let saved: { persona?: { disabledTools?: string[] } } | undefined;
    const tx = { insert: (table: unknown) => ({ values: async (value: unknown) => {
      if (table === agentProfile) saved = value as typeof saved;
    } }) };
    const deps = { uuid: () => crypto.randomUUID(), database: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) } } as unknown as MemberDependencies;
    const actor = { organizationId: "fixture-org", role: "owner" } as Actor;
    const result = await createAgent(deps, actor, { name: "Fixture", ...(persona ? { persona } : {}) });
    const expected = persona && "disabledTools" in persona ? persona.disabledTools : ["send_email", "reply_email"];
    assert.deepEqual(result.member.agent.persona.disabledTools, expected);
    assert.deepEqual(saved?.persona?.disabledTools, expected);
  });
}
