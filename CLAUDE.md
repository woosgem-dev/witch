# Agent Board

## Session Start Flow

When starting a new session in this project, follow this onboarding flow:

1. Call `list_boards` to check for existing boards
2. Present the user with options:
   - **Resume**: Show existing boards with their status (name, card counts, last updated)
   - **New**: Create a fresh board for new work
3. Based on user choice:
   - Resume: Call `new_board` with the existing board's file name to switch to it
   - New: Call `new_board` with a descriptive name for the new task
4. Call `get_board_info` to get the dashboard URL
5. Open the dashboard: `open http://localhost:<port>`

## MCP Tools (kanban server)

### Board Management
- `list_boards` — List all saved boards (resume previous work)
- `new_board` — Create new board or switch to existing
- `get_board_info` — Get current board info + dashboard URL

### Card Operations
- `create_card` — Create a task card
- `update_card_status` — Update status (enforces dependency constraints)
- `assign_card` — Assign to an agent
- `add_log` — Add execution log
- `add_dependency` / `remove_dependency` — Manage task dependencies
- `archive_card` — Archive a completed card
- `list_cards` / `get_my_cards` — Query cards

## Dashboard

The dashboard is served at `http://localhost:<port>` when the MCP server is running.
D3.js force-directed graph with dark neon theme. Read-only, real-time updates via WebSocket.
