#!/usr/bin/env node
import { CREATE_CALENDAR_VIEW_SCHEMA, UPDATE_CALENDAR_VIEW_SCHEMA, QUERY_CALENDAR_VIEW_SCHEMA } from "@tabdo/shared";
import { DOCUMENT_TOOLS, DOCUMENT_SCHEMAS } from "@tabdo/shared";
/**
 * @tabdo/mcp — stdio MCP server
 * Tools map 1:1 to shared COMMANDS via POST /api/commands
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CALENDAR_TOOLS, CALENDAR_SCHEMAS, COLUMN_TYPES, MEMBER_LIST_SCHEMA, BATCH_TOOLS, batchToolResult, RENAME_VIEW_SCHEMA, SET_DEFAULT_VIEW_SCHEMA, UPDATE_BOARD_VIEW_SCHEMA, AUTOMATION_CREATE_SCHEMA, AUTOMATION_UPDATE_SCHEMA, AUTOMATION_LIST_SCHEMA, AUTOMATION_RUN_LIST_SCHEMA } from "@tabdo/shared";
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

const columnType = z.enum(COLUMN_TYPES);

const relationConfig=z.object({targetTableId:z.string().uuid(),limit:z.enum(["one","many"]).optional(),inverseName:z.string().optional(),inverseLimit:z.enum(["one","many"]).optional()});
const rollupConfig=z.object({relationColumnId:z.string().uuid(),targetColumnId:z.string().uuid().optional(),operation:z.enum(["count","sum","average","min","max","earliest","latest"])});
const formulaResultType = z.enum(["auto", "number", "text", "checkbox", "date"]);

const selectOption = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string().optional(),
});

const server = new McpServer({
  name: "tabdo",
  version: "0.1.0",
});

for (const [name, definition] of Object.entries(DOCUMENT_TOOLS)) {
  server.registerTool(name, { description: definition.description, inputSchema: DOCUMENT_SCHEMAS[definition.command].shape }, async (input: Record<string, unknown>) => {
    try { return textResult(await callCommand(definition.command, DOCUMENT_SCHEMAS[definition.command].parse(input))); }
    catch (error) { return { ...textResult({ ok: false, error: { code: error instanceof z.ZodError ? "BAD_INPUT" : (error as { code?: string }).code ?? "REQUEST_FAILED", message: error instanceof Error ? error.message : "Document request failed" } }), isError: true }; }
  });
}
for (const [name, definition] of Object.entries(CALENDAR_TOOLS)) {
  server.registerTool(name, { description: definition.description, inputSchema: CALENDAR_SCHEMAS[definition.command].shape }, async (input: Record<string, unknown>) => {
    try { return textResult(await callCommand(definition.command, CALENDAR_SCHEMAS[definition.command].parse(input))); }
    catch (error) { return { ...textResult({ ok: false, error: { code: (error as { code?: string }).code ?? "REQUEST_FAILED", message: error instanceof Error ? error.message : "Calendar request failed" } }), isError: true }; }
  });
}

server.registerTool("get_workspace", { description: "获取当前工作区与执行成员身份", inputSchema: {} }, async () => textResult(await callCommand("getWorkspace", {})));
server.registerTool("list_members", { description: "查询工作区成员和智能体；支持姓名/邮箱搜索、kind筛选和分页。负责人person填userId；智能体动作agentUserId用kind=agent的userId，不用成员id或姓名。", inputSchema: MEMBER_LIST_SCHEMA.shape }, async input => textResult(await callCommand("listMembers", input)));

for (const [name, definition] of Object.entries(BATCH_TOOLS)) {
  server.registerTool(name, { description: definition.description, inputSchema: definition.schema.shape }, async (input: Record<string, unknown>) => {
    const validated = definition.schema.parse(input);
    return textResult(batchToolResult(name, await callCommand(definition.command, validated)));
  });
}

server.registerTool("create_automation", { description: "创建持续生效的表格事件、Webhook、AgentMail或定时自动化，动作可操作数据或运行指定智能体。一次性新增mock记录用batch_add_rows。", inputSchema: AUTOMATION_CREATE_SCHEMA.shape }, async input => textResult(await callCommand("createAutomation", input)));
server.registerTool("update_automation", { description: "修改已保存自动化的配置、时间计划和动作，或启停。", inputSchema: AUTOMATION_UPDATE_SCHEMA.extend({ automationId: z.string().uuid() }).shape }, async input => textResult(await callCommand("updateAutomation", input)));
server.registerTool("delete_automation", { description: "删除自动化并停止未来触发。", inputSchema: { automationId: z.string().uuid() } }, async input => textResult(await callCommand("deleteAutomation", input)));
server.registerTool("list_automations", { description: "分页列出工作区所有来源自动化，tableId可选筛选。", inputSchema: AUTOMATION_LIST_SCHEMA.shape }, async input => textResult(await callCommand("listAutomations", input)));
server.registerTool("list_automation_runs", { description: "查看工作区自动化执行结果，可按任意来源automationId或tableId筛选，最多200条。", inputSchema: AUTOMATION_RUN_LIST_SCHEMA.shape }, async input => textResult(await callCommand("listAutomationRuns", input)));

server.registerTool("create_calendar_view", { description: "创建表格全天日历映射，起始date必选，结束date、text标题、person可选；endMode inclusive含结束当天/exclusive排他。不是预约防重。", inputSchema: CREATE_CALENDAR_VIEW_SCHEMA.shape }, async (input) => textResult(await callCommand("createCalendarView", input)));
server.registerTool("update_calendar_view", { description: "替换日历字段映射，修复删除或改类型后的映射。", inputSchema: UPDATE_CALENDAR_VIEW_SCHEMA.shape }, async (input) => textResult(await callCommand("updateCalendarView", input)));
server.registerTool("query_calendar_view", { description: "按YYYY-MM-DD的[rangeStart,rangeEnd)查询全天重叠记录，items.end排他，按hasMore/cursor分页。编辑使用update_cells和expectedVersion。", inputSchema: QUERY_CALENDAR_VIEW_SCHEMA.shape }, async (input) => textResult(await callCommand("queryCalendarView", input)));
server.registerTool("rename_view", { description: "重命名表格、看板、表单或日历视图。", inputSchema: RENAME_VIEW_SCHEMA.shape }, async (input) => textResult(await callCommand("renameView", input)));
server.registerTool("set_default_view", { description: "设置表格唯一默认视图。", inputSchema: SET_DEFAULT_VIEW_SCHEMA.shape }, async (input) => textResult(await callCommand("setDefaultView", input)));
server.registerTool("update_board_view", { description: "更新看板显示设置：分组、显示字段及顺序、隐藏空值、宽松或精简密度。标题在顶部，人员和日期在页脚。", inputSchema: UPDATE_BOARD_VIEW_SCHEMA.shape }, async (input) => textResult(await callCommand("updateBoardView", input)));

for(const [name,command] of [["set_relation","setRelation"],["add_relation","addRelation"],["remove_relation","removeRelation"]] as const){
 server.registerTool(name,{description:"按记录ID替换/增量添加/解除关联，不删除记录。set使用版本检查防覆盖。",inputSchema:{rowId:z.string().uuid(),columnId:z.string().uuid(),recordIds:z.array(z.string().uuid()).max(1000),expectedVersion:z.number().int().optional()}},async input=>textResult(await callCommand(command,input)));
}
server.registerTool("query_relation_records",{description:"分页搜索关联候选或读取已关联记录",inputSchema:{columnId:z.string().uuid(),rowId:z.string().uuid().optional(),mode:z.enum(["candidates","related"]).optional(),search:z.string().optional(),cursor:z.string().nullable().optional(),limit:z.number().int().min(1).max(100).optional()}},async input=>textResult(await callCommand("queryRelationRecords",input)));
server.registerTool("get_row",{description:"读取单条记录和字段",inputSchema:{rowId:z.string().uuid()}},async input=>textResult(await callCommand("getRow",input)));

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
      relation:relationConfig.optional(), rollup:rollupConfig.optional(),
      file: z.object({ multiple: z.boolean().optional() }).strict().optional().describe("file字段单/多文件配置，值为已上传文件ID数组"),
      options: z.array(selectOption).optional(),
      formula: z.string().optional().describe("公式表达式，type=formula 时必填"),
      formulaResultType: formulaResultType.optional(),
      width: z.number().optional(),
    },
  },
  async ({ tableId, name, type, options, file, formula, formulaResultType, width, relation, rollup }) =>
    textResult(
      await callCommand("addColumn", {
        tableId,
        name,
        type,
        width,
        config: {
          ...(relation?{relation}:{}), ...(rollup?{rollup}:{}),
          ...(file ? {file} : {}),
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
      file: z.object({ multiple: z.boolean().optional() }).strict().optional().describe("file字段单/多文件配置，值为已上传文件ID数组"),
      options: z.array(selectOption).optional(),
      formula: z.string().optional(),
      formulaResultType: formulaResultType.optional(),
    },
  },
  async ({ columnId, name, type, width, hidden, options, file, formula, formulaResultType }) =>
    textResult(
      await callCommand("updateColumn", {
        columnId,
        name,
        type,
        width,
        hidden,
        config: {
          ...(file ? {file} : {}),
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
    description: "列出表格视图 grid/board/form/calendar（→ listViews）",
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
  "delete_view",
  {
    description: "删除视图；同表至少保留一个（→ deleteView）",
    inputSchema: { viewId: z.string() },
  },
  async ({ viewId }) => textResult(await callCommand("deleteView", { viewId }))
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
