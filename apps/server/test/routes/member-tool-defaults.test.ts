import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgent, updateAgent, type MemberDependencies } from "../../src/business/services/members.js";
import type { Actor } from "../../src/business/auth/actor.js";
import { agentProfile } from "../../src/business/db/schema.js";

for (const persona of [undefined, {}, { disabledTools: [] }, { disabledTools: ["update_cell"] }, { defaultHarness: "codex", defaultModel: "auto", runtime: "sandbox", sandboxProvider: "e2b" }, { defaultHarness: 123, defaultModel: null }]) {
  test("agent creation honors omitted and explicit tool settings: " + JSON.stringify(persona), async () => {
    let saved: { persona?: { disabledTools?: string[] } } | undefined;
    const tx = { insert: (table: unknown) => ({ values: async (value: unknown) => {
      if (table === agentProfile) saved = value as typeof saved;
    } }) };
    const deps = { uuid: () => crypto.randomUUID(), database: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) } } as unknown as MemberDependencies;
    const actor = { organizationId: "fixture-org", role: "owner" } as Actor;
    const result = await createAgent(deps, actor, { name: "Fixture", ...(persona ? { persona } : {}) });
    const expected = persona && "disabledTools" in persona ? persona.disabledTools : ["send_email", "reply_email"];
    assert.equal(result.member.agent.persona.defaultHarness, "pi");
    assert.equal(result.member.agent.persona.defaultModel, "__harness_default__");
    if (persona && "runtime" in persona) {
      assert.equal(result.member.agent.persona.runtime, "sandbox");
      assert.equal(result.member.agent.persona.sandboxProvider, "e2b");
    }
    assert.deepEqual(result.member.agent.persona.disabledTools, expected);
    assert.deepEqual(saved?.persona?.disabledTools, expected);
  });
}

test("agent updates force env defaults while preserving runtime choices", async () => {
  let saved: any;
  const stop = new Error("stop after transaction capture");
  const existing = { defaultHarness: "codex", defaultModel: "legacy", disabledTools: [] };
  const database = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [
      { id: "fixture", userId: "agent", persona: existing },
    ] }) }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      await fn({ update: () => ({ set: (value: unknown) => ({ where: async () => { saved = value; } }) }) });
      throw stop;
    },
  };
  const deps = { database, now: () => new Date() } as unknown as MemberDependencies;
  await assert.rejects(updateAgent(deps, { organizationId: "org", role: "owner" } as Actor, {
    persona: { defaultHarness: "claude", defaultModel: "override", runtime: "sandbox", sandboxProvider: "e2b" },
  }, "fixture"), error => error === stop);
  assert.equal(saved.persona.defaultHarness, "pi");
  assert.equal(saved.persona.defaultModel, "__harness_default__");
  assert.equal(saved.persona.runtime, "sandbox");
  assert.equal(saved.persona.sandboxProvider, "e2b");
});
