import assert from 'node:assert/strict';
import { test } from 'node:test';
import bcrypt from 'bcrypt';
import { createAppServer } from '../src/server.js';
import { loadEnvironment } from '../src/config/env.js';
import { applyMigrations } from '../src/db/migrations.js';
import { openTestDatabase } from './postgres-fixture.js';

loadEnvironment();

test('PostgreSQL registration validates, handles races, and persists across restart', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to a separate disposable database ending in _test.',
}, async () => {
  const { config, inspection, legacyId, applied, close } = await openTestDatabase({ legacy: true });
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
    assert.deepEqual(applied, ['001_create_users.sql', '002_create_auth_tables.sql', '003_create_projects.sql', '004_create_profiles.sql', '005_add_project_revision.sql', '006_add_public_showrooms.sql', '007_create_feed_tables.sql', '008_create_project_collaborators.sql', '009_add_search_indexes.sql']);
    assert.deepEqual(await applyMigrations(inspection), []);
    const legacy = await inspection.query('SELECT id FROM portfolio.users WHERE email = $1', ['legacy@example.com']);
    assert.equal(legacy.rows[0].id, legacyId);
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
    const { rows } = await inspection.query("SELECT * FROM portfolio.users WHERE email <> 'legacy@example.com'");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, id);
    assert.equal(rows[0].email, 'alex@example.com');
    assert.ok(rows[0].created_at instanceof Date);
    assert.notEqual(rows[0].password_hash, account.password);
    assert.equal(bcrypt.getRounds(rows[0].password_hash), 12);
    assert.ok(await bcrypt.compare(account.password, rows[0].password_hash));
  } finally {
    if (server?.listening) await stop();
    await close();
  }
});
