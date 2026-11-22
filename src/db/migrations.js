import { readdir, readFile } from 'node:fs/promises';

const directory = new URL('./migrations/', import.meta.url);

async function verifyInitialSchema(client) {
  const { rows } = await client.query(`
    SELECT column_name, data_type, is_nullable, identity_generation, column_default
    FROM information_schema.columns
    WHERE table_schema = 'portfolio' AND table_name = 'users'
    ORDER BY ordinal_position
  `);
  const columns = rows.map(row => [row.column_name, row.data_type, row.is_nullable].join(':'));
  const expected = [
    'id:integer:NO', 'name:text:NO', 'email:text:NO', 'password_hash:text:NO',
    'created_at:timestamp with time zone:NO',
  ];
  const { rows: constraints } = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = to_regclass('portfolio.users')
  `);
  if (columns.join() !== expected.join() || rows[0]?.identity_generation !== 'ALWAYS' ||
      rows[4]?.column_default !== 'CURRENT_TIMESTAMP' ||
      !constraints.some(row => row.definition === 'PRIMARY KEY (id)') ||
      !constraints.some(row => row.conname === 'users_email_key' && row.definition === 'UNIQUE (email)')) {
    throw new Error('Existing portfolio schema does not match migration 001. Inspect portfolio.users before retrying.');
  }
}

export async function applyMigrations(pool) {
  const files = (await readdir(directory)).filter(name => /^\d{3}_.+\.sql$/.test(name)).sort();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(80431, 1)');
    const { rows: [existing] } = await client.query(`
      SELECT to_regnamespace('portfolio') IS NOT NULL AS schema_exists,
             to_regclass('portfolio.schema_migrations') IS NOT NULL AS history_exists
    `);
    if (existing.schema_exists && !existing.history_exists) await verifyInitialSchema(client);
    if (!existing.schema_exists) await client.query(await readFile(new URL(files[0], directory), 'utf8'));

    await client.query(`
      CREATE TABLE IF NOT EXISTS portfolio.schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    if (!existing.history_exists) {
      await client.query('INSERT INTO portfolio.schema_migrations (filename) VALUES ($1)', [files[0]]);
    }

    const { rows } = await client.query('SELECT filename FROM portfolio.schema_migrations');
    const applied = new Set(rows.map(row => row.filename));
    const pending = files.filter(file => !applied.has(file));
    for (const file of pending) {
      await client.query(await readFile(new URL(file, directory), 'utf8'));
      await client.query('INSERT INTO portfolio.schema_migrations (filename) VALUES ($1)', [file]);
    }

    await client.query('COMMIT');
    return existing.history_exists ? pending : [files[0], ...pending];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
