# Agent Board — Graph-Based Task Dashboard

## Design Document v2.0

*Multi-Agent Task Orchestration with D3.js Force-Directed Graph Dashboard — March 2026*

---

## 1. Overview

Agent Board is a dev flow engine for Claude Code multi-agent pipelines. The core
loop: **extract tasks from a plan, analyze dependencies to build a DAG, assign
agents, execute.** The board tracks every step of this pipeline and renders it as
a real-time force-directed graph so human operators can watch the flow unfold.

### 1.1 Core Workflow

```
Plan/Spec ──► Orchestrator ──► Tasks ──► Dependency DAG ──► Agent Assignment ──► Execution
                  │               │              │                  │                │
                  │          create_card    add_dependency     assign_card    update_card_status
                  │               │              │                  │           add_log
                  │               ▼              ▼                  ▼                │
                  │         ┌─────────────────────────────────────────────┐          │
                  └────────►│          Agent Board (MCP Server)           │◄─────────┘
                            │  State Manager + WebSocket + Dashboard     │
                            └─────────────────────────────────────────────┘
```

The orchestrator (LLM agent) owns all decisions. The board is a state tracker
and visualizer — it stores what the orchestrator decides, enforces dependency
constraints, and renders the DAG in real time.

| Step | Who | What | MCP Tool |
|------|-----|------|----------|
| 1. Extract tasks | Orchestrator | Reads plan, breaks into atomic tasks | `create_card` |
| 2. Build DAG | Orchestrator | Analyzes task relationships, sets order | `add_dependency` |
| 3. Assign agents | Orchestrator | Matches tasks to agent capabilities | `assign_card` |
| 4. Execute | Sub-agents | Pick up tasks, work, report progress | `update_card_status`, `add_log` |
| 5. Review | Orchestrator | Checks completed work, approves or rejects | `update_card_status` |

### 1.2 Goals

- Visualize the orchestrator's dev flow as a force-directed dependency graph
- D3.js dark neon UI with status-based node colors and animations
- Dependency-aware status transitions (blocked cards cannot start)
- Real-time dashboard updates via WebSocket
- Archive-based card lifecycle (no hard delete)
- Auto port discovery (no fixed port)
- External ticket reference support (Jira ticket numbers, etc.)

### 1.3 Non-Goals

- Automated task extraction, dependency analysis, or agent matching — the
  orchestrator LLM handles all of these; the board only stores and displays
- Authentication or multi-user access control
- External project management tool API integration (Jira API, Linear, etc.)
- Bidirectional dashboard interaction (read-only monitoring)
- Multi-board support (single board per instance, multiple ports for scaling)

---

## 2. System Architecture

```
Claude Code Process
  +- Team Lead (Orchestrator)
  +- Teammate 1..N
  +- (MCP stdio communication)
         |
         v
kanban-mcp server (Node.js)
  +- MCP Tools (stdio) — 9 tools
  +- WebSocket Server (auto port discovery)
  +- HTTP GET /board
  +- State Manager (board.json persistence)
         |
         v
Web Dashboard (D3.js force-directed graph)
  +- Node = task card
  +- Edge = dependency arrow
  +- Node color = status (Todo/InProgress/Review/Done)
  +- Node glow/pulse = in-progress animation
  +- Agent badge = assignee display
```

### Key Changes from v1.0

- 4-column Kanban -> D3 force-directed graph
- Fixed port 3001 -> auto port discovery
- Hard delete -> archive flag
- 6 MCP tools -> 9 (add_dependency, remove_dependency, archive_card)
- Dependency data model added (dependencies + dependents)
- External reference field added (externalRef)

---

## 3. Data Model

### 3.1 Board State

Persisted to `board.json` as a single JSON object.

```json
{
  "board": {
    "id": "board_<uuid>",
    "name": "string",
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601",
    "cards": [
      {
        "id": "card_<uuid>",
        "title": "string",
        "description": "string",
        "status": "Todo | In Progress | Review | Done",
        "archived": false,
        "assignee": "string | null",
        "priority": "low | medium | high",
        "tags": ["string"],
        "externalRef": "string | null",
        "dependencies": ["card_<uuid>"],
        "dependents": ["card_<uuid>"],
        "createdBy": "string",
        "createdAt": "ISO8601",
        "updatedAt": "ISO8601",
        "logs": [
          {
            "timestamp": "ISO8601",
            "agent": "string",
            "message": "string"
          }
        ]
      }
    ]
  }
}
```

### 3.2 Card Status Lifecycle

```
Todo --> In Progress --> Review --> Done
 ^            |                      |
 +------------+ (back to Todo)       |
                                     v
                               (terminal)
```

**Dependency constraint**: A card cannot transition to `In Progress` unless all
cards in its `dependencies` array have status `Done`.

### 3.3 Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| id | string | auto | `card_<uuid>` |
| title | string | yes | Short task title |
| description | string | no | Detailed description or acceptance criteria |
| status | enum | auto | Todo, In Progress, Review, Done (default: Todo) |
| archived | boolean | auto | true = hidden from dashboard (default: false) |
| assignee | string | no | Agent name |
| priority | enum | no | low, medium, high (default: medium) |
| tags | string[] | no | Grouping labels |
| externalRef | string | no | External ticket number (e.g., "PROJ-123") |
| dependencies | string[] | auto | Card IDs this card depends on |
| dependents | string[] | auto | Card IDs that depend on this card |
| createdBy | string | auto | Agent that created the card |
| logs | array | auto | Execution log entries |

---

## 4. MCP Tool Interface

9 tools exposed via MCP stdio transport (JSON-RPC 2.0).

### `create_card`

| Parameter | Type | Required | Description |
|---|---|---|---|
| title | string | yes | Task title |
| description | string | no | Detailed description |
| assignee | string | no | Agent name to assign |
| priority | enum | no | low, medium, high (default: medium) |
| tags | string[] | no | Grouping labels |
| depends_on | string[] | no | Predecessor card IDs (server syncs bidirectionally) |
| externalRef | string | no | External ticket number |

### `update_card_status`

| Parameter | Type | Required | Description |
|---|---|---|---|
| card_id | string | yes | Card ID to update |
| status | string | yes | New status: Todo, In Progress, Review, Done |
| log_message | string | no | Optional log entry on status change |

**Validation**: Transitioning to `In Progress` requires all `dependencies` to
be `Done`. Returns `{ error: "BLOCKED", blockedBy: ["card_xxx"] }` on failure.

### `assign_card`

| Parameter | Type | Required | Description |
|---|---|---|---|
| card_id | string | yes | Card to assign |
| assignee | string | yes | Agent name |

### `add_log`

| Parameter | Type | Required | Description |
|---|---|---|---|
| card_id | string | yes | Card to log on |
| message | string | yes | Log message |
| agent | string | no | Agent name (defaults to caller) |

### `list_cards`

| Parameter | Type | Required | Description |
|---|---|---|---|
| status | string | no | Status filter |
| assignee | string | no | Assignee filter |
| tag | string | no | Tag filter |
| externalRef | string | no | External reference filter |
| include_archived | boolean | no | Include archived cards (default: false) |

### `get_my_cards`

| Parameter | Type | Required | Description |
|---|---|---|---|
| agent | string | yes | Agent name |
| status | string | no | Optional status filter |

### `add_dependency`

| Parameter | Type | Required | Description |
|---|---|---|---|
| card_id | string | yes | Card to add dependency to |
| depends_on | string | yes | Predecessor card ID |

Server auto-syncs bidirectionally: adds to `card_id.dependencies` and
`depends_on.dependents`. Returns error on circular dependency detection.

### `remove_dependency`

| Parameter | Type | Required | Description |
|---|---|---|---|
| card_id | string | yes | Card to remove dependency from |
| depends_on | string | yes | Predecessor card ID to remove |

### `archive_card`

| Parameter | Type | Required | Description |
|---|---|---|---|
| card_id | string | yes | Card to archive |

Sets `archived: true`. Removes the card from other cards' `dependencies` and
`dependents` arrays.

---

## 5. WebSocket Protocol

### 5.1 Connection

Dashboard connects to `ws://localhost:<port>` on page load. No authentication.
Server sends `board_snapshot` on connect, then `board_update` on every state
change.

### 5.2 Event Schema

```jsonc
// Server -> Client: initial snapshot
{
  "type": "board_snapshot",
  "payload": { /* full board state */ }
}

// Server -> Client: incremental update
{
  "type": "board_update",
  "event": "card_created | card_updated | card_assigned |
            log_added | card_archived |
            dependency_added | dependency_removed",
  "payload": { /* updated card object */ },
  "timestamp": "ISO8601"
}

// Client -> Server: keepalive
{ "type": "ping" }

// Server -> Client: keepalive response
{ "type": "pong" }
```

### 5.3 Broadcast Behavior

Every MCP tool call that mutates board state triggers an immediate broadcast to
all connected WebSocket clients. Broadcast is non-blocking.

---

## 6. Dashboard UI Design

### 6.1 Visual Style: Dark Mode Neon

- **Background**: `#0f172a` (slate-900)
- **Font**: Monospace (JetBrains Mono or system monospace)
- **Cards**: Glass-morphism with subtle blur, neon glow borders
- **Edges**: Neon glow lines connecting nodes
- **Overall feel**: Terminal/IDE aesthetic with vibrant status colors

### 6.2 Graph Layout (D3.js Force-Directed)

- `d3.forceSimulation()` for automatic node placement
- `d3.forceX()` — dependency depth drives left-to-right positioning
- `d3.forceCollide()` — prevents node overlap
- `d3.forceLink()` — dependency edges as elastic links
- `d3.zoom()` — zoom and pan support

### 6.3 Node Design

Each card renders as a rectangular node containing:

| Element | Content |
|---|---|
| External ref badge | `externalRef` value (shown only when present) |
| Title | Bold, 2-line truncate |
| Assignee | Agent name with hash-based color dot |
| Priority | Text indicator |
| Log count | Number of logs, click to expand |

### 6.4 Status Colors and Animations

| Status | Node Color | Border Glow | Animation |
|---|---|---|---|
| Todo | `#94a3b8` (gray) | None | None |
| In Progress | `#3b82f6` (blue) | Blue neon glow | Pulse (box-shadow blink) |
| Review | `#eab308` (yellow) | Yellow soft glow | Subtle pulse |
| Done | `#22c55e` (green) | Green glow | Checkmark icon |
| Archived | Hidden | N/A | Removed from graph |

### 6.5 Edge Design

| Condition | Style |
|---|---|
| Dependency fulfilled (predecessor Done) | Solid green line with glow |
| Dependency blocking (predecessor not Done) | Red dashed line |
| Arrow head | Small triangle at target node |

### 6.6 Agent Status Bar

Fixed bar at the bottom of the dashboard:

- Connection status indicator (green/yellow/red)
- Agent list: each agent shows name + active card count + last activity time
- Click agent name to highlight only their cards (dim others)
- Agent names auto-collected from MCP tool calls (createdBy, assignee, agent)

### 6.7 Auto-Reconnect

Exponential backoff: 1s, 2s, 4s, max 30s. Yellow "Reconnecting..." indicator
during reconnection attempts.

---

## 7. File Structure

```
kanban-mcp/
+-- package.json         # @modelcontextprotocol/sdk, ws, uuid
+-- tsconfig.json        # ESNext, NodeNext
+-- src/
    +-- index.ts         # Single file entry point
        +-- StateManager         (board.json I/O + dependency sync)
        +-- KanbanMCPServer      (9 MCP tools registration)
        +-- WebSocketServer      (ws + HTTP /board + auto port)
        +-- main()               (wiring)

kanban-web/
+-- index.html           # Self-contained dashboard (no build)
    +-- D3.js CDN import
    +-- Force simulation setup
    +-- Node renderer (neon glow + status colors)
    +-- Edge renderer (arrows + blocking indicators)
    +-- Agent status bar
    +-- WebSocket client + reconnect
    +-- Dark neon CSS
```

### Dependencies

| Package | Version | Purpose |
|---|---|---|
| @modelcontextprotocol/sdk | latest | MCP server framework + stdio transport |
| ws | ^8.x | WebSocket server for dashboard push |
| uuid | ^9.x | Card and board ID generation |
| typescript | ^5.x | Type safety |

---

## 8. Configuration

### Port Discovery

1. If `KANBAN_PORT` env var is set, use that port
2. Otherwise, scan from 3001 upward for an available port
3. Print the active port to stderr (stdout reserved for MCP stdio)

### MCP Server Registration

```json
{
  "mcpServers": {
    "kanban": {
      "command": "node",
      "args": ["./kanban-mcp/dist/index.js"],
      "env": {
        "KANBAN_DATA": "./board.json"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| KANBAN_PORT | auto (3001+) | WebSocket/HTTP port |
| KANBAN_DATA | ./board.json | State file path |
| KANBAN_LOG_LEVEL | info | Log verbosity: debug, info, warn, error |

---

## 9. Agent Usage Patterns

### Orchestrator: Full Pipeline

The orchestrator drives the entire dev flow. The board only records decisions.

```ts
// ── Step 1: Extract tasks from plan ──
const auth = create_card({ title: "Auth module", priority: "high", externalRef: "PROJ-123" })
const db   = create_card({ title: "DB schema", priority: "high", externalRef: "PROJ-123" })
const api  = create_card({ title: "API routes", priority: "medium", externalRef: "PROJ-123" })
const ui   = create_card({ title: "Dashboard UI", priority: "medium" })
const e2e  = create_card({ title: "E2E tests", priority: "low" })

// ── Step 2: Build dependency DAG ──
add_dependency({ card_id: api.id, depends_on: auth.id })
add_dependency({ card_id: api.id, depends_on: db.id })
add_dependency({ card_id: ui.id, depends_on: api.id })
add_dependency({ card_id: e2e.id, depends_on: ui.id })

// ── Step 3: Assign agents ──
assign_card({ card_id: auth.id, assignee: "agent-backend" })
assign_card({ card_id: db.id, assignee: "agent-backend" })
assign_card({ card_id: api.id, assignee: "agent-backend" })
assign_card({ card_id: ui.id, assignee: "agent-frontend" })
assign_card({ card_id: e2e.id, assignee: "agent-test" })

// ── Step 5: Review loop ──
// Poll for completed work
list_cards({ status: "Review" })
// Approve or reject
update_card_status({ card_id: auth.id, status: "Done", log_message: "Approved" })
// Rejection sends back to Todo
update_card_status({ card_id: api.id, status: "Todo", log_message: "Needs error handling" })
```

### Sub-Agent: Execute Assigned Work

Sub-agents pick up their cards and follow the status lifecycle.

```ts
// ── Step 4: Execution ──
get_my_cards({ agent: "agent-backend" })
update_card_status({ card_id: auth.id, status: "In Progress" })
add_log({ card_id: auth.id, message: "Starting auth implementation..." })
// ... work ...
add_log({ card_id: auth.id, message: "JWT middleware done, writing tests" })
// ... tests pass ...
update_card_status({
  card_id: auth.id,
  status: "Review",
  log_message: "Implementation complete. Tests passing."
})
// Board auto-unblocks dependents when orchestrator approves this card
```

---

## 10. Decisions Log

| # | Question | Decision |
|---|---|---|
| 1 | Board backup | No backup for v1 |
| 2 | Multi-board support | Single board per instance, multiple ports for scaling |
| 3 | Card deletion | Archive flag (archived: true) |
| 4 | Port conflict handling | Auto-discover available port from 3001 |
| 5 | Graph layout | D3.js force-directed simulation |
| 6 | Visual style | Dark mode with neon glow effects |
| 7 | Dashboard interaction | Read-only monitoring |
| 8 | Dependency model | Bidirectional (dependencies + dependents) |
| 9 | External reference | externalRef string field (no API integration) |

---

*End of Document*
