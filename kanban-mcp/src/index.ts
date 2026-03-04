import path from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StateManager } from './state.js';
import { WebSocketManager, findAvailablePort } from './server.js';
import { registerTools } from './tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Board storage directory (default: ~/.agent-kanban-board/)
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  const rawBoardsDir = process.env.KANBAN_BOARDS_DIR || '~/.agent-kanban-board';
  const boardsDir = rawBoardsDir.startsWith('~')
    ? path.join(home, rawBoardsDir.slice(1))
    : path.resolve(rawBoardsDir);

  if (!existsSync(boardsDir)) {
    mkdirSync(boardsDir, { recursive: true });
  }

  // Initial board file
  const dataPath = process.env.KANBAN_DATA
    || path.join(boardsDir, 'default.json');

  // Dashboard HTML path
  const projectRoot = path.resolve(__dirname, '../..');
  const dashboardPath = path.join(projectRoot, 'kanban-web/index.html');

  const port = await findAvailablePort();

  const wsManager = new WebSocketManager(port, () => state.getState(), dashboardPath);

  const state = new StateManager(dataPath, (event, card) => {
    wsManager.broadcast(event, card);
  });

  const mcpServer = new McpServer({
    name: 'kanban-mcp',
    version: '1.0.0',
  });

  registerTools(mcpServer, state, {
    wsPort: port,
    boardsDir,
    broadcastSnapshot: () => wsManager.broadcastSnapshot(),
  });

  wsManager.start();

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error(`Agent Board MCP Server started (ws port: ${port})`);
  console.error(`Dashboard: http://localhost:${port}`);
}

main().catch(console.error);
