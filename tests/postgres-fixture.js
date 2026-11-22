import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { getDatabaseConfig } from '../src/config/env.js';
import { applyMigrations } from '../src/db/migrations.js';

export async function openTestDatabase({ legacy = false } = {}) {
  const config = getDatabaseConfig({
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    DATABASE_SSL: process.env.TEST_DATABASE_SSL,
    DATABASE_CA_CERT_PATH: process.env.TEST_DATABASE_CA_CERT_PATH,
  });
  const target = new URL(config.connectionString);
  if (!target.pathname.endsWith('_test')) throw new Error('Integration tests require a dedicated _test database.');
  for (const value of [process.env.DATABASE_URL, process.env.MIGRATION_DATABASE_URL].filter(Boolean)) {
    const app = new URL(value);
    if (target.hostname === app.hostname && (target.port || '5432') === (app.port || '5432') &&
        target.pathname === app.pathname) {
      throw new Error('TEST_DATABASE_URL must be separate from the application database.');
    }
  }

  const inspection = new Pool(config);
  let lock;
  let ownedSchema = false;
  try {
    lock = await inspection.connect();
    await lock.query('SELECT pg_advisory_lock(80431, 2)');
    const { rows: [existing] } = await lock.query("SELECT to_regnamespace('portfolio') IS NOT NULL AS present");
    if (existing.present) throw new Error('Integration tests refuse an existing portfolio schema.');
    ownedSchema = true;
    let legacyId;
    if (legacy) {
      const sql = await readFile(new URL('../src/db/migrations/001_create_users.sql', import.meta.url), 'utf8');
      await lock.query(sql);
      const { rows: [user] } = await lock.query(`
        INSERT INTO portfolio.users (name, email, password_hash)
        VALUES ('Legacy User', 'legacy@example.com', '') RETURNING id
      `);
      legacyId = user.id;
    }
    const applied = await applyMigrations(inspection);
    return { config, inspection, legacyId, applied, close };
  } catch (error) {
    await close();
    throw error;
  }

  async function close() {
    try {
      if (ownedSchema) await lock.query('DROP SCHEMA IF EXISTS portfolio CASCADE');
    } finally {
      lock?.release(true);
      await inspection.end();
    }
  }
}
