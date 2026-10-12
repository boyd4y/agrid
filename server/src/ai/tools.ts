import { tool, zodSchema } from "ai";
import { z } from "zod";
import { COLUMN_TYPES } from "../db/schema.js";
import * as cmds from "../commands/index.js";
import {
  AGENT_DEFAULT_PAGE_SIZE,
  AGENT_MAX_PAGE_SIZE,
  clampLimit,
} from "@table/shared";

const cellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

/** AI tools mirror the shared command layer — row reads are ALWAYS windowed */
export function createTableTools(
  defaultTableId?: string,
  organizationId?: string
): any {
  const org = { organizationId };
  return {
    list_tables: tool({
      description: "列出当前工作区的多维表格",
      inputSchema: zodSchema(z.object({})),
      execute: async () => cmds.listTables(org),
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
        const t = await cmds.getTable({ tableId, includeFirstPage: false, ...org });
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
      execute: async (input) => cmds.updateCell({ ...input, ...org }),
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
      execute: async (input) => cmds.updateCells({ ...input, ...org }),
    }),

    add_row: tool({
      description: "新增一行，可带初始单元格值",
      inputSchema: zodSchema(
        z.object({
          tableId: z.string().uuid().optional().describe("默认用当前打开的表"),
          cells: z.record(z.string(), cellValueSchema).optional(),
        })
      ),
      execute: async ({ tableId, cells }) => {
        const id = tableId || defaultTableId;
        if (!id) throw new Error("缺少 tableId");
        return cmds.addRow({ tableId: id, cells, ...org });
      },
    }),

    delete_row: tool({
      description: "删除一行",
      inputSchema: zodSchema(z.object({ rowId: z.string().uuid() })),
      execute: async ({ rowId }) => cmds.deleteRow({ rowId, ...org }),
    }),

    add_column: tool({
      description:
        "新增一列。公式列：type=formula，传 formula 如 {预估工时}*8。公式列只读，改依赖列会自动重算。",
      inputSchema: zodSchema(
        z.object({
          tableId: z.string().uuid().optional(),
          name: z.string().min(1),
          type: z.enum(COLUMN_TYPES),
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
          formula: z.string().optional().describe("公式表达式，type=formula 时必填"),
          formulaResultType: z
            .enum(["auto", "number", "text", "checkbox", "date"])
            .optional(),
        })
      ),
      execute: async ({ tableId, name, type, options, formula, formulaResultType }) => {
        const id = tableId || defaultTableId;
        if (!id) throw new Error("缺少 tableId");
        return cmds.addColumn({
          tableId: id,
          name,
          type,
          config: {
            ...(options ? { options } : {}),
            ...(formula !== undefined
              ? { formula, formulaResultType: formulaResultType ?? "auto" }
              : {}),
          },
          ...org,
        });
      },
    }),

    delete_column: tool({
      description: "删除一列",
      inputSchema: zodSchema(z.object({ columnId: z.string().uuid() })),
      execute: async ({ columnId }) => cmds.deleteColumn({ columnId, ...org }),
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
      execute: async (input) => cmds.setStatus({ ...input, ...org }),
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
      execute: async (input) => cmds.moveCard({ ...input, ...org }),
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
        });
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
            ...(options ? { options } : {}),
            ...(formula !== undefined ? { formula } : {}),
            ...(formulaResultType !== undefined ? { formulaResultType } : {}),
          },
          ...org,
        }),
    }),

    reorder_columns: tool({
      description: "按 columnIds 顺序重排列",
      inputSchema: zodSchema(
        z.object({
          tableId: z.string().uuid(),
          columnIds: z.array(z.string().uuid()),
        })
      ),
      execute: async (input) => cmds.reorderColumns({ ...input, ...org }),
    }),

    open_preview: tool({
      description:
        "打开右侧可扩展 UI Slot（插件预览）。默认关闭；按需打开。kind=table|form；form 时传 viewId。",
      inputSchema: zodSchema(
        z.object({
          kind: z
            .string()
            .optional()
            .describe("预览插件种类：table 或 form，默认 table"),
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
        const id = tableId || defaultTableId || null;
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
      execute: async ({ tableId }) => cmds.listViews({ tableId, ...org }),
    }),

    get_view: tool({
      description: "获取视图详情；form 视图会带 resolvedFields",
      inputSchema: zodSchema(z.object({ viewId: z.string().uuid() })),
      execute: async ({ viewId }) => cmds.getView({ viewId, ...org }),
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
        });
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
        }),
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
      execute: async (input) => cmds.setFormFields({ ...input, ...org }),
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
        }),
    }),

    remove_form_field: tool({
      description: "从表单布局移除字段（不删除列）",
      inputSchema: zodSchema(
        z.object({
          viewId: z.string().uuid(),
          columnId: z.string().uuid(),
        })
      ),
      execute: async (input) => cmds.removeFormField({ ...input, ...org }),
    }),

    reorder_form_fields: tool({
      description: "按 columnIds 重排表单字段",
      inputSchema: zodSchema(
        z.object({
          viewId: z.string().uuid(),
          columnIds: z.array(z.string().uuid()),
        })
      ),
      execute: async (input) => cmds.reorderFormFields({ ...input, ...org }),
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
      execute: async (input) => cmds.setFormSections({ ...input, ...org }),
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
        cmds.setFormTheme({ viewId, preset, ...org }),
    }),

    set_form_layout: tool({
      description: "设置表单布局：classic（堆叠）或 focus（一题一屏 Typeform 风）",
      inputSchema: zodSchema(
        z.object({
          viewId: z.string().uuid(),
          layout: z.enum(["classic", "focus"]),
        })
      ),
      execute: async (input) => cmds.setFormLayout({ ...input, ...org }),
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
        }),
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
        return cmds.createGridView({ tableId: id, name, ...org });
      },
    }),

    create_board_view: tool({
      description: "按需创建看板（board）视图",
      inputSchema: zodSchema(
        z.object({
          tableId: z.string().uuid().optional(),
          name: z.string().optional(),
          statusColumnId: z.string().uuid().optional(),
        })
      ),
      execute: async ({ tableId, name, statusColumnId }) => {
        const id = tableId || defaultTableId;
        if (!id) throw new Error("缺少 tableId");
        return cmds.createBoardView({
          tableId: id,
          name,
          config: statusColumnId ? { statusColumnId } : {},
          ...org,
        });
      },
    }),
  };
}

export type TableTools = ReturnType<typeof createTableTools>;
