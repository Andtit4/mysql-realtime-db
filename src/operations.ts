import type { Pool } from 'mysql2/promise';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { RealtimeEventPayload } from './types.js';

function escapeId(name: string): string {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

function buildInsert(table: string, data: Record<string, unknown>): { sql: string; params: unknown[] } {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  const columns = keys.map(escapeId).join(', ');
  const placeholders = keys.map(() => '?').join(', ');
  const params = keys.map((k) => data[k]);
  const sql = `INSERT INTO ${escapeId(table)} (${columns}) VALUES (${placeholders})`;
  return { sql, params };
}

function buildUpdate(
  table: string,
  where: Record<string, unknown>,
  data: Record<string, unknown>
): { sql: string; params: unknown[] } {
  //const setKeys = Object.keys(data).filter((k) => data[k] !== '');
  const setKeys = Object.keys(data).filter((k) => data[k] !== undefined);
  const setClause = setKeys.map((k) => `${escapeId(k)} = ?`).join(', ');
  const whereKeys = Object.keys(where);
  const whereClause = whereKeys.map((k) => `${escapeId(k)} = ?`).join(' AND ');
  const params = [...setKeys.map((k) => data[k]), ...whereKeys.map((k) => where[k])];
  const sql = `UPDATE ${escapeId(table)} SET ${setClause} WHERE ${whereClause}`;
  return { sql, params };
}

function buildDelete(table: string, where: Record<string, unknown>): { sql: string; params: unknown[] } {
  const whereKeys = Object.keys(where);
  const whereClause = whereKeys.map((k) => `${escapeId(k)} = ?`).join(' AND ');
  const params = whereKeys.map((k) => where[k]);
  const sql = `DELETE FROM ${escapeId(table)} WHERE ${whereClause}`;
  return { sql, params };
}

export interface OperationsContext {
  pool: Pool;
  emit: (payload: RealtimeEventPayload) => void;
}

export async function insert(
  ctx: OperationsContext,
  table: string,
  data: Record<string, unknown>
): Promise<number | bigint> {
  const { sql, params } = buildInsert(table, data);
  const [result] = await ctx.pool.execute(sql, params);
  const header = result as ResultSetHeader;
  const id = header.insertId;
  const row = { ...data } as Record<string, unknown>;
  if (id != null) row.id = id;
  ctx.emit({
    table,
    type: 'insert',
    data: row,
  });
  return id as number | bigint;
}

export async function update(
  ctx: OperationsContext,
  table: string,
  where: Record<string, unknown>,
  data: Record<string, unknown>
): Promise<number> {
  const [selectSql, selectParams] = selectWhere(table, where);
  const [rows] = await ctx.pool.execute(selectSql, selectParams);
  const previousRows = (rows as RowDataPacket[]) ?? [];
  const { sql, params } = buildUpdate(table, where, data);
  const [result] = await ctx.pool.execute(sql, params);
  const affectedRows = (result as ResultSetHeader).affectedRows ?? 0;
  for (const previous of previousRows) {
    const current = { ...(previous as Record<string, unknown>), ...data };
    ctx.emit({
      table,
      type: 'update',
      previous: previous as Record<string, unknown>,
      current,
    });
  }
  return affectedRows;
}

function selectWhere(table: string, where: Record<string, unknown>): [string, unknown[]] {
  const whereKeys = Object.keys(where);
  const whereClause = whereKeys.map((k) => `${escapeId(k)} = ?`).join(' AND ');
  const params = whereKeys.map((k) => where[k]);
  const sql = `SELECT * FROM ${escapeId(table)} WHERE ${whereClause}`;
  return [sql, params];
}

export async function del(
  ctx: OperationsContext,
  table: string,
  where: Record<string, unknown>
): Promise<number> {
  const [selectSql, selectParams] = selectWhere(table, where);
  const [rows] = await ctx.pool.execute(selectSql, selectParams);
  const toDelete = (rows as RowDataPacket[]) ?? [];
  const { sql, params } = buildDelete(table, where);
  const [result] = await ctx.pool.execute(sql, params);
  const affectedRows = (result as ResultSetHeader).affectedRows ?? 0;
  for (const row of toDelete) {
    ctx.emit({
      table,
      type: 'delete',
      data: row as Record<string, unknown>,
    });
  }
  return affectedRows;
}
