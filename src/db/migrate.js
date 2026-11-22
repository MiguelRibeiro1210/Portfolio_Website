import { applyMigrations } from './migrations.js';
import { Pool } from 'pg';
import { getDatabaseConfig, loadEnvironment } from '../config/env.js';
import { describeDatabaseError } from './errors.js';

loadEnvironment();
let pool;
try {
  const config = getDatabaseConfig({
    ...process.env,
    DATABASE_URL: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  });
  pool = new Pool(config);
  pool.on('error', () => console.error('An idle PostgreSQL connection failed.'));
  const applied = await applyMigrations(pool);
  console.log(applied.length ? `Applied or verified: ${applied.join(', ')}.` : 'Database migrations are up to date.');
} catch (error) {
  console.error(pool && error.code ? `Migration failed. ${describeDatabaseError(error)}` : error.message);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
