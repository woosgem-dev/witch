# Witch

MCP server that turns multi-agent task pipelines into a live DAG you can actually see.

![Dashboard](docs/screenshot.png)

## What is this

Agents spawn tasks, depend on each other, pass work around. Without a visual, you're reading JSON diffs to figure out what's going on. Witch gives you a force-directed graph that updates as agents work -- cards, edges, status, logs, all live.

It runs as an MCP server. Agents call tools to create cards and update status. The dashboard connects over WebSocket and renders everything in real time.

## Stack

- MCP server: `@modelcontextprotocol/sdk`, WebSocket
- Dashboard: D3.js v7 force graph, pure SVG
- Storage: JSON files in `~/.agent-kanban-board/`

## Setup

```bash
cd kanban-mcp
npm install
npm run build
```

## Usage with Claude Code

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "kanban": {
      "command": "node",
      "args": ["kanban-mcp/dist/index.js"],
      "env": {
        "KANBAN_BOARDS_DIR": "~/.agent-kanban-board"
      }
    }
  }
}
```

Open the dashboard:

```bash
open http://localhost:3002
```

## MCP tools

| Tool | What it does |
|------|-------------|
| `new_board` | Create or switch boards |
| `list_boards` | List saved boards |
| `get_board_info` | Board info + dashboard URL |
| `create_card` | Create a task card |
| `update_card_status` | Change status (dependency-aware) |
| `assign_card` | Assign card to an agent |
| `add_log` | Append an execution log entry |
| `add_dependency` / `remove_dependency` | Wire up task dependencies |
| `archive_card` | Archive a card |
| `list_cards` / `get_my_cards` | Query cards |

## Dashboard

- Force-directed DAG, laid out horizontally by dependency depth
- Cards glow by status: blue pulse when active, yellow pulse in review, green when done
- Click a card to highlight its full dependency tree (upstream and downstream)
- Agent filter pills at the bottom -- click one to isolate that agent's cards
- Minimap in the corner for large graphs
- Click the log count on a card to open its execution log
- All updates are live over WebSocket
