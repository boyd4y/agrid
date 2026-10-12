---
name: table-ops
description: >-
  Operate the Agrid AI-native spreadsheet (Feishu/Notion-style) via the shared
  command API or MCP. Use when listing tables, querying rows, editing cells,
  managing columns, or moving kanban cards — for humans and agents alike.
---

# Agrid operations (API / MCP)

Humans and agents share **one command layer**. Prefer this skill whenever you
read or mutate workspace tables.

## Preferred surfaces

1. **MCP** (`@table/mcp`) — tools named `list_tables`, `get_table`, `query_rows`, …
2. **HTTP** — `POST {TABLE_API_URL}/api/commands` with body `{ "command", "input" }`
3. Auth: session cookie (human) **or** `Authorization: Bearer agt_…` (agent)

Never invent a second write path. REST routes under `/api/tables` call the same
server commands.

## Hard rules

- **Do not load a full table.** `get_table` returns schema + `rowCount` only.
  Always read rows with `query_rows` (keyset cursor). Default limit 50; max 200
  for agents / MCP.
- **Select / multi_select / person store ids**, not labels. Call `get_table`
  first to learn `columnId` and option ids.
- **Optimistic concurrency:** pass `expectedVersion` on cell patches when you
  have it; on conflict, re-read and retry.
- **Kanban moves** = `set_status` / `move_card` with `statusOptionId` (or null).

## Command ↔ MCP map

| Command (API)   | MCP tool          |
|-----------------|-------------------|
| listTables      | list_tables       |
| getTable        | get_table         |
| queryRows       | query_rows        |
| updateCell      | update_cell       |
| updateCells     | update_cells      |
| addRow          | add_row           |
| deleteRow       | delete_row        |
| addColumn       | add_column        |
| deleteColumn    | delete_column     |
| updateColumn    | update_column     |
| reorderColumns  | reorder_columns   |
| setStatus       | set_status        |
| moveCard        | move_card         |

## Typical workflow

1. `list_tables` → pick `tableId`
2. `get_table` → columns, option ids, `rowCount`
3. `query_rows` with filters / `statusColumnId`+`statusValue` / `cursor`
4. Mutate with `update_cell` or `add_row` / `set_status`
5. If `hasMore`, continue with `nextCursor`

## Example (HTTP)

```bash
curl -s "$TABLE_API_URL/api/commands" \
  -H "Authorization: Bearer $TABLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"command":"queryRows","input":{"tableId":"…","limit":50}}'
```

## Example (MCP env)

```
TABLE_API_URL=http://localhost:3001
TABLE_API_KEY=agt_…
```

Run: `pnpm --filter @table/mcp start` from the monorepo root.

## Docs

Public site: `/docs` (no login). Start at `/docs/introduction`, API at
`/docs/commands`, MCP at `/docs/mcp`.

## 公式列

- 列类型 `formula`，配置 `config.formula`（如 `{预估工时} * 8`）与可选 `formulaResultType`
- **只读**：`update_cell` / `update_cells` 对公式列会报错
- 改依赖列单元格、新建/修改公式列时，服务端自动重算并写回 `cells`
- Agent：`add_column` / `update_column` 传 `formula`；先 `get_table` 看列名再写表达式


## Form views (same dataset)

| Command | MCP tool |
|---|---|
| listViews | list_views |
| getView | get_view |
| createFormView | create_form_view |
| updateFormView | update_form_view |
| setFormFields | set_form_fields |
| addFormField | add_form_field |
| removeFormField | remove_form_field |
| reorderFormFields | reorder_form_fields |

Form submit = `addRow` on the same table. Preview: `open_preview` with `kind: "form"` and optional `viewId`.
