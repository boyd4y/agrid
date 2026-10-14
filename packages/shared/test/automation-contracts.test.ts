import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  AUTOMATION_DATA_COMMANDS, AUTOMATION_DATA_COMMAND_SCHEMAS, AUTOMATION_SOURCE_SCHEMA,
  automationPath, parseAutomationCommand, renderAutomationPrompt, resolveAutomationBindings, validateAutomationActionReferences,
  type AutomationDataCommand,
} from "../src/automation-contracts.js";

const tableId = randomUUID(), rowId = randomUUID(), columnId = randomUUID(), recordId = randomUUID();
const cells = { [columnId]: 0 };
const relation = { rowId, columnId, recordIds: [recordId], expectedVersion: 1 };

test("saving rejects stale, self and future step references after actions change", () => {
  const initial = { type: "command", command: "addRow", input: { tableId } } as const;
  const dependent = { type: "command", command: "updateCell", input: { rowId: { $step: { index: 0, path: "result.id" } }, columnId, value: "ok" } } as const;
  assert.doesNotThrow(() => validateAutomationActionReferences([initial, dependent]));
  assert.throws(() => validateAutomationActionReferences([dependent]), /前面/);
  assert.doesNotThrow(() => validateAutomationActionReferences([initial, { type: "run_agent", agentUserId: "agent", prompt: "{{steps.0.result.id}} {{event.message.subject}}" }]));
  assert.throws(() => validateAutomationActionReferences([{ type: "run_agent", agentUserId: "agent", prompt: "{{steps.0.text}}" }]), /前面/);
  assert.throws(() => validateAutomationActionReferences([{ type: "command", command: "addRow", input: { cells: { $event: "constructor.secret" } } }]));
});
const fixtures = {
  addRow: { tableId, cells }, updateCell: { rowId, columnId, value: false, expectedVersion: 1 },
  updateCells: { rowId, cells, expectedVersion: 1 }, deleteRow: { rowId },
  setStatus: { rowId, columnId, statusOptionId: "done" }, moveCard: { rowId, columnId, statusOptionId: "done" },
  setRelation: relation, addRelation: relation, removeRelation: relation,
  addColumn: { tableId, name: "Amount", type: "number" }, updateColumn: { columnId, width: 180 },
  deleteColumn: { columnId }, reorderColumns: { tableId, columnIds: [columnId] },
  batchAddRows: { tableId, rows: [{ cells }] }, batchUpdateRows: { updates: [{ rowId, cells }] },
  batchDeleteRows: { rowIds: [rowId] }, batchAddColumns: { tableId, columns: [{ name: "Files", type: "file" }] },
  batchUpdateColumns: { columns: [{ columnId, name: "New name" }] }, batchDeleteColumns: { columnIds: [columnId] },
  batchSetRelations: { relations: [relation] }, batchAddRelations: { relations: [relation] },
  batchRemoveRelations: { relations: [relation] },
} satisfies Record<AutomationDataCommand, unknown>;

test("all 22 automation data commands parse the platform wire shapes and reject extra controls", () => {
  assert.equal(AUTOMATION_DATA_COMMANDS.length, 22);
  assert.deepEqual([...AUTOMATION_DATA_COMMANDS].sort(), Object.keys(fixtures).sort());
  for (const command of AUTOMATION_DATA_COMMANDS) {
    assert.deepEqual(parseAutomationCommand(command, fixtures[command]), fixtures[command], command);
    assert(!AUTOMATION_DATA_COMMAND_SCHEMAS[command].safeParse({ ...fixtures[command], organizationId: "override" }).success, command);
  }
  assert.throws(() => parseAutomationCommand("updateCell", { rowId, columnId, value: Infinity }));
  assert.throws(() => parseAutomationCommand("addRow", { tableId, cells: { unknown: "wrong column" } }));
  assert.throws(() => parseAutomationCommand("reorderColumns", { tableId, columnIds: [columnId, columnId] }));
  assert.throws(() => parseAutomationCommand("batchUpdateRows", { updates: [{ rowId, cells }, { rowId, cells }] }));
  assert.throws(() => parseAutomationCommand("batchAddRows", { tableId, rows: [] }));
  assert.throws(() => parseAutomationCommand("batchSetRelations", { relations: [relation, relation] }));
});

test("automation sources require their own discriminated identifiers without accepting another source's fields", () => {
  for (const source of [
    { kind: "table", tableId }, { kind: "webhook", endpointId: randomUUID() },
    { kind: "agentmail", connectionId: randomUUID(), inboxId: "inbox@example.test" },
    { kind: "schedule", cron: "0 9 * * *", timeZone: "Asia/Shanghai" },
  ]) assert.deepEqual(AUTOMATION_SOURCE_SCHEMA.parse(source), source);
  for (const source of [{ kind: "table", tableId: "invalid" }, { kind: "webhook", tableId },
    { kind: "agentmail", connectionId: randomUUID(), inboxId: " " },
    { kind: "schedule", cron: "", timeZone: "Asia/Shanghai" }, { kind: "table", tableId, endpointId: randomUUID() }])
    assert(!AUTOMATION_SOURCE_SCHEMA.safeParse(source).success);
});

test("event and completed-step bindings preserve JSON types inside nested command inputs", () => {
  const event = { row: { id: rowId, cells: { ids: [recordId], count: 0, enabled: false, cleared: null } } };
  const context = { event, steps: [{ rowIds: [rowId], count: 2 }] };
  const input = { tableId, rows: [{ cells: { [columnId]: { $event: "row.cells.ids" } } }],
    counts: [{ $event: "row.cells.count" }, { $step: { index: 0, path: "count" } }],
    enabled: { $event: "row.cells.enabled" }, cleared: { $event: "row.cells.cleared" },
    priorRow: { $step: { index: 0, path: "rowIds.0" } }, literal: "$event.row.id" };
  assert.deepEqual(resolveAutomationBindings(input, context), {
    tableId, rows: [{ cells: { [columnId]: [recordId] } }], counts: [0, 2], enabled: false,
    cleared: null, priorRow: rowId, literal: "$event.row.id",
  });
  assert.deepEqual(context, { event, steps: [{ rowIds: [rowId], count: 2 }] });
  for (const bad of [{ $step: { index: 1, path: "count" } }, { $step: { index: -1, path: "count" } },
    { $event: "row.id", sibling: "not a reference" }, { $event: 1 },
    JSON.parse('{"__proto__":{"polluted":true}}'), { unsupported: undefined }, { unsupported: NaN }])
    assert.throws(() => resolveAutomationBindings(bad, context));
  let nested: unknown = null;
  for (let depth = 0; depth < 32; depth++) nested = { value: nested };
  assert.throws(() => resolveAutomationBindings(nested, context), /层级/);
});

test("own-path lookup blocks inherited/prototype paths and prompt interpolation serializes typed results", () => {
  const inherited = Object.assign(Object.create({ secret: "inherited" }), { own: { rows: [{ id: rowId }], flag: false, empty: null } });
  assert.equal(automationPath(inherited, "own.rows.0.id"), rowId);
  for (const path of ["secret", "own.toString", "own.__proto__", "own.constructor", "own.prototype", "own..rows", "own.missing", "", "x".repeat(501)])
    assert.throws(() => automationPath(inherited, path));
  const context = { event: inherited, steps: [{ count: 0, ids: [recordId] }] };
  assert.equal(renderAutomationPrompt("row={{ event.own.rows.0.id }}; count={{steps.0.count}}; ids={{steps.0.ids}}; flag={{event.own.flag}}; empty={{event.own.empty}}", context),
    `row=${rowId}; count=0; ids=["${recordId}"]; flag=false; empty=null`);
  assert.equal(renderAutomationPrompt("ordinary {braces} and {{other.value}}", context), "ordinary {braces} and {{other.value}}");
  assert.throws(() => renderAutomationPrompt("{{event.secret}}", context));
  assert.throws(() => renderAutomationPrompt("{{steps.1.count}}", context));
});

test("status commands allow clearing the selection as specified by their public input type", () => {
  for (const command of ["setStatus", "moveCard"] as const) {
    assert.deepEqual(parseAutomationCommand(command, { rowId, columnId, statusOptionId: null }), { rowId, columnId, statusOptionId: null });
    assert.throws(() => parseAutomationCommand(command, { rowId, columnId, statusOptionId: 1 }));
  }
});
