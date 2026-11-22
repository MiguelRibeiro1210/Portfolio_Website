import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { createAppServer } from '../src/server.js';
import { getDatabaseConfig, loadEnvironment } from '../src/config/env.js';

loadEnvironment();

test('PostgreSQL registration validates, handles races, and persists across restart', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to a separate disposable database ending in _test.',
}, async () => {
  const config = getDatabaseConfig({
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    DATABASE_SSL: process.env.TEST_DATABASE_SSL,
    DATABASE_CA_CERT_PATH: process.env.TEST_DATABASE_CA_CERT_PATH,
  });
  const target = new URL(config.connectionString);
  assert.match(target.pathname, /_test$/, 'Integration tests require a dedicated database whose name ends in _test.');
  if (process.env.DATABASE_URL) {
    const appTarget = new URL(process.env.DATABASE_URL);
    assert.ok(target.hostname !== appTarget.hostname || target.port !== appTarget.port || target.pathname !== appTarget.pathname,
      'TEST_DATABASE_URL must not identify the application database.');
  }
  const inspection = new Pool({ ...config, max: 1 });
  let created = false;
  let server;
  const account = { name: ' Alex Rivera ', email: ' ALEX@example.com ', password: ' sample-password ' };
  const listen = async () => {
    server = createAppServer({ databaseConfig: config });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  };
  const stop = () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const register = body => fetch(`http://127.0.0.1:${server.address().port}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  try {
    const migration = await readFile(new URL('../src/db/migrations/001_create_users.sql', import.meta.url), 'utf8');
    await inspection.query(migration);
    created = true;
    // Re-running setup must refuse to overwrite an existing schema.
    await assert.rejects(inspection.query(migration), { code: '42P06' });
    await inspection.query('ROLLBACK');
    await listen();

    for (const body of ['{', {}, { ...account, name: 1 }, { ...account, email: 'bad' },
      { ...account, password: 'short' }, { ...account, password: 'é'.repeat(37) }]) {
      const response = await register(body);
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).message, 'string');
    }

    const responses = await Promise.all([
      register(account),
      register({ ...account, email: 'alex@example.com' }),
    ]);
    const results = await Promise.all(responses.map(async response => ({
      status: response.status,
      body: await response.json(),
    })));
    results.sort((a, b) => a.status - b.status);
    assert.deepEqual(results.map(result => result.status), [201, 409]);
    const { id } = results[0].body.user;
    assert.ok(Number.isInteger(id) && id > 0);
    assert.deepEqual(results[0].body, { user: { id, name: 'Alex Rivera', email: 'alex@example.com' } });

    await stop();
    await listen();
    assert.equal((await register(account)).status, 409);
    const { rows } = await inspection.query('SELECT * FROM portfolio.users');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, id);
    assert.equal(rows[0].email, 'alex@example.com');
    assert.ok(rows[0].created_at instanceof Date);
    assert.notEqual(rows[0].password_hash, account.password);
    assert.equal(bcrypt.getRounds(rows[0].password_hash), 12);
    assert.ok(await bcrypt.compare(account.password, rows[0].password_hash));
  } finally {
    if (server?.listening) await stop();
    try {
      await inspection.query('ROLLBACK');
      if (created) await inspection.query('DROP SCHEMA portfolio CASCADE');
    } finally {
      await inspection.end();
    }
  }
});
