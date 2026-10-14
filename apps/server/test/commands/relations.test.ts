import assert from "node:assert/strict";
import { before, after, test } from "../runtime.js";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
if (!process.env.DATABASE_URL?.endsWith("_agent_test"))
  throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const {
  organization,
  user,
  member,
  columns,
  rowRelations,
  rows,
  automationEvents,
  automationRuns,
  automationStepReceipts,
} = await import("../../src/db/schema.js");
const cmds = await import("../../src/commands/index.js");
const org = randomUUID(),
  foreignOrg = randomUUID();
const owner = randomUUID(), scope = { organizationId: org, actorId: owner };
let customers: string,
  orders: string,
  foreign: string,
  customerTitle: string,
  orderTitle: string,
  amount: string,
  customerCol: string,
  inverseCol: string,
  c1: string,
  c2: string,
  o1: string,
  o2: string,
  sum: string,
  count: string;
before(async () => {
  await db.insert(organization).values([
    { id: org, name: "Relation tests", slug: org },
    { id: foreignOrg, name: "Foreign", slug: foreignOrg },
  ]);
  await db.insert(user).values({ id: owner, name: "Relation fixture owner", email: `${owner}@local.test` });
  await db.insert(member).values({ id: randomUUID(), userId: owner, organizationId: org, role: "owner" });
  customers = (await cmds.createTable({ ...scope, name: "客户" })).id;
  orders = (await cmds.createTable({ ...scope, name: "订单" })).id;
  foreign = (
    await cmds.createTable({ organizationId: foreignOrg, name: "Other" })
  ).id;
  customerTitle = (await cmds.getTable({ ...scope, tableId: customers }))
    .columns[0].id;
  orderTitle = (await cmds.getTable({ ...scope, tableId: orders })).columns[0]
    .id;
  amount = (
    await cmds.addColumn({
      ...scope,
      tableId: orders,
      name: "金额",
      type: "number",
    })
  ).id;
  customerCol = (
    await cmds.addColumn({
      ...scope,
      tableId: orders,
      name: "客户",
      type: "relation",
      config: {
        relation: {
          targetTableId: customers,
          limit: "one",
          inverseName: "订单",
          inverseLimit: "many",
        },
      },
    })
  ).id;
  inverseCol = (
    await cmds.getTable({ ...scope, tableId: customers })
  ).columns.find((c) => c.type === "relation")!.id;
  c1 = (
    await cmds.addRow({
      ...scope,
      tableId: customers,
      cells: { [customerTitle]: "公司一" },
    })
  ).id;
  c2 = (
    await cmds.addRow({
      ...scope,
      tableId: customers,
      cells: { [customerTitle]: "公司二" },
    })
  ).id;
  o1 = (
    await cmds.addRow({
      ...scope,
      tableId: orders,
      cells: { [orderTitle]: "订单一", [amount]: 300, [customerCol]: [c1] },
    })
  ).id;
  o2 = (
    await cmds.addRow({
      ...scope,
      tableId: orders,
      cells: { [orderTitle]: "订单二", [amount]: 500, [customerCol]: [c1] },
    })
  ).id;
  sum = (
    await cmds.addColumn({
      ...scope,
      tableId: customers,
      name: "总额",
      type: "rollup",
      config: {
        rollup: {
          relationColumnId: inverseCol,
          targetColumnId: amount,
          operation: "sum",
        },
      },
    })
  ).id;
  count = (
    await cmds.addColumn({
      ...scope,
      tableId: customers,
      name: "订单数",
      type: "rollup",
      config: { rollup: { relationColumnId: inverseCol, operation: "count" } },
    })
  ).id;
});
after(async () => {
  await db.delete(organization).where(eq(organization.id, org));
  await db.delete(organization).where(eq(organization.id, foreignOrg));
  await db.delete(user).where(eq(user.id, owner));
  await client.end();
});

test("canonical bidirectional relations and live rollups follow changes", async () => {
  let row = await cmds.getRow({ ...scope, rowId: c1 });
  assert.deepEqual(row.cells[inverseCol], [o1, o2].sort());
  assert.equal(row.cells[sum], 800);
  assert.equal(row.cells[count], 2);
  assert.equal(
    row.relations?.[inverseCol].records.find((r) => r.id === o1)?.title,
    "订单一",
  );
  await cmds.updateCell({ ...scope, rowId: o2, columnId: amount, value: 700 });
  row = await cmds.getRow({ ...scope, rowId: c1 });
  assert.equal(row.cells[sum], 1000);
  await cmds.setRelation({
    ...scope,
    rowId: o2,
    columnId: customerCol,
    recordIds: [c2],
  });
  assert.equal((await cmds.getRow({ ...scope, rowId: c1 })).cells[sum], 300);
  assert.equal((await cmds.getRow({ ...scope, rowId: c2 })).cells[sum], 700);
  await cmds.removeRelation({
    ...scope,
    rowId: c2,
    columnId: inverseCol,
    recordIds: [o2],
  });
  assert.deepEqual(
    (await cmds.getRow({ ...scope, rowId: o2 })).cells[customerCol],
    [],
  );
  await cmds.addRelation({
    ...scope,
    rowId: c1,
    columnId: inverseCol,
    recordIds: [o2],
  });
  assert.deepEqual(
    (await cmds.getRow({ ...scope, rowId: o2 })).cells[customerCol],
    [c1],
  );
});
test("incremental concurrency is idempotent and replacement detects stale versions", async () => {
  const r = await cmds.addColumn({
    ...scope,
    tableId: customers,
    name: "同事",
    type: "relation",
    config: { relation: { targetTableId: customers } },
  });
  const records = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      cmds.addRow({
        ...scope,
        tableId: customers,
        cells: { [customerTitle]: `并发${i}` },
      }),
    ),
  );
  await Promise.all(
    records.map((record) =>
      cmds.addRelation({
        ...scope,
        rowId: c1,
        columnId: r.id,
        recordIds: [record.id],
      }),
    ),
  );
  await Promise.all(
    Array.from({ length: 3 }, () =>
      cmds.addRelation({
        ...scope,
        rowId: c1,
        columnId: r.id,
        recordIds: [records[0].id],
      }),
    ),
  );
  const current = await cmds.getRow({ ...scope, rowId: c1 });
  assert.equal((current.cells[r.id] as string[]).length, 4);
  await assert.rejects(
    cmds.setRelation({
      ...scope,
      rowId: c1,
      columnId: r.id,
      recordIds: [],
      expectedVersion: current.version! - 1,
    }),
    /版本冲突/,
  );
});
test("one-record limits, org/table scope and database edge guards are enforced", async () => {
  await assert.rejects(
    cmds.setRelation({
      ...scope,
      rowId: o1,
      columnId: customerCol,
      recordIds: [c1, c2],
    }),
    /最多关联/,
  );
  await assert.rejects(
    cmds.setRelation({
      ...scope,
      rowId: o1,
      columnId: customerCol,
      recordIds: [o2],
    }),
    /目标表格/,
  );
  await assert.rejects(
    cmds.addColumn({
      ...scope,
      tableId: orders,
      name: "bad",
      type: "relation",
      config: { relation: { targetTableId: foreign } },
    }),
    /工作区/,
  );
  const f = (
    await cmds.addRow({ organizationId: foreignOrg, tableId: foreign })
  ).id;
  await assert.rejects(
    cmds.setRelation({
      ...scope,
      rowId: o1,
      columnId: customerCol,
      recordIds: [f],
    }),
    /目标表格/,
  );
  const col = (await cmds.getTable({ ...scope, tableId: orders })).columns.find(
    (c) => c.id === customerCol,
  )!;
  await assert.rejects(
    db.insert(rowRelations).values({
      relationId: col.config.relation!.relationId!,
      sourceRowId: o1,
      targetRowId: o2,
      sourceSingle: false,
      targetSingle: false,
    }),
  );
  await assert.rejects(
    cmds.updateCell({ ...scope, rowId: c1, columnId: sum, value: 3 }),
    /只读/,
  );
  await assert.rejects(
    cmds.addColumn({
      ...scope,
      tableId: customers,
      name: "nested",
      type: "rollup",
      config: {
        rollup: {
          relationColumnId: inverseCol,
          targetColumnId: customerCol,
          operation: "sum",
        },
      },
    }),
    /数字字段/,
  );
});
test("rollup numeric sort, filter and cursor pagination happen before windowing", async () => {
  const first = await cmds.queryRows({
    ...scope,
    tableId: customers,
    limit: 1,
    sort: { columnId: sum, direction: "desc" },
    filters: [{ id: "f", columnId: sum, op: "gt", value: 0 }],
    includeTotal: true,
  });
  assert.equal(first.rows[0].id, c1);
  assert.equal(first.rows[0].cells[sum], 1000);
  assert.equal(first.totalMatched, 1);
  const pages: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await cmds.queryRows({
      ...scope,
      tableId: customers,
      limit: 2,
      cursor,
      sort: { columnId: sum, direction: "asc" },
    });
    pages.push(...page.rows.map((r) => r.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(new Set(pages).size, pages.length);
  assert.equal(pages.length, 6);
  const filtered = await cmds.queryRows({
    ...scope,
    tableId: orders,
    filters: [{ id: "r", columnId: customerCol, op: "contains", value: c1 }],
  });
  assert.equal(filtered.rows.length, 2);
});
test("search and relation expansion page without exposing other tables", async () => {
  const page = await cmds.queryRelationRecords({
    ...scope,
    columnId: inverseCol,
    rowId: c1,
    mode: "related",
    limit: 1,
  });
  assert.equal(page.records.length, 1);
  assert(page.hasMore);
  assert(page.records[0].selected);
  const next = await cmds.queryRelationRecords({
    ...scope,
    columnId: inverseCol,
    rowId: c1,
    mode: "related",
    limit: 1,
    cursor: page.nextCursor,
  });
  assert.notEqual(next.records[0].id, page.records[0].id);
  assert.equal(
    (
      await cmds.queryRelationRecords({
        ...scope,
        columnId: customerCol,
        search: "公司二",
      })
    ).records[0].id,
    c2,
  );
  await assert.rejects(
    cmds.queryRelationRecords({
      ...scope,
      columnId: inverseCol,
      rowId: o1,
      mode: "related",
    }),
    /不属于/,
  );
});
test("dependency deletion is explicit; deleting a record preserves its peers", async () => {
  await assert.rejects(
    cmds.deleteTable({ ...scope, tableId: orders }),
    /关联字段/,
  );
  await assert.rejects(
    cmds.deleteColumn({ ...scope, columnId: amount }),
    /汇总/,
  );
  await assert.rejects(
    cmds.deleteColumn({ ...scope, columnId: customerCol }),
    /汇总/,
  );
  await cmds.deleteRow({ ...scope, rowId: o1 });
  assert.equal((await cmds.getRow({ ...scope, rowId: c1 })).cells[sum], 700);
  await cmds.deleteColumn({ ...scope, columnId: sum });
  await cmds.deleteColumn({ ...scope, columnId: count });
  await cmds.deleteColumn({ ...scope, columnId: customerCol });
  assert.equal(
    (await cmds.getTable({ ...scope, tableId: customers })).columns.some(
      (c) => c.id === inverseCol,
    ),
    false,
  );
});

test("single-direction target deletion updates source version and automation snapshot", async () => {
  const rel = await cmds.addColumn({
    ...scope,
    tableId: orders,
    name: "单向客户",
    type: "relation",
    config: { relation: { targetTableId: customers } },
  });
  const target = await cmds.addRow({
    ...scope,
    tableId: customers,
    cells: { [customerTitle]: "待删除客户" },
  });
  const source = await cmds.addRow({
    ...scope,
    tableId: orders,
    cells: { [rel.id]: [target.id] },
  });
  const flag = await cmds.addColumn({
    ...scope,
    tableId: orders,
    name: "关联已清除",
    type: "checkbox",
  });
  await cmds.createAutomation({
    ...scope,
    tableId: orders,
    name: "删除关联后标记",
    trigger: { type: "field_changed", columnId: rel.id },
    conditions: [{ id: "empty", columnId: rel.id, op: "is_empty" }],
    actions: [{ type: "update_field", columnId: flag.id, value: true }],
  });
  await cmds.deleteRow({ ...scope, rowId: target.id });
  const after = await cmds.getRow({ ...scope, rowId: source.id });
  assert.deepEqual(after.cells[rel.id], []);
  assert.equal(after.version, source.version! + 1);
  const [event] = await db
    .select()
    .from(automationEvents)
    .where(eq(automationEvents.rowId, source.id));
  assert.ok(
    event,
    "Incoming hidden edges still create source field-change events",
  );
  const snap = event.snapshot as {
    event: { before: Record<string, unknown>; after: Record<string, unknown> };
  };
  assert.deepEqual(snap.event.before[rel.id], [target.id]);
  assert.deepEqual(snap.event.after[rel.id], []);
});

test("rollups and membership use all edges beyond preview and pagination limits", async () => {
  const rel = await cmds.addColumn({
    ...scope,
    tableId: customers,
    name: "分页订单",
    type: "relation",
    config: { relation: { targetTableId: orders } },
  });
  const records = await Promise.all(
    Array.from({ length: 35 }, (_, i) =>
      cmds.addRow({
        ...scope,
        tableId: orders,
        cells: { [orderTitle]: `分页订单${i}`, [amount]: i + 1 },
      }),
    ),
  );
  const source = await cmds.addRow({
    ...scope,
    tableId: customers,
    cells: { [rel.id]: records.map((r) => r.id) },
  });
  const rollup = await cmds.addColumn({
    ...scope,
    tableId: customers,
    name: "分页总额",
    type: "rollup",
    config: {
      rollup: {
        relationColumnId: rel.id,
        targetColumnId: amount,
        operation: "sum",
      },
    },
  });
  const hydrated = await cmds.getRow({ ...scope, rowId: source.id });
  assert.equal((hydrated.cells[rel.id] as string[]).length, 20);
  assert.equal(hydrated.relations?.[rel.id].total, 35);
  assert.equal(hydrated.cells[rollup.id], 630);
  const last = records
    .map((r) => r.id)
    .sort()
    .at(-1)!;
  const filtered = await cmds.queryRows({
    ...scope,
    tableId: customers,
    filters: [{ id: "last", columnId: rel.id, op: "contains", value: [last] }],
  });
  assert.ok(filtered.rows.some((r) => r.id === source.id));
  const first = await cmds.queryRelationRecords({
    ...scope,
    columnId: rel.id,
    rowId: source.id,
    mode: "related",
    limit: 20,
  });
  const next = await cmds.queryRelationRecords({
    ...scope,
    columnId: rel.id,
    rowId: source.id,
    mode: "related",
    limit: 20,
    cursor: first.nextCursor,
  });
  assert.equal(first.records.length, 20);
  assert.equal(next.records.length, 15);
  assert.equal(
    new Set([...first.records, ...next.records].map((r) => r.id)).size,
    35,
  );
  const { recomputeAllFormulasForTable } = await import("../../src/commands/formulas.js");
  const formula = await cmds.addColumn({
    ...scope,
    tableId: customers,
    name: "常量公式",
    type: "formula",
    config: { formula: "1 + 1" },
  });
  const before = await cmds.getRow({ ...scope, rowId: source.id });
  assert.equal(before.cells[formula.id], 2);
  assert.equal((await recomputeAllFormulasForTable(customers)).updated, 0);
  const after = await cmds.getRow({ ...scope, rowId: source.id });
  assert.equal(after.version, before.version);
  assert.equal(after.cells[rollup.id], 630);
  const [raw] = await db.select().from(rows).where(eq(rows.id, source.id));
  assert(!Object.hasOwn(raw.cells, rel.id));
  assert(!Object.hasOwn(raw.cells, rollup.id));
});

test("one-to-one concurrent writers cannot bypass reverse limits", async () => {
  const rel = await cmds.addColumn({
    ...scope,
    tableId: orders,
    name: "一对一",
    type: "relation",
    config: {
      relation: {
        targetTableId: customers,
        limit: "one",
        inverseName: "一对一订单",
        inverseLimit: "one",
      },
    },
  });
  const target = await cmds.addRow({ ...scope, tableId: customers });
  const sources = await Promise.all([
    cmds.addRow({ ...scope, tableId: orders }),
    cmds.addRow({ ...scope, tableId: orders }),
  ]);
  const result = await Promise.allSettled(
    sources.map((source) =>
      cmds.addRelation({
        ...scope,
        rowId: source.id,
        columnId: rel.id,
        recordIds: [target.id],
      }),
    ),
  );
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(result.filter((r) => r.status === "rejected").length, 1);
});

test("automation relation writes, inverse changes and receipts commit atomically", async () => {
  const rel = await cmds.addColumn({
    ...scope,
    tableId: orders,
    name: "自动关联",
    type: "relation",
    config: { relation: { targetTableId: customers, inverseName: "自动订单" } },
  });
  const flag = await cmds.addColumn({
    ...scope,
    tableId: orders,
    name: "关联触发器",
    type: "text",
  });
  const target = await cmds.addRow({ ...scope, tableId: customers });
  const source = await cmds.addRow({ ...scope, tableId: orders });
  const rule = await cmds.createAutomation({
    ...scope,
    tableId: orders,
    name: "关联动作",
    trigger: { type: "field_changed", columnId: flag.id },
    actions: [{ type: "update_field", columnId: rel.id, value: [target.id] }],
  });
  await cmds.updateCell({
    ...scope,
    rowId: source.id,
    columnId: flag.id,
    value: "go",
  });
  const [run] = await db
    .select()
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.automationId, rule.id),
        eq(automationRuns.rowId, source.id),
      ),
    );
  assert.ok(run.eventId);
  const { claimExecution, executeNext } = await import(
    "../../src/automation/execution.js"
  );
  const fence = await claimExecution(run.eventId!);
  assert.notEqual(fence, undefined);
  while ((await executeNext(run.eventId!, fence!)) !== "done") {}
  const result = await cmds.getRow({ ...scope, rowId: source.id });
  assert.deepEqual(result.cells[rel.id], [target.id]);
  const inverse = (
    await cmds.getTable({ ...scope, tableId: customers })
  ).columns.find(
    (c) => c.config.relation?.relationId === rel.config.relation?.relationId,
  )!;
  assert.deepEqual(
    (await cmds.getRow({ ...scope, rowId: target.id })).cells[inverse.id],
    [source.id],
  );
  assert.equal(
    (
      await db
        .select()
        .from(automationStepReceipts)
        .where(eq(automationStepReceipts.runId, run.id))
    ).length,
    1,
  );
  assert.equal(await executeNext(run.eventId!, fence!), "done");
  assert.equal(
    (await cmds.getRow({ ...scope, rowId: source.id })).version,
    result.version,
  );
});

test("all numeric/date rollups handle values, empties and date conditions consistently", async () => {
  const date = await cmds.addColumn({
    ...scope,
    tableId: orders,
    name: "日期汇总目标",
    type: "date",
  });
  const rel = await cmds.addColumn({
    ...scope,
    tableId: customers,
    name: "汇总类型检查",
    type: "relation",
    config: { relation: { targetTableId: orders } },
  });
  const targets = await Promise.all([
    cmds.addRow({
      ...scope,
      tableId: orders,
      cells: { [amount]: 10, [date.id]: "2026-10-01" },
    }),
    cmds.addRow({
      ...scope,
      tableId: orders,
      cells: { [amount]: 30, [date.id]: "2026-10-12" },
    }),
    cmds.addRow({ ...scope, tableId: orders }),
  ]);
  const source = await cmds.addRow({
    ...scope,
    tableId: customers,
    cells: { [rel.id]: targets.map((r) => r.id) },
  });
  const empty = await cmds.addRow({ ...scope, tableId: customers });
  const expected = {
    sum: 40,
    average: 20,
    min: 10,
    max: 30,
    earliest: "2026-10-01",
    latest: "2026-10-12",
  } as const;
  const defs = [];
  for (const operation of Object.keys(expected) as (keyof typeof expected)[])
    defs.push(
      await cmds.addColumn({
        ...scope,
        tableId: customers,
        name: operation,
        type: "rollup",
        config: {
          rollup: {
            relationColumnId: rel.id,
            targetColumnId:
              operation === "earliest" || operation === "latest"
                ? date.id
                : amount,
            operation,
          },
        },
      }),
    );
  const result = await cmds.getRow({ ...scope, rowId: source.id }),
    none = await cmds.getRow({ ...scope, rowId: empty.id });
  for (const def of defs) {
    assert.equal(
      result.cells[def.id],
      expected[def.config.rollup!.operation as keyof typeof expected],
    );
    assert.equal(
      none.cells[def.id],
      def.config.rollup!.operation === "sum" ? 0 : null,
    );
  }
  const latest = defs.find((c) => c.config.rollup!.operation === "latest")!;
  const filters = [
    {
      id: "date",
      columnId: latest.id,
      op: "gte" as const,
      value: "2026-10-10",
    },
  ];
  assert.equal(
    (await cmds.queryRows({ ...scope, tableId: customers, filters })).rows.find(
      (r) => r.id === source.id,
    )?.cells[latest.id],
    "2026-10-12",
  );
  const { applyFilters } = await import("@tabdo/shared");
  assert.equal(
    applyFilters(
      [result],
      (await cmds.getTable({ ...scope, tableId: customers })).columns,
      { filters },
    ).length,
    1,
  );
});

test("100k target records remain windowed with stable candidate pagination", async () => {
  const target = await cmds.createTable({ ...scope, name: "十万行关联候选" });
  const title = (await cmds.getTable({ ...scope, tableId: target.id }))
    .columns[0];
  await db.execute(
    sql`INSERT INTO rows (table_id,cells,sort_order) SELECT ${target.id}::uuid,jsonb_build_object(${title.id}::text,'候选' || n::text),n FROM generate_series(1,100000) n`,
  );
  const rel = await cmds.addColumn({
    ...scope,
    tableId: customers,
    name: "大表候选",
    type: "relation",
    config: { relation: { targetTableId: target.id } },
  });
  const first = await cmds.queryRelationRecords({
    ...scope,
    columnId: rel.id,
    limit: 30,
  });
  const next = await cmds.queryRelationRecords({
    ...scope,
    columnId: rel.id,
    limit: 30,
    cursor: first.nextCursor,
  });
  assert.equal(first.records.length, 30);
  assert.equal(next.records.length, 30);
  assert(first.hasMore && next.hasMore);
  assert.equal(first.records[0].title, "候选1");
  assert.equal(next.records[0].title, "候选31");
  assert.equal(
    new Set([...first.records, ...next.records].map((r) => r.id)).size,
    60,
  );
  const page = await cmds.queryRows({
    ...scope,
    tableId: target.id,
    limit: 50,
    includeTotal: true,
  });
  assert.equal(page.rows.length, 50);
  assert.equal(page.totalMatched, 100000);
});
