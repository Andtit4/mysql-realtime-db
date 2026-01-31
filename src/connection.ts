import { createPool, type Pool } from 'mysql2/promise';
import { EventEmitter } from 'node:events';
import type {
  ConnectionConfig,
  RealtimeEventPayload,
  UpdateEventPayload,
  InsertEventPayload,
  DeleteEventPayload,
} from './types.js';
import {
  DEFAULT_REALTIME_PORT,
  DEFAULT_REALTIME_PATH,
  DEFAULT_CHANGELOG_POLL_INTERVAL_MS,
} from './defaults.js';
import { RealtimeServer } from './realtime-server.js';
import * as operations from './operations.js';
import { installChangelogSchema, installTriggers } from './changelog/schema.js';
import { startChangelogPoller } from './changelog/poller.js';
import type { ChangelogPoller } from './changelog/poller.js';

export interface RealtimeConnection extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  startRealtimeServer(): Promise<void>;
  stopRealtimeServer(): Promise<void>;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  insert(table: string, data: Record<string, unknown>): Promise<number | bigint>;
  update(
    table: string,
    where: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<number>;
  delete(table: string, where: Record<string, unknown>): Promise<number>;
  installChangelog(): Promise<void>;
}

export function createConnection(config: ConnectionConfig): RealtimeConnection {
  const realtimeOpts = {
    port: DEFAULT_REALTIME_PORT,
    path: DEFAULT_REALTIME_PATH,
    enableChangelog: false,
    changelogPollIntervalMs: DEFAULT_CHANGELOG_POLL_INTERVAL_MS,
    tables: [] as string[],
    ...config.realtime,
  };
  const { port, path, enableChangelog, changelogPollIntervalMs, tables: changelogTables } =
    realtimeOpts;

  const { realtime: _r, ...mysqlConfig } = config;
  const pool = createPool(mysqlConfig);

  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);

  let realtimeServer: RealtimeServer | null = null;
  let broadcast: ((payload: RealtimeEventPayload) => void) | null = null;
  let changelogPoller: ChangelogPoller | null = null;

  function emit(payload: RealtimeEventPayload): void {
    const eventName = `${payload.table}:${payload.type}`;
    const wildcardName = `${payload.table}:*`;
    const listenerData =
      payload.type === 'update'
        ? { previous: (payload as UpdateEventPayload).previous, current: (payload as UpdateEventPayload).current }
        : (payload as InsertEventPayload | DeleteEventPayload).data;
    emitter.emit(eventName, listenerData);
    emitter.emit(wildcardName, payload.type, listenerData);
    broadcast?.(payload);
  }

  const conn = Object.assign(emitter, {
    async connect(): Promise<void> {
      const conn = await pool.getConnection();
      conn.release();
    },

    async disconnect(): Promise<void> {
      if (changelogPoller) {
        changelogPoller.stop();
        changelogPoller = null;
      }
      await conn.stopRealtimeServer();
      await pool.end();
    },

    async startRealtimeServer(): Promise<void> {
      if (realtimeServer) return;
      realtimeServer = new RealtimeServer({ port, path });
      await realtimeServer.start();
      broadcast = realtimeServer.getBroadcast();

      if (enableChangelog && changelogTables.length > 0) {
        changelogPoller = startChangelogPoller({
          pool,
          emit,
          pollIntervalMs: changelogPollIntervalMs,
        });
      }
    },

    async stopRealtimeServer(): Promise<void> {
      if (changelogPoller) {
        changelogPoller.stop();
        changelogPoller = null;
      }
      if (realtimeServer) {
        await realtimeServer.stop();
        realtimeServer = null;
        broadcast = null;
      }
    },

    async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
      const [rows] = await pool.execute(sql, params);
      return (rows as T[]) ?? [];
    },

    async insert(table: string, data: Record<string, unknown>): Promise<number | bigint> {
      return operations.insert({ pool, emit }, table, data);
    },

    async update(
      table: string,
      where: Record<string, unknown>,
      data: Record<string, unknown>
    ): Promise<number> {
      return operations.update({ pool, emit }, table, where, data);
    },

    async delete(table: string, where: Record<string, unknown>): Promise<number> {
      return operations.del({ pool, emit }, table, where);
    },

    async installChangelog(): Promise<void> {
      await installChangelogSchema(pool);
      if (changelogTables.length > 0) {
        await installTriggers(pool, changelogTables);
      }
    },
  }) as RealtimeConnection;

  return conn;
}
