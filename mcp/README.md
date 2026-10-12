# @table/mcp

MCP server that exposes the Agrid **command layer 1:1**.  
Every tool calls `POST /api/commands` — same API as the UI and agent chat tools.

## Env

| Variable | Description |
|----------|-------------|
| `TABLE_API_URL` | API root, default `http://localhost:3001` |
| `TABLE_API_KEY` | Agent key `agt_…` (or leave empty if `AUTH_REQUIRED` is false) |

## Run

```bash
cd /workspace/feishu-notion-table
pnpm --filter @table/mcp start
```

## Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "table": {
      "command": "pnpm",
      "args": ["--filter", "@table/mcp", "start"],
      "cwd": "/workspace/feishu-notion-table",
      "env": {
        "TABLE_API_URL": "http://localhost:3001",
        "TABLE_API_KEY": "agt_your_key"
      }
    }
  }
}
```

## Tools

`list_tables`, `get_table`, `query_rows`, `update_cell`, `update_cells`, `add_row`, `delete_row`, `add_column`, `delete_column`, `update_column`, `reorder_columns`, `set_status`, `move_card`
