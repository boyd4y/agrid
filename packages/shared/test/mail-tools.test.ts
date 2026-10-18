import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DISABLED_PLATFORM_TOOLS, DISABLED_TOOLS_SCHEMA, PLATFORM_TOOL_IDS } from "../src/tools.js";

test("mail tools are selectable platform toggles", () => {
  const ids = ["list_mail_inboxes", "send_email", "reply_email", "get_message"] as const;
  for (const id of ids) assert(PLATFORM_TOOL_IDS.includes(id));
  assert.deepEqual(DISABLED_TOOLS_SCHEMA.parse([...ids]), [...ids]);
});

test("outbound mail defaults are valid configurable platform tools", () => {
  assert.deepEqual(DEFAULT_DISABLED_PLATFORM_TOOLS, ["send_email", "reply_email"]);
  for (const id of DEFAULT_DISABLED_PLATFORM_TOOLS) assert(PLATFORM_TOOL_IDS.includes(id));
  assert.deepEqual(DISABLED_TOOLS_SCHEMA.parse([...DEFAULT_DISABLED_PLATFORM_TOOLS]), [...DEFAULT_DISABLED_PLATFORM_TOOLS]);
});
