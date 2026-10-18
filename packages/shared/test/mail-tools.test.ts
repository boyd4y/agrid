import assert from "node:assert/strict";
import { test } from "node:test";
import { DISABLED_TOOLS_SCHEMA, PLATFORM_TOOL_IDS } from "../src/tools.js";

test("mail tools are selectable platform toggles", () => {
  const ids = ["list_mail_inboxes", "send_email", "reply_email", "get_message"] as const;
  for (const id of ids) assert(PLATFORM_TOOL_IDS.includes(id));
  assert.deepEqual(DISABLED_TOOLS_SCHEMA.parse([...ids]), [...ids]);
});
