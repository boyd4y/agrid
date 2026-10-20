---
name: table-ops
description: >-
  Operate the tabdo AI-native spreadsheet (Feishu/Notion-style) via the shared
  command API or MCP. Use when listing tables, querying rows, editing cells,
  managing columns, or moving kanban cards — for humans and agents alike.
---

# tabdo operations (API / MCP)

Humans and agents share **one command layer**. Prefer this skill whenever you
read or mutate workspace tables.

## Preferred surfaces

1. **Remote MCP** — connect to `https://tabdo.dev/mcp` using Streamable HTTP and an `Authorization: Bearer <API key>` request header. No local process is required.
2. **HTTP** — `POST {TABDO_API_URL}/api/commands` with body `{ "command", "input" }`
3. MCP requires a Bearer API key. A `tab_` data key can use only its configured resource grants; it cannot run member- or schema-only commands. Some commands require an `agt_` agent key and its workspace permissions. Do not assume every listed MCP tool is available to every key.

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
curl -s "$TABDO_API_URL/api/commands" \
  -H "Authorization: Bearer $TABDO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"command":"queryRows","input":{"tableId":"…","limit":50}}'
```

## Example (remote MCP)

```json
{"mcpServers":{"tabdo":{"type":"http","url":"https://tabdo.dev/mcp","headers":{"Authorization":"Bearer tab_replace_with_your_key"}}}}
```

For legacy `agt_` keys, add `X-Workspace-Id` only when you need to select a workspace the agent can access. A `tab_` key follows its existing resource grants across workspaces; any supplied workspace selector must belong to that key's organization. OAuth is not supported by this endpoint; use an MCP client that accepts a static Authorization header.

## Docs

Public site: `/docs` (no login). See [remote MCP connection guide](https://tabdo.dev/docs/mcp).

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
