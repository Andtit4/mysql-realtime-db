import type { Pool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import type { RealtimeEventPayload, RealtimeEventType } from '../types.js';
import { CHANGELOG_TABLE_NAME, CHANGELOG_BATCH_SIZE } from '../defaults.js';

function escapeId(name: string): string {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

export interface ChangelogPollerOptions {
  pool: Pool;
  emit: (payload: RealtimeEventPayload) => void;
  pollIntervalMs: number;
}

export interface ChangelogPoller {
  stop: () => void;
}

export function startChangelogPoller(options: ChangelogPollerOptions): ChangelogPoller {
  const { pool, emit, pollIntervalMs } = options;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<void> {
    try {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, table_name, operation, row_id FROM ${escapeId(CHANGELOG_TABLE_NAME)} ORDER BY id ASC LIMIT ?`,
        [CHANGELOG_BATCH_SIZE]
      );
      const list = Array.isArray(rows) ? rows : [];
      if (list.length === 0) return;

      const ids: number[] = [];
      for (const row of list) {
        const id = row.id as number;
        const tableName = row.table_name as string;
        const operation = row.operation as RealtimeEventType;
        const rowId = row.row_id as string | null;
        ids.push(id);

        let payload: RealtimeEventPayload;
        if (operation === 'delete') {
          payload = {
            table: tableName,
            type: 'delete',
            data: rowId != null ? { id: rowId } : {},
          };
        } else {
          let data: Record<string, unknown> = {};
          if (rowId != null) {
            try {
              const [r] = await pool.execute(
                `SELECT * FROM ${escapeId(tableName)} WHERE id = ? LIMIT 1`,
                [rowId]
              );
              const arr = Array.isArray(r) ? r : [r];
              if (arr.length > 0 && arr[0]) {
                data = arr[0] as Record<string, unknown>;
              } else {
                data = { id: rowId };
              }
            } catch {
              data = { id: rowId };
            }
          }
          if (operation === 'insert') {
            payload = { table: tableName, type: 'insert', data };
          } else {
            payload = {
              table: tableName,
              type: 'update',
              previous: { id: rowId },
              current: data,
            };
          }
        }
        emit(payload);
      }

      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        await pool.execute(
          `DELETE FROM ${escapeId(CHANGELOG_TABLE_NAME)} WHERE id IN (${placeholders})`,
          ids
        );
      }
    } catch (err) {
      console.error('[mysql-realtime-db] changelog poller error:', err);
    }
  }

  intervalId = setInterval(tick, pollIntervalMs);
  void tick();

  return {
    stop() {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };
}
