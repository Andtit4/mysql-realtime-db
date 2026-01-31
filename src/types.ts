import type { PoolOptions } from 'mysql2/promise';

export type MySQLConnectionOptions = PoolOptions;

/** options du serveur realtime bref le ws */
export interface RealtimeOptions {
  port: number;
  path?: string;
  /** activer le mode changelog table + triggers */
  enableChangelog?: boolean;
  changelogPollIntervalMs?: number;
  tables?: string[];
}

export interface ConnectionConfig extends MySQLConnectionOptions {
  realtime?: RealtimeOptions;
}

export type RealtimeEventType = 'insert' | 'update' | 'delete';

/** Payload pour l'event insert */
export interface InsertEventPayload {
  table: string;
  type: 'insert';
  data: Record<string, unknown>;
}

export interface UpdateEventPayload {
  table: string;
  type: 'update';
  previous: Record<string, unknown>;
  current: Record<string, unknown>;
}

export interface DeleteEventPayload {
  table: string;
  type: 'delete';
  data: Record<string, unknown>;
}

export type RealtimeEventPayload =
  | InsertEventPayload
  | UpdateEventPayload
  | DeleteEventPayload;

/** (table _realtime_changelog) */
export interface ChangelogRow {
  id: number;
  table_name: string;
  operation: RealtimeEventType;
  row_id: string | null;
  created_at: Date;
}

export interface ClientOptions {
  url: string;
  /** websocket ou sse */
  transport?: 'websocket' | 'sse';
  path?: string;
}

export interface SubscribeMessage {
  action: 'subscribe';
  table: string;
  pattern?: string;
}
