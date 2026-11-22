import { readFile } from 'node:fs/promises';
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
  const sql = await readFile(new URL('./migrations/001_create_users.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('Applied 001_create_users.sql.');
} catch (error) {
  console.error(pool
    ? `Initial migration failed. ${describeDatabaseError(error)}`
    : error.message);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
