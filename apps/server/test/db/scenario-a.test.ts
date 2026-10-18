import test from "node:test";
import assert from "node:assert/strict";
import { AUTOMATION_ACTION_SCHEMA } from "@tabdo/shared";
import { scenarioAActions, SCENARIO_A_PROMPT } from "../../src/db/scenario-a-config.js";

test("Scenario A actions validate and bind the real agent user identity", () => {
  const agentUserId = "61a04bc9-356a-40cf-b22c-a3322a9c9235";
  const actions = scenarioAActions(agentUserId);
  assert.equal(actions.length, 3);
  for (const action of actions) {
    const parsed = AUTOMATION_ACTION_SCHEMA.parse(action);
    assert.equal(parsed.type, "run_agent");
    if (parsed.type === "run_agent") assert.equal(parsed.agentUserId, agentUserId);
    assert.equal(AUTOMATION_ACTION_SCHEMA.safeParse({ ...action, agentUserId: "" }).success, false);
  }
  assert.match(SCENARIO_A_PROMPT, /list_mail_inboxes/);
  assert.match(SCENARIO_A_PROMPT, /send_email 成功/);
  assert.match(actions[2].type === "run_agent" ? actions[2].prompt : "", /跟进邮件草稿/);
});
