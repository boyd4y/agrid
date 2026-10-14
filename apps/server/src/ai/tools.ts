import { getToolTransaction } from "./execution-context.js";
import { MEMBER_LIST_SCHEMA } from "@tabdo/shared";
import { createBatchTools } from "./batch-tools.js";
import { RENAME_VIEW_SCHEMA, SET_DEFAULT_VIEW_SCHEMA, UPDATE_BOARD_VIEW_SCHEMA, BOARD_VIEW_CONFIG_SCHEMA, AUTOMATION_CREATE_SCHEMA, AUTOMATION_UPDATE_SCHEMA, AUTOMATION_LIST_SCHEMA, AUTOMATION_RUN_LIST_SCHEMA } from "@tabdo/shared";
import { createReportTools } from "./report-tools.js";
import { relationConfigSchema, rollupConfigSchema } from "../commands/relations.js";
import { tool, zodSchema } from "ai";
import { z } from "zod";
import { COLUMN_TYPES } from "../db/schema.js";
import * as cmds from "../commands/index.js";
import {
  AGENT_DEFAULT_PAGE_SIZE,
  AGENT_MAX_PAGE_SIZE,
  clampLimit,
  FILTER_OPS,
} from "@tabdo/shared";

const cellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

const relationRecordSchema = z.strictObject({
  rowId: z.string().uuid().describe("源记录 UUID，使用 query_rows 获取"),
  columnId: z.string().uuid().describe("已存在的关联字段 UUID，使用 get_table 获取；不能传字段名称"),
  recordIds: z.array(z.string().uuid()).max(1000).describe("目标表记录 UUID 数组，使用 query_relation_records / query_rows 获取"),
});

/** AI tools mirror the shared command layer — row reads are ALWAYS windowed */
export function createTableTools(
  defaultTableId?: string,
  organizationId?: string,
  actorId?: string
): any {
  const org = { organizationId, actorId };
  const tableIdOrDefault = (tableId?: string) => {
    const id = tableId || defaultTableId;
    if (!id) throw new Error("请先指定表格；使用 list_tables 查找表格 ID。");
    return id;
  };
  return {
    ...createReportTools(organizationId),
    ...createBatchTools(defaultTableId, organizationId, actorId),
    get_row: tool({description:"读取单条记录及字段，关联标签仅返回前20条，其余用 query_relation_records 分页。",inputSchema:zodSchema(z.object({rowId:z.string().uuid()})),execute:async input=>cmds.getRow({...input,...org}, getToolTransaction())}),
    query_relation_records: tool({description:"搜索关联字段的候选记录，或 mode=related 分页查看已关联记录。必须使用记录ID，不能把名称当ID。",inputSchema:zodSchema(z.object({columnId:z.string().uuid(),rowId:z.string().uuid().optional(),mode:z.enum(["candidates","related"]).optional(),search:z.string().optional(),cursor:z.string().nullable().optional(),limit:z.number().int().min(1).max(100).optional()})),execute:async input=>cmds.queryRelationRecords({...input,...org}, getToolTransaction())}),
    set_relation: tool({description:"整体替换已有关联字段中的目标记录。此工具不创建字段；创建关联字段用 add_column(type=relation, relation={targetTableId,...})。传 expectedVersion 防止覆盖并发修改。清空传 recordIds=[]，不删除记录。",inputSchema:zodSchema(relationRecordSchema.extend({expectedVersion:z.number().int().optional()})),execute:async input=>cmds.setRelation({...input,...org}, getToolTransaction())}),
    add_relation: tool({description:"向已有的关联字段增量添加目标记录，幂等，不覆盖其他并发添加。此工具不创建关联字段或表格关系定义；创建单双向字段用 add_column(type=relation, relation={targetTableId,inverseName,...})。需要实际字段 UUID 和目标记录 UUID 数组。",inputSchema:zodSchema(relationRecordSchema),execute:async input=>cmds.addRelation({...input,...org}, getToolTransaction())}),
    remove_relation: tool({description:"从已有关联字段增量解除指定记录，不删除目标记录，也不删除关联字段。",inputSchema:zodSchema(relationRecordSchema),execute:async input=>cmds.removeRelation({...input,...org}, getToolTransaction())}),
    get_workspace: tool({
      description: "获取当前工作区名称和当前执行成员身份。工作区范围由服务器确定。",
      inputSchema: zodSchema(z.strictObject({})),
      execute: async () => cmds.getWorkspace(org, getToolTransaction()),
    }),
    list_members: tool({
      description: "查询当前工作区成员与智能体，可按姓名/邮箱搜索、kind=human或agent筛选并分页。分配负责人前先查询；person字段填返回的userId，不要填姓名或成员id。智能体动作agentUserId使用kind=agent的userId。",
      inputSchema: zodSchema(MEMBER_LIST_SCHEMA),
      execute: async input => cmds.listMembers({ ...input, ...org }, getToolTransaction()),
    }),
    list_tables: tool({
      description: "列出当前工作区的多维表格",
      inputSchema: zodSchema(z.object({})),
      execute: async () => cmds.listTables(org, getToolTransaction()),
    }),

    create_table: tool({
      description: "在当前工作区创建表格（默认包含标题列），随后使用 add_column 配置字段。",
      inputSchema: zodSchema(z.object({ name: z.string().min(1).max(200), description: z.string().optional() })),
      execute: async (input) => {
        if (!organizationId) throw new Error("缺少工作区上下文");
        return cmds.createTable({ ...input, organizationId }, getToolTransaction());
      },
    }),

    list_automations: tool({
      description: "列出当前工作区的所有来源自动化，包括表格、邮件、Webhook和定时；tableId可选以筛选指定表格，按offset分页，每页最多100条。",
      inputSchema: zodSchema(AUTOMATION_LIST_SCHEMA),
      execute: async input => cmds.listAutomations({ ...input, ...org }, getToolTransaction()),
    }),
    create_automation: tool({
      description: "创建持续生效的自动化：表格变更、Webhook、已接入的AgentMail邮箱或定时计划，执行数据命令或指定智能体任务。一次性mock/导入用batch_add_rows。来源必须实际配置；先get_table取得字段ID。智能体动作必须选真实agentUserId+prompt。",
      inputSchema: zodSchema(AUTOMATION_CREATE_SCHEMA),
      execute: async input => cmds.createAutomation({ ...input, ...(input.source ? {} : { tableId: tableIdOrDefault(input.tableId) }), ...org }, getToolTransaction()),
    }),
    update_automation: tool({
      description: "修改自动化条件、数据动作、智能体任务或时间计划；enabled控制启用。",
      inputSchema: zodSchema(AUTOMATION_UPDATE_SCHEMA.extend({ automationId: z.string().uuid() })),
      execute: async input => cmds.updateAutomation({ ...input, ...org }, getToolTransaction()),
    }),
    delete_automation: tool({
      description: "删除自动化规则并停止后续执行。",
      inputSchema: zodSchema(z.object({ automationId: z.string().uuid() })),
      execute: async (input) => cmds.deleteAutomation({ ...input, ...org }, getToolTransaction()),
    }),
    list_automation_runs: tool({
      description: "查看当前工作区的自动化执行记录和失败原因，可按automationId查询任意来源规则，或按tableId筛选；最多200条。",
      inputSchema: zodSchema(AUTOMATION_RUN_LIST_SCHEMA),
      execute: async input => cmds.listAutomationRuns({ ...input, ...org }, getToolTransaction()),
    }),

    get_table: tool({
      description:
        "获取表格元数据 + 列定义 + rowCount（不含行数据）。操作前先调用以拿到 columnId / 状态选项 id。行数据请用 query_rows 窗口拉取。",
      inputSchema: zodSchema(
        z.object({
          tableId: z.string().uuid().describe("表格 ID"),
        })
      ),
      execute: async ({ tableId }) => {
        const t = await cmds.getTable({ tableId, includeFirstPage: false, ...org }, getToolTransaction());
        // Explicitly strip any rows to keep agent payloads small
        return {
          id: t.id,
          name: t.name,
          description: t.description,
          rowCount: t.rowCount,
          columns: t.columns,
          rows: [],
        };
      },
    }),

    update_cell: tool({
      description: "更新单个单元格（单格 patch）。select 列请传选项 id（不是 label）。公式列只读，不可写入。",
      inputSchema: zodSchema(
        z.object({
          rowId: z.string().uuid(),
          columnId: z.string().uuid(),
          value: cellValueSchema,
          expectedVersion: z.number().int().optional(),
        })
      ),
      execute: async (input) => cmds.updateCell({ ...input, ...org }, getToolTransaction()),
    }),

    update_cells: tool({
      description: "批量更新同一行的多个单元格",
      inputSchema: zodSchema(
        z.object({
          rowId: z.string().uuid(),
          cells: z.record(z.string(), cellValueSchema),
          expectedVersion: z.number().int().optional(),
        })
      ),
      execute: async (input) => cmds.updateCells({ ...input, ...org }, getToolTransaction()),
    }),

    add_row: tool({
      description: "新增单条记录，可带初始单元格值。一次性新增多条或mock数据使用batch_add_rows。",
      inputSchema: zodSchema(
        z.object({
          tableId: z.string().uuid().optional().describe("默认用当前打开的表"),
          cells: z.record(z.string(), cellValueSchema).optional(),
        })
      ),
      execute: async ({ tableId, cells }) => {
        const id = tableId || defaultTableId;
        if (!id) throw new Error("缺少 tableId");
        return cmds.addRow({ tableId: id, cells, ...org }, getToolTransaction());
      },
    }),

    delete_row: tool({
      description: "删除一行",
      inputSchema: zodSchema(z.object({ rowId: z.string().uuid() })),
      execute: async ({ rowId }) => cmds.deleteRow({ rowId, ...org }, getToolTransaction()),
    }),

    add_column: tool({
      description:
        "新增一列。关联列传 relation 配置，可指定 inverseName 创建双向字段。汇总列传 rollup 配置。公式列：type=formula，传 formula 如 {预估工时}*8。公式列只读，改依赖列会自动重算。",
      inputSchema: zodSchema(
        z.object({
          tableId: z.string().uuid().optional(),
          name: z.string().min(1),
          type: z.enum(COLUMN_TYPES),
          file: z.object({ multiple: z.boolean().optional() }).strict().optional().describe("type=file：multiple=false仅允许单文件；文件值为已上传文件ID数组"),
          options: z
            .array(
              z.object({
                id: z.string(),
                label: z.string(),
                color: z.string().optional(),
              })
            )
            .optional()
            .describe("select / multi_select 的选项"),
          relation: relationConfigSchema.optional().describe("type=relation：目标表、单条/多条、可选反向字段名"),
          rollup: rollupConfigSchema.optional().describe("type=rollup：本表关联字段、目标字段和聚合方式；只读，不支持嵌套汇总"),
          formula: z.string().optional().describe("公式表达式，type=formula 时必填"),
          formulaResultType: z
            .enum(["auto", "number", "text", "checkbox", "date"])
            .optional(),
        })
      ),
      execute: async ({ tableId, name, type, options, file, formula, formulaResultType, relation, rollup }) => {
        const id = tableId || defaultTableId;
        if (!id) throw new Error("缺少 tableId");
        return cmds.addColumn({
          tableId: id,
          name,
          type,
          config: {
            ...(relation ? {relation} : {}), ...(rollup ? {rollup} : {}),
            ...(file ? { file } : {}),
            ...(options ? { options } : {}),
            ...(formula !== undefined
              ? { formula, formulaResultType: formulaResultType ?? "auto" }
              : {}),
          },
          ...org,
        }, getToolTransaction());
      },
    }),

    delete_column: tool({
      description: "删除一列",
      inputSchema: zodSchema(z.object({ columnId: z.string().uuid() })),
      execute: async ({ columnId }) => cmds.deleteColumn({ columnId, ...org }, getToolTransaction()),
    }),

    set_status: tool({
      description:
        "看板移动：把某行的状态/单选列设为指定选项 id（或 null 表示未分组）。与 move_card 相同。",
      inputSchema: zodSchema(
        z.object({
          rowId: z.string().uuid(),
          columnId: z.string().uuid().describe("状态/单选列 ID"),
          statusOptionId: z.string().nullable().describe("选项 id，如 todo/doing/done"),
        })
      ),
      execute: async (input) => cmds.setStatus({ ...input, ...org }, getToolTransaction()),
    }),

    move_card: tool({
      description: "看板拖拽等价操作：移动卡片到另一状态列",
      inputSchema: zodSchema(
        z.object({
          rowId: z.string().uuid(),
          columnId: z.string().uuid(),
          statusOptionId: z.string().nullable(),
        })
      ),
      execute: async (input) => cmds.moveCard({ ...input, ...org }, getToolTransaction()),
    }),

    query_rows: tool({
      description:
        "窗口查询行（keyset 游标，禁止全表）。limit 默认 50、最大 200。返回 rows + nextCursor + hasMore。看板某列用 statusColumnId + statusValue。翻页传上一页的 nextCursor。",
      inputSchema: zodSchema(
        z.object({
          tableId: z.string().uuid(),
          filters: z
            .array(
              z.object({
                id: z.string().optional(),
                columnId: z.string().uuid(),
                op: z.enum([
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
                ]),
                value: cellValueSchema.optional(),
              })
            )
            .optional(),
          filterLogic: z.enum(["and", "or"]).optional(),
          sort: z
            .object({
              columnId: z.string().uuid(),
              direction: z.enum(["asc", "desc"]),
            })
            .nullable()
            .optional(),
          cursor: z.string().nullable().optional(),
          limit: z.number().int().positive().max(AGENT_MAX_PAGE_SIZE).optional(),
          includeTotal: z.boolean().optional(),
          statusColumnId: z.string().uuid().optional(),
          statusValue: z.string().nullable().optional(),
        })
      ),
      execute: async (input) => {
        const limit = clampLimit(
          input.limit,
          AGENT_DEFAULT_PAGE_SIZE,
          AGENT_MAX_PAGE_SIZE
        );
        return cmds.queryRows({
          tableId: input.tableId,
          filters: (input.filters ?? []).map((f, i) => ({
            id: f.id ?? `t${i}`,
            columnId: f.columnId,
            op: f.op,
            value: f.value ?? null,
          })),
          filterLogic: input.filterLogic,
          sort: input.sort ?? null,
          cursor: input.cursor ?? null,
          limit,
          includeTotal: input.includeTotal ?? false,
          statusColumnId: input.statusColumnId,
          statusValue: input.statusValue,
          ...org,
        }, getToolTransaction());
      },
    }),

    update_column: tool({
      description:
        "更新列：改名、改类型、改宽度、隐藏、select 选项、或公式表达式。改公式会重算全表。",
      inputSchema: zodSchema(
        z.object({
          columnId: z.string().uuid(),
          name: z.string().optional(),
          type: z.enum(COLUMN_TYPES).optional(),
          width: z.number().optional(),
          hidden: z.boolean().optional(),
          file: z.object({ multiple: z.boolean().optional() }).strict().optional().describe("type=file：multiple=false仅允许单文件；文件值为已上传文件ID数组"),
          options: z
            .array(
              z.object({
                id: z.string(),
                label: z.string(),
                color: z.string().optional(),
              })
            )
            .optional(),
          formula: z.string().optional(),
          formulaResultType: z
            .enum(["auto", "number", "text", "checkbox", "date"])
            .optional(),
        })
      ),
      execute: async ({
        columnId,
        name,
        type,
        width,
        hidden,
        options,
        file,
        formula,
        formulaResultType,
      }) =>
        cmds.updateColumn({
          columnId,
          name,
          type,
          width,
          hidden,
          config: {
            ...(file ? { file } : {}),
            ...(options ? { options } : {}),
            ...(formula !== undefined ? { formula } : {}),
            ...(formulaResultType !== undefined ? { formulaResultType } : {}),
          },
          ...org,
        }, getToolTransaction()),
    }),

    reorder_columns: tool({
      description: "按 columnIds 顺序重排列",
      inputSchema: zodSchema(
        z.object({
          tableId: z.string().uuid(),
          columnIds: z.array(z.string().uuid()),
        })
      ),
      execute: async (input) => cmds.reorderColumns({ ...input, ...org }, getToolTransaction()),
    }),

    open_preview: tool({
      description:
        "切换右侧工作面板并展示内容。面板默认打开，可手动收起。kind=table|form|automations；form 时可传 viewId。",
      inputSchema: zodSchema(
        z.object({
          kind: z
            .string()
            .optional()
            .describe("工作面板种类：table、form 或 automations，默认 table"),
          tableId: z
            .string()
            .uuid()
            .optional()
            .describe("要预览的表格 ID；省略则用当前绑定表"),
          viewId: z
            .string()
            .uuid()
            .optional()
            .describe("表单视图 ID（kind=form 时）"),
          open: z
            .boolean()
            .optional()
            .describe("true 打开（默认），false 关闭"),
        })
      ),
      execute: async ({ kind, tableId, viewId, open }) => {
        let id = tableId || defaultTableId || null;
        if (open !== false && viewId) {
          const view = await cmds.getView({ viewId, ...org }, getToolTransaction());
          if (id && id !== view.tableId) throw new Error("视图不属于指定的表格");
          id = view.tableId;
        }
        if (open !== false && id) await cmds.getTable({ tableId: id, includeFirstPage: false, ...org }, getToolTransaction());
        return {
          ok: true,
          open: open !== false,
          kind: kind || "table",
          tableId: id,
          viewId: viewId ?? null,
        };
      },
    }),

    list_views: tool({
      description: "列出表格的视图（grid/board/form）",
      inputSchema: zodSchema(z.object({ tableId: z.string().uuid() })),
      execute: async ({ tableId }) => cmds.listViews({ tableId, ...org }, getToolTransaction()),
    }),

    get_view: tool({
      description: "获取视图详情；form 视图会带 resolvedFields",
      inputSchema: zodSchema(z.object({ viewId: z.string().uuid() })),
      execute: async ({ viewId }) => cmds.getView({ viewId, ...org }, getToolTransaction()),
    }),

    create_form_view: tool({
      description:
        "为表格创建表单视图（同一数据集）。不传 fields 则包含全部可写列。创建后可用 open_preview kind=form 打开预览。",
      inputSchema: zodSchema(
        z.object({
          tableId: z.string().uuid().optional(),
          name: z.string().optional(),
          title: z.string().optional(),
          description: z.string().optional(),
          submitLabel: z.string().optional(),
          successMessage: z.string().optional(),
          fields: z
            .array(
              z.object({
                columnId: z.string().uuid(),
                label: z.string().optional(),
                helpText: z.string().optional(),
                placeholder: z.string().optional(),
                required: z.boolean().optional(),
                hidden: z.boolean().optional(),
                readOnly: z.boolean().optional(),
              })
            )
            .optional(),
        })
      ),
      execute: async ({ tableId, name, title, description, submitLabel, successMessage, fields }) => {
        const id = tableId || defaultTableId;
        if (!id) throw new Error("缺少 tableId");
        return cmds.createFormView({
          tableId: id,
          name: name ?? title,
          config: { title, description, submitLabel, successMessage, mode: "create" },
          fields,
          ...org,
        }, getToolTransaction());
      },
    }),

    update_form_view: tool({
      description: "更新表单视图名称/标题/描述/提交文案等",
      inputSchema: zodSchema(
        z.object({
          viewId: z.string().uuid(),
          name: z.string().optional(),
          title: z.string().optional(),
          description: z.string().optional(),
          submitLabel: z.string().optional(),
          successMessage: z.string().optional(),
          mode: z.enum(["create", "edit"]).optional(),
        })
      ),
      execute: async ({ viewId, name, title, description, submitLabel, successMessage, mode }) =>
        cmds.updateFormView({
          viewId,
          name,
          config: { title, description, submitLabel, successMessage, mode },
          ...org,
        }, getToolTransaction()),
    }),

    set_form_fields: tool({
      description: "替换表单字段布局（顺序、必填、标签）。不删除底层列。",
      inputSchema: zodSchema(
        z.object({
          viewId: z.string().uuid(),
          fields: z.array(
            z.object({
              columnId: z.string().uuid(),
              label: z.string().optional(),
              helpText: z.string().optional(),
              placeholder: z.string().optional(),
              required: z.boolean().optional(),
              hidden: z.boolean().optional(),
              readOnly: z.boolean().optional(),
            })
          ),
        })
      ),
      execute: async (input) => cmds.setFormFields({ ...input, ...org }, getToolTransaction()),
    }),

    add_form_field: tool({
      description: "向表单追加一个已有列（不新建列）",
      inputSchema: zodSchema(
        z.object({
          viewId: z.string().uuid(),
          columnId: z.string().uuid(),
          label: z.string().optional(),
          helpText: z.string().optional(),
          required: z.boolean().optional(),
        })
      ),
      execute: async ({ viewId, columnId, label, helpText, required }) =>
        cmds.addFormField({
          viewId,
          field: { columnId, label, helpText, required },
          ...org,
        }, getToolTransaction()),
    }),

    remove_form_field: tool({
      description: "从表单布局移除字段（不删除列）",
      inputSchema: zodSchema(
        z.object({
          viewId: z.string().uuid(),
          columnId: z.string().uuid(),
        })
      ),
      execute: async (input) => cmds.removeFormField({ ...input, ...org }, getToolTransaction()),
    }),

    reorder_form_fields: tool({
      description: "按 columnIds 重排表单字段",
      inputSchema: zodSchema(
        z.object({
          viewId: z.string().uuid(),
          columnIds: z.array(z.string().uuid()),
        })
      ),
      execute: async (input) => cmds.reorderFormFields({ ...input, ...org }, getToolTransaction()),
    }),

    set_form_sections: tool({
      description: "设置表单分组（sections）",
      inputSchema: zodSchema(
        z.object({
          viewId: z.string().uuid(),
          sections: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              fieldIds: z.array(z.string()),
            })
          ),
        })
      ),
      execute: async (input) => cmds.setFormSections({ ...input, ...org }, getToolTransaction()),
    }),

    set_form_theme: tool({
      description:
        "设置表单主题预设：notion-light | ink | ocean | sunset | midnight（Typeform 风格）",
      inputSchema: zodSchema(
        z.object({
          viewId: z.string().uuid(),
          preset: z.enum(["notion-light", "ink", "ocean", "sunset", "midnight"]),
        })
      ),
      execute: async ({ viewId, preset }) =>
        cmds.setFormTheme({ viewId, preset, ...org }, getToolTransaction()),
    }),

    set_form_layout: tool({
      description: "设置表单布局：classic（堆叠）或 focus（一题一屏 Typeform 风）",
      inputSchema: zodSchema(
        z.object({
          viewId: z.string().uuid(),
          layout: z.enum(["classic", "focus"]),
        })
      ),
      execute: async (input) => cmds.setFormLayout({ ...input, ...org }, getToolTransaction()),
    }),

    set_form_field_settings: tool({
      description:
        "更新单个表单字段的标签/必填/隐藏/题型设置（如 select display=buttons）",
      inputSchema: zodSchema(
        z.object({
          viewId: z.string().uuid(),
          columnId: z.string().uuid(),
          label: z.string().optional(),
          helpText: z.string().optional(),
          placeholder: z.string().optional(),
          required: z.boolean().optional(),
          hidden: z.boolean().optional(),
          readOnly: z.boolean().optional(),
          settings: z.record(z.string(), z.unknown()).optional(),
        })
      ),
      execute: async ({ viewId, columnId, settings, ...rest }) =>
        cmds.setFormFieldSettings({
          viewId,
          columnId,
          patch: { ...rest, settings: settings as never },
          ...org,
        }, getToolTransaction()),
    }),


    rename_view: tool({ description: "重命名任意表格、看板或表单视图，不改变其配置。", inputSchema: zodSchema(RENAME_VIEW_SCHEMA), execute: async (input) => cmds.renameView({ ...input, ...org }, getToolTransaction()) }),
    set_default_view: tool({ description: "设置表格唯一默认视图，整个工作区共享。", inputSchema: zodSchema(SET_DEFAULT_VIEW_SCHEMA), execute: async (input) => cmds.setDefaultView({ ...input, ...org }, getToolTransaction()) }),
    update_board_view: tool({ description: "更新看板分组单选字段、卡片显示字段（visibleColumnIds按显示顺序）及hideEmpty、density（comfortable宽松/compact精简）；标题始终显示，人员和日期固定在页脚。", inputSchema: zodSchema(UPDATE_BOARD_VIEW_SCHEMA), execute: async (input) => cmds.updateBoardView({ ...input, ...org }, getToolTransaction()) }),

    delete_view: tool({
      description: "删除视图。同一表格至少保留一个视图。",
      inputSchema: zodSchema(z.object({ viewId: z.string().uuid() })),
      execute: async ({ viewId }) => cmds.deleteView({ viewId, ...org }, getToolTransaction()),
    }),
    create_grid_view: tool({
      description: "按需创建表格（grid）视图",
      inputSchema: zodSchema(
        z.object({
          tableId: z.string().uuid().optional(),
          name: z.string().optional(),
        })
      ),
      execute: async ({ tableId, name }) => {
        const id = tableId || defaultTableId;
        if (!id) throw new Error("缺少 tableId");
        return cmds.createGridView({ tableId: id, name, ...org }, getToolTransaction());
      },
    }),

    create_board_view: tool({
      description: "按需创建看板（board）视图",
      inputSchema: zodSchema(
        z.object({
          tableId: z.string().uuid().optional(),
          name: z.string().optional(),
          statusColumnId: z.string().uuid().optional(),
          config: BOARD_VIEW_CONFIG_SCHEMA.optional(),
        })
      ),
      execute: async ({ tableId, name, statusColumnId, config }) => {
        const id = tableId || defaultTableId;
        if (!id) throw new Error("缺少 tableId");
        return cmds.createBoardView({
          tableId: id,
          name,
          config: { ...config, ...(statusColumnId ? { statusColumnId } : {}) },
          ...org,
        }, getToolTransaction());
      },
    }),
  };
}

export type TableTools = ReturnType<typeof createTableTools>;
