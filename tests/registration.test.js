import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { createAppServer } from '../src/server.js';

test('registration validates credentials and persists one account per email', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'portfolio-registration-'));
  const databasePath = join(directory, 'test.sqlite');
  const server = createAppServer({ databasePath });
  const account = { name: ' Alex Rivera ', email: ' ALEX@example.com ', password: ' sample-password ' };

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const register = body => fetch(`http://127.0.0.1:${server.address().port}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

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
    assert.deepEqual(results[0].body, { user: { id: 1, name: 'Alex Rivera', email: 'alex@example.com' } });

    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);
    try {
      const rows = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM users', (error, rows) => error ? reject(error) : resolve(rows));
      });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].email, 'alex@example.com');
      assert.ok(rows[0].created_at);
      assert.notEqual(rows[0].password_hash, account.password);
      assert.ok(await bcrypt.compare(account.password, rows[0].password_hash));
    } finally {
      await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
    }
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
