import * as z from 'zod/v4';
import path from 'node:path';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateManager } from './state.js';
import type { BoardState, CardStatus } from './types.js';

export interface ToolsConfig {
  wsPort: number;
  boardsDir: string;
  broadcastSnapshot: () => void;
}

export function registerTools(server: McpServer, state: StateManager, config: ToolsConfig): void {
  const { wsPort, boardsDir, broadcastSnapshot } = config;

  server.registerTool('get_board_info', {
    description: 'Get current board info including WebSocket port and dashboard URL',
    inputSchema: {},
  }, async () => {
    const boardState = state.getState();
    const cards = boardState.board.cards.filter(c => !c.archived);
    const counts = { Todo: 0, 'In Progress': 0, Review: 0, Done: 0 };
    for (const c of cards) {
      if (c.status in counts) counts[c.status as keyof typeof counts]++;
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        wsPort,
        dashboardUrl: `http://localhost:${wsPort}`,
        boardFile: state.getBoardFilePath(),
        boardId: boardState.board.id,
        boardName: boardState.board.name,
        cards: counts,
        totalCards: cards.length,
      }, null, 2) }],
    };
  });

  server.registerTool('new_board', {
    description: 'Create a new board or switch to an existing board file. Returns dashboard URL to open in browser',
    inputSchema: {
      name: z.string().describe('Board name (e.g., "auth-feature", "sprint-12")'),
      file_name: z.string().optional().describe('Custom file name (without path). Defaults to <name>.json'),
    },
  }, async (params) => {
    const fileName = params.file_name || `${params.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.json`;
    const filePath = path.join(boardsDir, fileName);

    if (!existsSync(boardsDir)) {
      mkdirSync(boardsDir, { recursive: true });
    }

    const isNew = !existsSync(filePath);
    const boardState = state.switchBoard(filePath, params.name);
    broadcastSnapshot();

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        message: isNew ? `New board "${params.name}" created` : `Switched to board "${boardState.board.name}"`,
        boardFile: filePath,
        boardId: boardState.board.id,
        boardName: boardState.board.name,
        wsPort,
        dashboardUrl: `http://localhost:${wsPort}`,
      }, null, 2) }],
    };
  });

  server.registerTool('list_boards', {
    description: 'List all saved boards in the boards directory. Use to resume previous work or choose a board to switch to',
    inputSchema: {},
  }, async () => {
    if (!existsSync(boardsDir)) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ boards: [], message: 'No boards directory found' }, null, 2) }],
      };
    }

    const files = readdirSync(boardsDir).filter(f => f.endsWith('.json'));
    const currentFile = state.getBoardFilePath();

    const boards = files.map(file => {
      const filePath = path.join(boardsDir, file);
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const boardState = JSON.parse(raw) as BoardState;
        const cards = boardState.board.cards.filter(c => !c.archived);
        const counts = { Todo: 0, 'In Progress': 0, Review: 0, Done: 0 };
        for (const c of cards) {
          if (c.status in counts) counts[c.status as keyof typeof counts]++;
        }

        return {
          file,
          filePath,
          active: filePath === currentFile,
          boardId: boardState.board.id,
          boardName: boardState.board.name,
          updatedAt: boardState.board.updatedAt,
          cards: counts,
          totalCards: cards.length,
        };
      } catch {
        return { file, filePath, active: false, error: 'Failed to read board' };
      }
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ boards, currentBoard: currentFile }, null, 2) }],
    };
  });

  server.registerTool('create_card', {
    description: 'Create a new task card on the board',
    inputSchema: {
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Detailed description'),
      assignee: z.string().optional().describe('Agent name to assign'),
      priority: z.enum(['low', 'medium', 'high']).optional().describe('Priority level (default: medium)'),
      tags: z.array(z.string()).optional().describe('Grouping labels'),
      depends_on: z.array(z.string()).optional().describe('Predecessor card IDs'),
      externalRef: z.string().optional().describe('External ticket number'),
      created_by: z.string().optional().describe('Agent creating this card'),
    },
  }, async (params) => {
    try {
      const card = state.createCard({
        title: params.title,
        description: params.description,
        assignee: params.assignee,
        priority: params.priority,
        tags: params.tags,
        externalRef: params.externalRef,
        createdBy: params.created_by ?? 'unknown',
      });

      if (params.depends_on) {
        for (const depId of params.depends_on) {
          state.addDependency(card.id, depId);
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  server.registerTool('update_card_status', {
    description: 'Update a card status. Transitioning to "In Progress" requires all dependencies to be "Done"',
    inputSchema: {
      card_id: z.string().describe('Card ID to update'),
      status: z.enum(['Todo', 'In Progress', 'Review', 'Done']).describe('New status'),
      log_message: z.string().optional().describe('Optional log entry on status change'),
    },
  }, async (params) => {
    try {
      const result = state.updateStatus(params.card_id, params.status as CardStatus, params.log_message);

      if ('error' in result) {
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  server.registerTool('assign_card', {
    description: 'Assign a card to an agent',
    inputSchema: {
      card_id: z.string().describe('Card to assign'),
      assignee: z.string().describe('Agent name'),
    },
  }, async (params) => {
    try {
      const card = state.assignCard(params.card_id, params.assignee);
      return {
        content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  server.registerTool('add_log', {
    description: 'Add a log entry to a card',
    inputSchema: {
      card_id: z.string().describe('Card to log on'),
      message: z.string().describe('Log message'),
      agent: z.string().optional().describe('Agent name (defaults to "unknown")'),
    },
  }, async (params) => {
    try {
      const card = state.addLog(params.card_id, params.message, params.agent ?? 'unknown');
      return {
        content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  server.registerTool('add_dependency', {
    description: 'Add a dependency between cards. Detects and rejects circular dependencies',
    inputSchema: {
      card_id: z.string().describe('Card to add dependency to'),
      depends_on: z.string().describe('Predecessor card ID'),
    },
  }, async (params) => {
    try {
      const card = state.addDependency(params.card_id, params.depends_on);
      return {
        content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  server.registerTool('remove_dependency', {
    description: 'Remove a dependency between cards',
    inputSchema: {
      card_id: z.string().describe('Card to remove dependency from'),
      depends_on: z.string().describe('Predecessor card ID to remove'),
    },
  }, async (params) => {
    try {
      const card = state.removeDependency(params.card_id, params.depends_on);
      return {
        content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  server.registerTool('archive_card', {
    description: 'Archive a card. Removes it from dependency graphs',
    inputSchema: {
      card_id: z.string().describe('Card to archive'),
    },
  }, async (params) => {
    try {
      const card = state.archiveCard(params.card_id);
      return {
        content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  server.registerTool('list_cards', {
    description: 'List cards with optional filters. Excludes archived by default',
    inputSchema: {
      status: z.enum(['Todo', 'In Progress', 'Review', 'Done']).optional().describe('Status filter'),
      assignee: z.string().optional().describe('Assignee filter'),
      tag: z.string().optional().describe('Tag filter'),
      externalRef: z.string().optional().describe('External reference filter'),
      include_archived: z.boolean().optional().describe('Include archived cards (default: false)'),
    },
  }, async (params) => {
    const cards = state.queryCards({
      status: params.status as CardStatus | undefined,
      assignee: params.assignee,
      tag: params.tag,
      externalRef: params.externalRef,
      includeArchived: params.include_archived,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(cards, null, 2) }],
    };
  });

  server.registerTool('get_my_cards', {
    description: 'Get all cards assigned to a specific agent',
    inputSchema: {
      agent: z.string().describe('Agent name'),
      status: z.enum(['Todo', 'In Progress', 'Review', 'Done']).optional().describe('Optional status filter'),
    },
  }, async (params) => {
    const cards = state.queryCards({
      assignee: params.agent,
      status: params.status as CardStatus | undefined,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(cards, null, 2) }],
    };
  });
}
