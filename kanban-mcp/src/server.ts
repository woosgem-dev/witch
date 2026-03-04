import http from 'node:http';
import net from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import type { BoardState, Card } from './types.js';

export async function findAvailablePort(startPort: number = 3001): Promise<number> {
  const envPort = process.env.KANBAN_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
  }

  let port = startPort;
  while (port < startPort + 100) {
    const available = await isPortAvailable(port);
    if (available) return port;
    port++;
  }

  throw new Error(`No available port found in range ${startPort}-${startPort + 99}`);
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

export class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private httpServer: http.Server | null = null;
  private port: number;
  private getState: () => BoardState;
  private clients: Set<WebSocket> = new Set();
  private dashboardPath: string | null;

  constructor(port: number, getState: () => BoardState, dashboardPath?: string) {
    this.port = port;
    this.getState = getState;
    this.dashboardPath = dashboardPath ?? null;
  }

  start(): void {
    this.httpServer = http.createServer((req, res) => {
      // Serve dashboard at root
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        if (this.dashboardPath && existsSync(this.dashboardPath)) {
          const html = readFileSync(this.dashboardPath, 'utf-8');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': Buffer.byteLength(html),
          });
          res.end(html);
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Dashboard not found');
        return;
      }

      if (req.method === 'GET' && req.url === '/board') {
        const state = this.getState();
        const body = JSON.stringify(state);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        });
        res.end(body);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      const snapshot = JSON.stringify({
        type: 'board_snapshot',
        payload: { board: this.getState() },
      });
      ws.send(snapshot);

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });

    this.httpServer.listen(this.port, () => {
      console.error(`WebSocket server listening on port ${this.port}`);
    });
  }

  broadcast(event: string, payload: Card): void {
    const message = JSON.stringify({
      type: 'board_update',
      event,
      payload,
      timestamp: new Date().toISOString(),
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  broadcastSnapshot(): void {
    const snapshot = JSON.stringify({
      type: 'board_snapshot',
      payload: { board: this.getState() },
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(snapshot);
      }
    }
  }

  getPort(): number {
    return this.port;
  }
}
