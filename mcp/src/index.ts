#!/usr/bin/env node
/**
 * @table/mcp — stdio MCP server
 * Tools map 1:1 to shared COMMANDS via POST /api/commands
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callCommand, textResult } from "./client.js";

const cellValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

const filterOp = z.enum([
  "eq",
  "neq",
  "contains",
  "not_contains",
  "is_empty",
  "is_not_empty",
  "gt",
  "gte",
  "lt",
  "lte",
]);

const columnType = z.enum([
  "text",
  "number",
  "select",
  "multi_select",
  "date",
  "checkbox",
  "person",
  "formula",
]);

const formulaResultType = z.enum(["auto", "number", "text", "checkbox", "date"]);

const selectOption = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string().optional(),
});

const server = new McpServer({
  name: "table",
  version: "0.1.0",
});

server.registerTool(
  "list_tables",
  { description: "列出所有多维表格（→ listTables）" },
  async () => textResult(await callCommand("listTables", {}))
);

server.registerTool(
  "get_table",
  {
    description:
      "获取表格 schema + rowCount，默认不含行。行请用 query_rows（→ getTable）",
    inputSchema: { tableId: z.string().describe("表格 ID") },
  },
  async ({ tableId }) =>
    textResult(
      await callCommand("getTable", { tableId, includeFirstPage: false })
    )
);

server.registerTool(
  "query_rows",
  {
    description:
      "Keyset 窗口查询行（禁止全表）。limit 建议 ≤200（→ queryRows）",
    inputSchema: {
      tableId: z.string(),
      filters: z
        .array(
          z.object({
            id: z.string().optional(),
            columnId: z.string(),
            op: filterOp,
            value: cellValue.optional(),
          })
        )
        .optional(),
      filterLogic: z.enum(["and", "or"]).optional(),
      sort: z
        .object({
          columnId: z.string(),
          direction: z.enum(["asc", "desc"]),
        })
        .nullable()
        .optional(),
      cursor: z.string().nullable().optional(),
      limit: z.number().int().positive().max(500).optional(),
      includeTotal: z.boolean().optional(),
      statusColumnId: z.string().optional(),
      statusValue: z.string().nullable().optional(),
    },
  },
  async (input) => {
    const filters = (input.filters ?? []).map((f, i) => ({
      id: f.id ?? `t${i}`,
      columnId: f.columnId,
      op: f.op,
      value: f.value ?? null,
    }));
    return textResult(
      await callCommand("queryRows", {
        ...input,
        filters,
        cursor: input.cursor ?? null,
        sort: input.sort ?? null,
      })
    );
  }
);

server.registerTool(
  "update_cell",
  {
    description: "更新单个单元格。select 列传选项 id；公式列只读不可写（→ updateCell）",
    inputSchema: {
      rowId: z.string(),
      columnId: z.string(),
      value: cellValue,
      expectedVersion: z.number().int().optional(),
    },
  },
  async (input) => textResult(await callCommand("updateCell", input))
);

server.registerTool(
  "update_cells",
  {
    description: "批量更新同一行多个单元格（→ updateCells）",
    inputSchema: {
      rowId: z.string(),
      cells: z.record(z.string(), cellValue),
      expectedVersion: z.number().int().optional(),
    },
  },
  async (input) => textResult(await callCommand("updateCells", input))
);

server.registerTool(
  "add_row",
  {
    description: "新增一行（→ addRow）",
    inputSchema: {
      tableId: z.string(),
      cells: z.record(z.string(), cellValue).optional(),
    },
  },
  async (input) => textResult(await callCommand("addRow", input))
);

server.registerTool(
  "delete_row",
  {
    description: "删除一行（→ deleteRow）",
    inputSchema: { rowId: z.string() },
  },
  async (input) => textResult(await callCommand("deleteRow", input))
);

server.registerTool(
  "add_column",
  {
    description:
      "新增一列（→ addColumn）。公式列传 type=formula + formula 表达式，如 {预估工时}*8。公式列只读。",
    inputSchema: {
      tableId: z.string(),
      name: z.string().min(1),
      type: columnType,
      options: z.array(selectOption).optional(),
      formula: z.string().optional().describe("公式表达式，type=formula 时必填"),
      formulaResultType: formulaResultType.optional(),
      width: z.number().optional(),
    },
  },
  async ({ tableId, name, type, options, formula, formulaResultType, width }) =>
    textResult(
      await callCommand("addColumn", {
        tableId,
        name,
        type,
        width,
        config: {
          ...(options ? { options } : {}),
          ...(formula !== undefined ? { formula, formulaResultType: formulaResultType ?? "auto" } : {}),
        },
      })
    )
);

server.registerTool(
  "delete_column",
  {
    description: "删除一列（→ deleteColumn）",
    inputSchema: { columnId: z.string() },
  },
  async (input) => textResult(await callCommand("deleteColumn", input))
);

server.registerTool(
  "update_column",
  {
    description:
      "更新列名/类型/宽度/隐藏/选项/公式（→ updateColumn）。改公式会重算全表该列。",
    inputSchema: {
      columnId: z.string(),
      name: z.string().optional(),
      type: columnType.optional(),
      width: z.number().optional(),
      hidden: z.boolean().optional(),
      options: z.array(selectOption).optional(),
      formula: z.string().optional(),
      formulaResultType: formulaResultType.optional(),
    },
  },
  async ({ columnId, name, type, width, hidden, options, formula, formulaResultType }) =>
    textResult(
      await callCommand("updateColumn", {
        columnId,
        name,
        type,
        width,
        hidden,
        config: {
          ...(options ? { options } : {}),
          ...(formula !== undefined ? { formula } : {}),
          ...(formulaResultType !== undefined ? { formulaResultType } : {}),
        },
      })
    )
);

server.registerTool(
  "reorder_columns",
  {
    description: "按 columnIds 重排列（→ reorderColumns）",
    inputSchema: {
      tableId: z.string(),
      columnIds: z.array(z.string()),
    },
  },
  async (input) => textResult(await callCommand("reorderColumns", input))
);

server.registerTool(
  "set_status",
  {
    description: "看板移动：设置 select 列选项 id（→ setStatus）",
    inputSchema: {
      rowId: z.string(),
      columnId: z.string(),
      statusOptionId: z.string().nullable(),
    },
  },
  async (input) => textResult(await callCommand("setStatus", input))
);

server.registerTool(
  "move_card",
  {
    description: "看板拖拽等价（→ moveCard，与 set_status 同义）",
    inputSchema: {
      rowId: z.string(),
      columnId: z.string(),
      statusOptionId: z.string().nullable(),
    },
  },
  async (input) => textResult(await callCommand("moveCard", input))
);


server.registerTool(
  "list_views",
  {
    description: "列出表格视图 grid/board/form（→ listViews）",
    inputSchema: { tableId: z.string() },
  },
  async ({ tableId }) => textResult(await callCommand("listViews", { tableId }))
);

server.registerTool(
  "get_view",
  {
    description: "获取视图；form 含 resolvedFields（→ getView）",
    inputSchema: { viewId: z.string() },
  },
  async ({ viewId }) => textResult(await callCommand("getView", { viewId }))
);

server.registerTool(
  "create_form_view",
  {
    description: "创建表单视图，同一数据集（→ createFormView）",
    inputSchema: {
      tableId: z.string(),
      name: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      submitLabel: z.string().optional(),
      fields: z
        .array(
          z.object({
            columnId: z.string(),
            label: z.string().optional(),
            helpText: z.string().optional(),
            required: z.boolean().optional(),
            hidden: z.boolean().optional(),
            readOnly: z.boolean().optional(),
          })
        )
        .optional(),
    },
  },
  async ({ tableId, name, title, description, submitLabel, fields }) =>
    textResult(
      await callCommand("createFormView", {
        tableId,
        name: name ?? title,
        fields,
        config: { title, description, submitLabel, mode: "create" },
      })
    )
);

server.registerTool(
  "update_form_view",
  {
    description: "更新表单视图元数据（→ updateFormView）",
    inputSchema: {
      viewId: z.string(),
      name: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      submitLabel: z.string().optional(),
      successMessage: z.string().optional(),
    },
  },
  async ({ viewId, name, title, description, submitLabel, successMessage }) =>
    textResult(
      await callCommand("updateFormView", {
        viewId,
        name,
        config: { title, description, submitLabel, successMessage },
      })
    )
);

server.registerTool(
  "set_form_fields",
  {
    description: "替换表单字段布局（→ setFormFields）",
    inputSchema: {
      viewId: z.string(),
      fields: z.array(
        z.object({
          columnId: z.string(),
          label: z.string().optional(),
          helpText: z.string().optional(),
          required: z.boolean().optional(),
          hidden: z.boolean().optional(),
          readOnly: z.boolean().optional(),
        })
      ),
    },
  },
  async (input) => textResult(await callCommand("setFormFields", input))
);

server.registerTool(
  "add_form_field",
  {
    description: "向表单追加已有列（→ addFormField）",
    inputSchema: {
      viewId: z.string(),
      columnId: z.string(),
      label: z.string().optional(),
      required: z.boolean().optional(),
    },
  },
  async ({ viewId, columnId, label, required }) =>
    textResult(
      await callCommand("addFormField", {
        viewId,
        field: { columnId, label, required },
      })
    )
);

server.registerTool(
  "remove_form_field",
  {
    description: "从表单布局移除字段，不删列（→ removeFormField）",
    inputSchema: { viewId: z.string(), columnId: z.string() },
  },
  async (input) => textResult(await callCommand("removeFormField", input))
);

server.registerTool(
  "reorder_form_fields",
  {
    description: "重排表单字段（→ reorderFormFields）",
    inputSchema: {
      viewId: z.string(),
      columnIds: z.array(z.string()),
    },
  },
  async (input) => textResult(await callCommand("reorderFormFields", input))
);


async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
