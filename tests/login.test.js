import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import { loadEnvironment } from '../src/config/env.js';
import { openTestDatabase } from './postgres-fixture.js';
import { createAppServer } from '../src/server.js';

loadEnvironment();

test('login creates, refreshes, expires, and revokes sign-in sessions', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to a separate disposable database ending in _test.',
}, async () => {
  const { config, inspection, close, applied } = await openTestDatabase();
  const jwtSecret = randomBytes(32);
  const server = createAppServer({ databaseConfig: config, authConfig: { jwtSecret, secureCookies: true } });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const post = (path, body, cookie) => fetch(base + path, {
      method: 'POST',
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(cookie && { Cookie: cookie }),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const me = token => fetch(base + '/me', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const account = { name: 'Alex Rivera', email: 'alex@example.com', password: ' sample-password ' };
    assert.equal((await post('/register', account)).status, 201);
    assert.equal((await post('/login', '{')).status, 400);
    assert.equal((await post('/login', { email: account.email })).status, 400);

    const wrongPassword = await post('/login', { ...account, password: 'invalid' });
    const unknownUser = await post('/login', { ...account, email: 'other@example.com' });
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownUser.status, 401);
    assert.deepEqual(await wrongPassword.json(), await unknownUser.json());

    const login = await post('/login', { ...account, email: ' ALEX@example.com ' });
    assert.equal(login.status, 200);
    assert.equal(login.headers.get('Cache-Control'), 'no-store');
    const setCookie = login.headers.get('Set-Cookie');
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api']) {
      assert.ok(setCookie.includes(attribute), attribute);
    }
    const cookie = setCookie.split(';')[0];
    const refreshToken = cookie.split('=')[1];
    const { accessToken } = await login.json();
    const claims = jwt.decode(accessToken);
    assert.equal(claims.exp - claims.iat, 15 * 60);

    assert.deepEqual(applied, ['001_create_users.sql', '002_create_auth_tables.sql', '003_create_projects.sql', '004_create_profiles.sql']);
    const readSession = async () => (await inspection.query(
      'SELECT * FROM portfolio.sign_in_sessions WHERE id = $1', [claims.sid],
    )).rows[0];
    const original = await readSession();
    assert.equal(original.refresh_token_hash, createHash('sha256').update(refreshToken).digest('hex'));
    assert.equal(Number(original.expires_at) - Number(original.created_at), 7 * 24 * 60 * 60 * 1000);
    assert.equal(original.last_refreshed_at, null);

    assert.equal((await me()).status, 401);
    assert.equal((await me('invalid')).status, 401);
    const expired = jwt.sign({ sid: claims.sid }, jwtSecret, {
      subject: claims.sub, issuer: claims.iss, audience: claims.aud, expiresIn: -1,
    });
    assert.equal((await me(expired)).status, 401);
    const profile = await me(accessToken);
    assert.equal(profile.status, 200);
    assert.deepEqual(await profile.json(), { user: { id: 1, name: account.name, email: account.email } });

    const rotated = await Promise.all([post('/refresh', undefined, cookie), post('/refresh', undefined, cookie)]);
    assert.deepEqual(rotated.map(response => response.status).sort(), [200, 401]);
    const refreshed = rotated.find(response => response.ok);
    const newCookie = refreshed.headers.get('Set-Cookie').split(';')[0];
    const replacement = await refreshed.json();
    assert.notEqual(newCookie, cookie);
    assert.equal((await me(replacement.accessToken)).status, 200);
    assert.equal((await post('/refresh', undefined, cookie)).status, 401);
    const updated = await readSession();
    assert.equal(updated.expires_at, original.expires_at);
    assert.ok(Number(updated.last_refreshed_at) >= Number(original.created_at));

    const secondLogin = await post('/login', account);
    const secondCookie = secondLogin.headers.get('Set-Cookie').split(';')[0];
    const secondToken = (await secondLogin.json()).accessToken;
    await inspection.query('UPDATE portfolio.sign_in_sessions SET expires_at = $1 WHERE id = $2',
      [Date.now() - 1, jwt.decode(secondToken).sid]);
    assert.equal((await me(secondToken)).status, 401);
    assert.equal((await post('/refresh', undefined, secondCookie)).status, 401);

    const logout = await post('/logout', undefined, newCookie);
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('Set-Cookie'), /^portfolio_refresh=;/);
    assert.match(logout.headers.get('Set-Cookie'), /Path=\/api/);
    assert.equal((await me(accessToken)).status, 401);
    assert.equal((await me(replacement.accessToken)).status, 401);
    assert.equal((await post('/refresh', undefined, newCookie)).status, 401);
    assert.ok((await readSession()).revoked_at);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await close();
  }
});
