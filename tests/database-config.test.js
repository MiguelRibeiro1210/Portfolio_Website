import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { getDatabaseConfig } from '../src/config/env.js';
import { openDatabase } from '../src/db/database.js';
import { registerUser } from '../src/services/authService.js';
import { describeDatabaseError } from '../src/db/errors.js';

test('database failures identify remedies without exposing driver messages', () => {
  for (const [code, remedy] of [
    ['ENETUNREACH', /Session pooler/],
    ['ENOTFOUND', /hostname/],
    ['SELF_SIGNED_CERT_IN_CHAIN', /DATABASE_CA_CERT_PATH/],
    ['28P01', /authentication failed/],
    ['42P06', /already exists/],
    ['42501', /permission/],
    ['42P01', /db:migrate/],
    ['ETIMEDOUT', /timed out/],
    ['UNKNOWN', /operation failed/],
  ]) {
    const message = describeDatabaseError({ code, message: 'postgres://user:private-password@host/db secret row contents' });
    assert.match(message, remedy);
    assert.doesNotMatch(message, /private-password|secret row contents/);
  }
  assert.match(describeDatabaseError({ errors: [{ code: 'ENETUNREACH' }] }), /Session pooler/);
});

test('database configuration requires a PostgreSQL URL without leaking its value', () => {
  for (const value of ['', 'private-password', 'https://user:private-password@example.com/db']) {
    assert.throws(() => getDatabaseConfig({ DATABASE_URL: value }), error => {
      assert.ok(!error.message.includes('private-password'));
      return /DATABASE_URL/.test(error.message);
    });
  }
});

test('remote connections require verified TLS and cannot override it through URL options', () => {
  const env = { DATABASE_URL: 'postgresql://user:secret@example.com/postgres' };
  assert.deepEqual(getDatabaseConfig(env).ssl, { rejectUnauthorized: true });
  assert.throws(() => getDatabaseConfig({ ...env, DATABASE_SSL: 'false' }), /only for local/);
  for (const option of ['sslmode=disable', 'sslmode=require', 'ssl=false', 'uselibpqcompat=true']) {
    assert.throws(() => getDatabaseConfig({ DATABASE_URL: `${env.DATABASE_URL}?${option}` }), /SSL query parameters/);
  }
  assert.equal(getDatabaseConfig({ DATABASE_URL: 'postgresql://user:secret@127.0.0.1/test', DATABASE_SSL: 'false' }).ssl, false);
});

test('startup fails clearly when DATABASE_URL is missing', () => {
  const result = spawnSync(process.execPath, ['src/server.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, DATABASE_URL: '' },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DATABASE_URL is required/);
  assert.doesNotMatch(result.stdout, /folio is ready/);
});

test('unreachable database fails safely before serving requests', async () => {
  await assert.rejects(openDatabase({
    connectionString: 'postgresql://user:private-password@127.0.0.1:1/postgres',
    connectionTimeoutMillis: 200,
    ssl: false,
  }), error => {
    assert.match(error.message, /Unable to connect to PostgreSQL/);
    assert.ok(!error.message.includes('private-password'));
    return true;
  });
});

test('only the email unique constraint becomes a duplicate-account result', async () => {
  const input = { name: 'Test', email: 'test@example.com', password: 'test-password' };
  const duplicate = Object.assign(new Error('constraint'), { code: '23505', constraint: 'users_email_key' });
  assert.deepEqual(await registerUser(input, async () => ({ insertUser: async () => { throw duplicate; } })), { duplicate: true });
  const other = Object.assign(new Error('constraint'), { code: '23505', constraint: 'another_key' });
  await assert.rejects(registerUser(input, async () => ({ insertUser: async () => { throw other; } })), other);
});
