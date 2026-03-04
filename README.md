# Witch

Real-time DAG dashboard for multi-agent pipelines. Built as an MCP server — plug it into Claude Code and watch your agents work.

![Dashboard](docs/screenshot.png)

## What it does

- Visualize agent task pipelines as a force-directed DAG
- Track card status, dependencies, assignments, and logs in real time
- Filter by agent or click a card to highlight its dependency tree
- MCP tools let agents create cards, update status, log progress, and manage dependencies

## Stack

- **MCP Server**: `@modelcontextprotocol/sdk` + WebSocket for live updates
- **Dashboard**: D3.js v7 force-directed graph, pure SVG, dark neon theme
- **Storage**: JSON files in `~/.agent-kanban-board/`

## Setup

```bash
cd kanban-mcp
npm install
npm run build
```

## Usage with Claude Code

Add to your `.mcp.json`:

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

Then open the dashboard:

```bash
open http://localhost:3002
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `new_board` | Create or switch boards |
| `list_boards` | List saved boards |
| `get_board_info` | Board info + dashboard URL |
| `create_card` | Create a task card |
| `update_card_status` | Update status (respects dependency constraints) |
| `assign_card` | Assign to an agent |
| `add_log` | Append execution log |
| `add_dependency` / `remove_dependency` | Manage task dependencies |
| `archive_card` | Archive completed cards |
| `list_cards` / `get_my_cards` | Query cards |

## Dashboard Features

- **Force-directed DAG** with depth-based horizontal layout
- **Status glow effects**: blue pulse (active), yellow pulse (review), green static (done)
- **Agent filter pills** at the bottom bar
- **Card tree highlight**: click a card to see its full upstream/downstream chain
- **Minimap** for navigation on large graphs
- **Log viewer** modal per card
- **Real-time updates** via WebSocket
