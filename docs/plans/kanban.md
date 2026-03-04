# Claude Code Agent Kanban Board
## Design Document v1.0
*Multi-Agent Task Orchestration with Real-Time WebSocket Dashboard — March 2026*

---

## 1. Overview

Claude Code 멀티에이전트 파이프라인을 위한 Kanban 보드 시스템의 아키텍처 및 설계 문서입니다. Orchestrator 에이전트가 태스크를 분해하고 Sub-agent에 할당하며, 사람이 WebSocket 대시보드를 통해 실시간 진행 상황을 모니터링할 수 있습니다.

### 1.1 Goals

- Orchestrator 에이전트가 프로그래밍 방식으로 카드를 생성하고 할당
- Sub-agent가 카드 상태를 업데이트하고 실행 로그를 실시간으로 추가
- 사람 운영자가 폴링 없이 라이브 모니터링 대시보드 사용
- 에이전트 재시작 및 세션 간 보드 상태를 디스크에 영속화
- Claude Code stdio 트랜스포트와 호환되는 깔끔한 MCP 도구 인터페이스 제공

### 1.2 Non-Goals

- 인증 또는 멀티유저 접근 제어 (단일 운영자 사용 가정)
- 외부 프로젝트 관리 도구 연동 (Jira, Linear 등)
- 에이전트 오케스트레이션 로직 — 이 시스템은 상태만 추적하며 실행은 담당하지 않음

---

## 2. System Architecture

### 2.1 Component Overview

| Component | Role | Interface |
|---|---|---|
| MCP Server | stdio 트랜스포트로 Claude Code 에이전트에 Kanban 도구 노출 | MCP stdio (JSON-RPC) |
| WebSocket Server | 연결된 대시보드 클라이언트에 보드 상태 변경 브로드캐스트 | ws:// port 3001 |
| HTTP Endpoint | 대시보드 로드 시 초기 보드 스냅샷 제공 | GET /board (port 3001) |
| State Manager | JSON 파일 영속성을 갖는 인메모리 보드 상태 | Internal module |
| Web Dashboard | 사람 운영자를 위한 실시간 시각적 모니터링 UI | Browser (file://) |

### 2.2 Architecture Diagram

```
                    ┌─────────────────────────────────────────┐
                    │          Claude Code Process             │
                    │                                         │
   ┌────────────┐   │  ┌──────────────┐  ┌───────────────┐  │
   │   Human    │   │  │ Orchestrator │  │  Sub-Agent N  │  │
   │ Dashboard  │   │  │    Agent     │  │               │  │
   └─────┬──────┘   │  └──────┬───────┘  └──────┬────────┘  │
         │           │         │  MCP stdio        │ MCP stdio │
         │           │         └────────┬──────────┘          │
         │           └──────────────────┼────────────────────┘
         │                              │
   ┌─────▼──────────────────────────────▼──────┐
   │           kanban-mcp server                │
   │                                            │
   │  ┌─────────────┐    ┌──────────────────┐  │
   │  │  MCP Tools  │    │  WebSocket Server │  │
   │  │  (stdio)    │───▶│  + HTTP /board    │  │
   │  └─────────────┘    └──────────────────┘  │
   │         │                                  │
   │  ┌──────▼─────────────────────────────┐   │
   │  │    State Manager + board.json       │   │
   │  └────────────────────────────────────┘   │
   └────────────────────────────────────────────┘
```

---

## 3. Data Model

### 3.1 Board State

보드 상태는 `board.json`에 영속화되는 단일 JSON 객체입니다.

```json
{
  "board": {
    "id": "board_<uuid>",
    "name": "string",
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601",
    "columns": ["Todo", "In Progress", "Review", "Done"],
    "cards": [
      {
        "id": "card_<uuid>",
        "title": "string",
        "description": "string",
        "status": "Todo | In Progress | Review | Done",
        "assignee": "string | null",
        "priority": "low | medium | high",
        "tags": ["string"],
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
Todo  ──▶  In Progress  ──▶  Review  ──▶  Done
  ▲              │                          │
  └──────────────┘  (back to Todo on fail)  │
                                            ▼
                                       (terminal)
```

---

## 4. MCP Tool Interface

모든 도구는 MCP stdio 트랜스포트(JSON-RPC 2.0)를 통해 노출됩니다.

### `create_card`

| Parameter | Type | Required | Description |
|---|---|---|---|
| title | string | Yes | 카드에 표시되는 짧은 태스크 제목 |
| description | string | No | 상세 태스크 설명 또는 완료 기준 |
| assignee | string | No | 즉시 할당할 에이전트 이름 |
| priority | `low \| medium \| high` | No | 태스크 우선순위 (기본값: medium) |
| tags | string[] | No | 관련 카드 그룹화를 위한 레이블 |

### `update_card_status`

| Parameter | Type | Required | Description |
|---|---|---|---|
| card_id | string | Yes | 업데이트할 카드 ID |
| status | string | Yes | 새 상태: Todo, In Progress, Review, Done |
| log_message | string | No | 상태 변경 시 추가되는 선택적 로그 항목 |

### `assign_card`

| Parameter | Type | Required | Description |
|---|---|---|---|
| card_id | string | Yes | 할당할 카드 ID |
| assignee | string | Yes | 담당 에이전트 이름 (self-assign 시 자신의 이름 사용) |

### `add_log`

| Parameter | Type | Required | Description |
|---|---|---|---|
| card_id | string | Yes | 로그를 남길 카드 ID |
| message | string | Yes | 로그 메시지 (진행 상황, 에러, 결정 사항 등) |
| agent | string | No | 에이전트 이름 (생략 시 호출 에이전트로 기본값) |

### `list_cards`

| Parameter | Type | Required | Description |
|---|---|---|---|
| status | string | No | 상태 필터 (생략 시 전체 카드 반환) |
| assignee | string | No | 담당자 이름 필터 |
| tag | string | No | 해당 태그를 포함하는 카드 필터 |

### `get_my_cards`

| Parameter | Type | Required | Description |
|---|---|---|---|
| agent | string | Yes | 할당된 카드를 조회할 에이전트 이름 |
| status | string | No | 선택적 상태 필터 |

---

## 5. WebSocket Protocol

### 5.1 Connection

대시보드는 페이지 로드 시 `ws://localhost:3001`에 연결합니다. 인증이 필요 없습니다. 서버는 연결 즉시 `board_snapshot` 이벤트를 전송하고, 이후 에이전트가 상태를 변경할 때마다 `board_update` 이벤트를 전송합니다.

### 5.2 Event Schema

```jsonc
// Server → Client: 초기 스냅샷
{
  "type": "board_snapshot",
  "payload": { /* full board state */ }
}

// Server → Client: 증분 업데이트
{
  "type": "board_update",
  "event": "card_created | card_updated | card_assigned | log_added",
  "payload": { /* updated card object */ },
  "timestamp": "ISO8601"
}

// Client → Server: Ping (keepalive)
{ "type": "ping" }

// Server → Client: Pong
{ "type": "pong" }
```

### 5.3 Broadcast Behavior

보드 상태를 변경하는 모든 MCP 도구 호출은 연결된 모든 WebSocket 클라이언트에 즉시 브로드캐스트를 트리거합니다. 브로드캐스트는 논블로킹이며, 에이전트에 도구 응답이 반환된 후 브로드캐스트가 완료됩니다.

---

## 6. File Structure

```
kanban-mcp/
├── package.json         # Dependencies: @modelcontextprotocol/sdk, ws, uuid
├── tsconfig.json        # Target: ESNext, module: NodeNext
└── src/
    └── index.ts         # Entry point — 모든 로직을 단일 파일에 작성
        ├── StateManager         (board.json read/write)
        ├── KanbanMCPServer      (MCP stdio transport + tool registration)
        ├── WebSocketServer      (ws server + HTTP /board endpoint)
        └── main()               (세 모듈 연결)

kanban-web/
└── index.html           # Self-contained 대시보드 (빌드 불필요)
    ├── WebSocket client connection + reconnect logic
    ├── Kanban column rendering (Todo / In Progress / Review / Done)
    ├── Card component (title, assignee badge, priority, logs)
    └── Connection status indicator
```

### 6.1 Key Dependencies

| Package | Version | Purpose |
|---|---|---|
| @modelcontextprotocol/sdk | latest | MCP 서버 프레임워크 및 stdio 트랜스포트 |
| ws | ^8.x | 실시간 대시보드 push를 위한 WebSocket 서버 |
| uuid | ^9.x | 카드 및 보드 ID 생성 |
| typescript | ^5.x | 도구 스키마 및 보드 상태 타입 안전성 |

---

## 7. Agent Usage Patterns

### 7.1 Orchestrator Pattern

세션 시작 시 Orchestrator는 계획 단계에서 식별한 각 서브태스크에 대해 `create_card`를 호출한 다음, 에이전트 이름으로 카드를 할당합니다. Orchestrator는 `list_cards({ status: "Review" })`를 폴링하여 검토 준비가 완료된 작업을 감지합니다.

```ts
// Orchestrator 시작 시퀀스
create_card({ title: "Implement auth module", assignee: "sub-agent-1", priority: "high" })
create_card({ title: "Write unit tests",       assignee: "sub-agent-2", priority: "medium" })
create_card({ title: "Update documentation",   assignee: "sub-agent-2", priority: "low" })

// Orchestrator 리뷰 루프
list_cards({ status: "Review" })
// → 완료된 카드 발견 시
update_card_status({ card_id, status: "Done", log_message: "Reviewed and approved" })
```

### 7.2 Sub-Agent Pattern

Sub-agent는 시작 시 `get_my_cards`를 호출하여 할당된 작업을 확인하고, 실행 중 일관된 상태 진행 흐름을 따릅니다. 잦은 `add_log` 호출로 에이전트 워크플로우를 방해하지 않고 운영자에게 중간 단계 가시성을 제공합니다.

```ts
// Sub-agent 실행 시퀀스
get_my_cards({ agent: "sub-agent-1" })
update_card_status({ card_id, status: "In Progress" })
add_log({ card_id, message: "Starting implementation..." })
// ... 작업 수행 ...
add_log({ card_id, message: "Completed core logic, running tests" })
// ... 테스트 실행 ...
update_card_status({
  card_id,
  status: "Review",
  log_message: "Implementation complete. Tests passing. Ready for review."
})
```

---

## 8. Dashboard UI Design

### 8.1 Layout

빌드 없이 사용 가능한 단일 HTML 파일입니다. 4개의 고정 컬럼(Todo, In Progress, Review, Done)을 수평 Kanban 레이아웃으로 렌더링하며, WebSocket 이벤트를 통해 전체 재렌더링 없이 카드가 제자리에서 업데이트됩니다.

### 8.2 Card Display

| Element | Content | Notes |
|---|---|---|
| Title | card.title | Bold, 2줄 truncate |
| Assignee badge | card.assignee | 에이전트 이름 해시 기반 색상 코딩 |
| Priority indicator | 좌측 컬러 보더 | Red=high, Amber=medium, Gray=low |
| Tag chips | card.tags[] | 제목 아래 표시 |
| Log count | card.logs.length | 클릭 시 인라인 로그 뷰어 확장 |
| Last updated | card.updatedAt relative | 예: "2 min ago" |

### 8.3 Connection Status

대시보드 상단의 고정 상태바가 WebSocket 연결 상태를 표시합니다. 연결이 끊기면(MCP 서버 재시작 등) 지수 백오프(1s, 2s, 4s, 최대 30s)로 자동 재연결을 시도하고 노란색 "Reconnecting..." 인디케이터를 표시합니다.

---

## 9. Configuration

### 9.1 MCP Server 등록

`.claude/settings.json` 또는 `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kanban": {
      "command": "node",
      "args": ["./kanban-mcp/dist/index.js"],
      "env": {
        "KANBAN_PORT": "3001",
        "KANBAN_DATA": "./board.json"
      }
    }
  }
}
```

### 9.2 Environment Variables

| Variable | Default | Description |
|---|---|---|
| KANBAN_PORT | 3001 | WebSocket 서버 및 HTTP /board 엔드포인트 포트 |
| KANBAN_DATA | ./board.json | 상태 영속화 파일 절대/상대 경로 |
| KANBAN_LOG_LEVEL | info | 로그 상세도: debug / info / warn / error |

---

## 10. Open Questions

| # | Question | Options | Decision |
|---|---|---|---|
| 1 | board.json 삭제 시 카드 복구 가능해야 하나? | 매 쓰기마다 자동 백업 vs. 수동 백업 커맨드 | TBD |
| 2 | 멀티보드 지원이 필요한가? | 단일 보드 (단순) vs. 세션별 이름 지정 보드 | TBD |
| 3 | 카드 삭제 vs. 아카이브? | Hard delete vs. archived=true 플래그 | TBD |
| 4 | 대시보드 포트 충돌 처리? | 고정 포트 3001 vs. 충돌 시 자동 증가 | TBD |

---

*End of Document*
