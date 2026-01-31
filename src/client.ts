import WebSocket from 'ws';
import { DEFAULT_REALTIME_PATH } from './defaults.js';
import type { ClientOptions, RealtimeEventPayload } from './types.js';

type EventCallback = (event: string, data: unknown) => void;

export interface RealtimeClient {
  connect(): Promise<void>;
  disconnect(): void;
  subscribe(tableOrPattern: string, callback: EventCallback): void;
}


/** export interface getPool(): Pool {
  return pool;
} */


export function createClient(options: ClientOptions): RealtimeClient {
  const url = options.url.replace(/^http/, 'ws').replace(/\/$/, '');
  const path = options.path ?? DEFAULT_REALTIME_PATH;
  const wsUrl = `${url}${path}`;

  let ws: WebSocket | null = null;
  const subscriptions: Map<string, EventCallback> = new Map();

  return {
    async connect(): Promise<void> {
      return new Promise((resolve, reject) => {
        ws = new WebSocket(wsUrl);
        ws.on('open', () => {
          for (const [tableOrPattern, _cb] of subscriptions) {
            ws!.send(
              JSON.stringify({
                action: 'subscribe',
                table: tableOrPattern.endsWith(':*') ? tableOrPattern.slice(0, -2) : tableOrPattern,
                pattern: tableOrPattern,
              })
            );
          }
          resolve();
        });
        ws.on('error', reject);
        ws.on('message', (raw: Buffer | string) => {
          try {
            const payload = JSON.parse(raw.toString()) as RealtimeEventPayload;
            const pattern = payload.table + ':*';
            const tableKey = payload.table;
            const cb = subscriptions.get(tableKey) ?? subscriptions.get(pattern);
            if (cb) {
              const listenerData =
                payload.type === 'update'
                  ? { previous: payload.previous, current: payload.current }
                  : payload.data;
              cb(payload.type, listenerData);
            }
          } catch {
            // ignore
          }
        });
      });
    },

    disconnect(): void {
      if (ws) {
        ws.close();
        ws = null;
      }
    },

    subscribe(tableOrPattern: string, callback: EventCallback): void {
      subscriptions.set(tableOrPattern, callback);
      if (ws && ws.readyState === 1) {
        const table = tableOrPattern.endsWith(':*') ? tableOrPattern.slice(0, -2) : tableOrPattern;
        ws.send(
          JSON.stringify({
            action: 'subscribe',
            table,
            pattern: tableOrPattern,
          })
        );
      }
    },
  };
}
