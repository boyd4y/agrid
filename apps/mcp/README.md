# @tabdo/mcp

MCP server that exposes the tabdo **command layer 1:1**.
Every tool calls `POST /api/commands` — same API as the UI and agent chat tools.

New in-app agents do not generate API keys. MCP currently requires a previously issued external credential. In-app AI uses your signed-in session.

## Env

| Variable | Description |
|----------|-------------|
| `TABDO_API_URL` | API root, default `http://localhost:3001` |
| `TABDO_API_KEY` | Agent key `agt_…` (or leave empty if `AUTH_REQUIRED` is false) |

## Run

```bash
cd /workspace/tabdo
pnpm --filter @tabdo/mcp start
```

## Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "tabdo": {
      "command": "pnpm",
      "args": ["--filter", "@tabdo/mcp", "start"],
      "cwd": "/workspace/tabdo",
      "env": {
        "TABDO_API_URL": "http://localhost:3001",
        "TABDO_API_KEY": "agt_your_key"
      }
    }
  }
}
```

## Tools

`list_tables`, `get_table`, `query_rows`, `get_row`, `query_relation_records`, `set_relation`, `add_relation`, `remove_relation`, `update_cell`, `update_cells`, `add_row`, `delete_row`, `add_column`, `delete_column`, `update_column`, `reorder_columns`, `set_status`, `move_card`
