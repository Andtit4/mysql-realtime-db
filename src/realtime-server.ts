import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import type { RealtimeEventPayload } from './types.js';
import { DEFAULT_REALTIME_PATH } from './defaults.js';

type BroadcastFn = (payload: RealtimeEventPayload) => void;

export interface RealtimeServerOptions {
  port: number;
  path?: string;
}

interface ClientSubscription {
  table: string;
  pattern?: string;
}

interface ConnectedClient {
  ws: import('ws').WebSocket;
  subscriptions: ClientSubscription[];
}

function matchPattern(table: string, pattern: string): boolean {
  if (pattern === table) return true;
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    return table === prefix || table.startsWith(prefix + ':');
  }
  return false;
}

export class RealtimeServer {
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Map<import('ws').WebSocket, ConnectedClient> = new Map();
  private readonly port: number;
  private readonly path: string;

  constructor(options: RealtimeServerOptions) {
    this.port = options.port;
    this.path = options.path ?? DEFAULT_REALTIME_PATH;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer = createServer((req, res) => {
        res.writeHead(404);
        res.end();
      });

      this.wss = new WebSocketServer({ noServer: true });

      this.httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
        const pathname = request.url?.split('?')[0] ?? '';
        if (pathname !== this.path) {
          socket.destroy();
          return;
        }
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, request);
        });
      });

      this.wss.on('connection', (ws) => {
        const client: ConnectedClient = { ws, subscriptions: [] };
        this.clients.set(ws, client);

        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString()) as { action?: string; table?: string; pattern?: string };
            if (msg.action === 'subscribe' && msg.table) {
              client.subscriptions.push({
                table: msg.table,
                pattern: msg.pattern,
              });
            }
          } catch {
            // ignore invalid json
          }
        });

        ws.on('close', () => {
          this.clients.delete(ws);
        });
      });

      this.httpServer.listen(this.port, () => resolve());
    });
  }

  async stop(): Promise<void> {
    for (const [ws] of this.clients) {
      ws.close();
    }
    this.clients.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }
  }

  /** retourne une fonction à appeler pour diffuser un événement à tous les clients abonnés */
  getBroadcast(): BroadcastFn {
    return (payload: RealtimeEventPayload) => {
      const table = payload.table;
      const serialized = JSON.stringify(payload);
      for (const client of this.clients.values()) {
        const interested = client.subscriptions.some((sub) =>
          matchPattern(table, sub.pattern ?? sub.table)
        );
        if (interested && client.ws.readyState === 1) {
          client.ws.send(serialized);
        }
      }
    };
  }
}
