import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run migrations');
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const migrations = [
  { version: '001_identity_workspaces', file: '001_identity_workspaces.sql' },
  { version: '002_expired_session_cleanup', file: '002_expired_session_cleanup.sql' },
  { version: '003_evidence_archives', file: '003_evidence_archives.sql' },
] as const;

async function migrate(): Promise<void> {
  const migrationSql = await Promise.all(migrations.map(({ file }) =>
    readFile(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8'),
  ));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(781204109)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const [index, migration] of migrations.entries()) {
      const applied = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1', [migration.version],
      );
      if (applied.rowCount === 0) {
        await client.query(migrationSql[index]);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

try {
  await migrate();
  process.stdout.write(`Applied migrations through ${migrations.at(-1)?.version}\n`);
} finally {
  await pool.end();
}
