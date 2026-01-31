import type { Pool } from 'mysql2/promise';
import { CHANGELOG_TABLE_NAME } from '../defaults.js';

export async function installChangelogSchema(pool: Pool): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS \`${CHANGELOG_TABLE_NAME}\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`table_name\` VARCHAR(191) NOT NULL,
      \`operation\` ENUM('insert', 'update', 'delete') NOT NULL,
      \`row_id\` VARCHAR(191) NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_created\` (\`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `;
  await pool.execute(sql);
}

function escapeId(name: string): string {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

export async function installTriggers(pool: Pool, tables: string[]): Promise<void> {
  for (const table of tables) {
    const safeTable = escapeId(table);
    const safeName = table.replace(/[^a-zA-Z0-9_]/g, '_');
    const triggerPrefix = `_realtime_${safeName}`;
    const tableEsc = table.replace(/'/g, "''");

    await pool.execute(`DROP TRIGGER IF EXISTS ${escapeId(triggerPrefix + '_after_insert')}`);
    await pool.execute(`
      CREATE TRIGGER ${escapeId(triggerPrefix + '_after_insert')}
      AFTER INSERT ON ${safeTable}
      FOR EACH ROW
      INSERT INTO ${escapeId(CHANGELOG_TABLE_NAME)} (table_name, operation, row_id)
      VALUES ('${tableEsc}', 'insert', COALESCE(CAST(NEW.id AS CHAR), NULL))
    `);

    await pool.execute(`DROP TRIGGER IF EXISTS ${escapeId(triggerPrefix + '_after_update')}`);
    await pool.execute(`
      CREATE TRIGGER ${escapeId(triggerPrefix + '_after_update')}
      AFTER UPDATE ON ${safeTable}
      FOR EACH ROW
      INSERT INTO ${escapeId(CHANGELOG_TABLE_NAME)} (table_name, operation, row_id)
      VALUES ('${tableEsc}', 'update', COALESCE(CAST(NEW.id AS CHAR), CAST(OLD.id AS CHAR), NULL))
    `);

    await pool.execute(`DROP TRIGGER IF EXISTS ${escapeId(triggerPrefix + '_after_delete')}`);
    await pool.execute(`
      CREATE TRIGGER ${escapeId(triggerPrefix + '_after_delete')}
      AFTER DELETE ON ${safeTable}
      FOR EACH ROW
      INSERT INTO ${escapeId(CHANGELOG_TABLE_NAME)} (table_name, operation, row_id)
      VALUES ('${tableEsc}', 'delete', COALESCE(CAST(OLD.id AS CHAR), NULL))
    `);
  }
}
