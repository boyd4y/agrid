import assert from "node:assert/strict";
import { test } from "node:test";
import { asSchema, type ToolSet } from "ai";
import { createTableTools } from "../../src/business/agent/tools/index.js";
import { reportWidgetSchema } from "../../src/business/reports/schema.js";

test("reconstructing platform tools preserves the public native tool declaration", async () => {
  const schemas = async () => {
    const tools: ToolSet = createTableTools(() => { throw new Error("Schema generation needs no database"); });
    return Promise.all(Object.entries(tools).map(async ([name, definition]) => ({
      name, description: definition.description, schema: await asSchema(definition.inputSchema).jsonSchema,
    })));
  };
  assert.deepEqual(await schemas(), await schemas(), "dynamic defaults must not restart an otherwise unchanged native conversation");
});

test("report widgets still allocate distinct IDs on execution and preserve supplied IDs", () => {
  const input = { type: "text", title: "Receipt", width: "full", content: "Saved" };
  const first = reportWidgetSchema.parse(input), second = reportWidgetSchema.parse(input);
  assert.match(first.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(first.id, second.id);
  assert.equal(reportWidgetSchema.parse({ ...input, id: first.id }).id, first.id);
});
