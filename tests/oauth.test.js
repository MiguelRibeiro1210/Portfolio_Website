import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { loadEnvironment } from '../src/config/env.js';
import { openTestDatabase } from './postgres-fixture.js';
import { createAppServer } from '../src/server.js';

loadEnvironment();

test('OAuth signs in both providers and requires an explicit link for an existing email', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to a separate disposable database ending in _test.',
}, async t => {
  const database = await openTestDatabase();
  const origin = 'http://localhost:3000';
  const config = { origin, clientId: 'test-id', clientSecret: 'test-secret' };
  const server = createAppServer({ databaseConfig: database.config, oauthConfig: { google: config, github: config } });
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await database.close();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const fetchLocal = globalThis.fetch;
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let challenge;
  let githubUserId = 456;
  let googleUser = { sub: 'google-123', name: 'Google User', email: 'google@example.com', email_verified: true };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token' || url === 'https://github.com/login/oauth/access_token') {
      assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), challenge);
      return Response.json({ access_token: 'provider-token' });
    }
    assert.equal(options.headers.Authorization, 'Bearer provider-token');
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json(googleUser);
    if (url === 'https://api.github.com/user') return Response.json({ id: githubUserId, login: 'github-user' });
    assert.equal(url, 'https://api.github.com/user/emails');
    return Response.json([{ email: 'github@example.com', primary: true, verified: true }]);
  });

  const request = (path, options) => fetchLocal(base + path, { redirect: 'manual', ...options });
  const cookie = (response, name) => response.headers.getSetCookie()
    .find(value => value.startsWith(name + '='))?.split(';')[0];
  const post = (path, body) => request(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const start = async (provider, refresh) => {
    const result = await request(`/oauth/${provider}/${refresh ? 'link' : 'start'}`, refresh
      ? { method: 'POST', headers: { Cookie: refresh, Origin: origin } }
      : {});
    assert.equal(result.status, 303);
    const url = new URL(result.headers.get('Location'));
    assert.equal(url.searchParams.get('redirect_uri'), `${origin}/api/oauth/${provider}/callback`);
    challenge = url.searchParams.get('code_challenge');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    return { state: url.searchParams.get('state'), cookie: cookie(result, `folio_oauth_${provider}`) };
  };
  const callback = (provider, transaction, state = transaction.state) =>
    request(`/oauth/${provider}/callback?code=test-code&state=${state}`, { headers: { Cookie: transaction.cookie } });
  const currentAccount = async refresh => {
    const result = await request('/refresh', { method: 'POST', headers: { Cookie: refresh } });
    assert.equal(result.status, 200);
    const { accessToken } = await result.json();
    const me = await request('/me', { headers: { Authorization: `Bearer ${accessToken}` } });
    return (await me.json()).user;
  };

  const google = await start('google');
  assert.equal((await callback('google', google, 'wrong')).headers.get('Location'), '/#/signin?oauth=failed');
  const googleLogin = await callback('google', google);
  assert.equal(googleLogin.headers.get('Location'), '/');
  const account = await currentAccount(cookie(googleLogin, 'portfolio_refresh'));
  assert.equal(account.email, 'google@example.com');
  assert.deepEqual(account.linkedProviders, ['google']);

  const githubLogin = await callback('github', await start('github'));
  assert.equal(githubLogin.headers.get('Location'), '/');
  assert.equal((await currentAccount(cookie(githubLogin, 'portfolio_refresh'))).email, 'github@example.com');

  const credentials = { name: 'Existing User', email: 'existing@example.com', password: 'sample-password' };
  assert.equal((await post('/register', credentials)).status, 201);
  googleUser = { ...googleUser, sub: 'google-existing', email: credentials.email };
  const conflict = await callback('google', await start('google'));
  assert.equal(conflict.headers.get('Location'), '/#/signin?oauth=link-required');
  assert.equal(cookie(conflict, 'portfolio_refresh'), undefined);

  const login = await post('/login', credentials);
  const refresh = cookie(login, 'portfolio_refresh');
  const forbiddenLink = await request('/oauth/google/link', {
    method: 'POST', headers: { Cookie: refresh, Origin: 'https://example.org' },
  });
  assert.match(forbiddenLink.headers.get('Location'), /signin-required$/);

  const linked = await callback('google', await start('google', refresh));
  assert.match(linked.headers.get('Location'), /oauth=linked$/);
  const linkedLogin = await callback('google', await start('google'));
  const linkedAccount = await currentAccount(cookie(linkedLogin, 'portfolio_refresh'));
  assert.equal(linkedAccount.email, credentials.email);
  assert.equal(linkedAccount.name, credentials.name);
  assert.deepEqual(linkedAccount.linkedProviders, ['google']);
  githubUserId = 789;
  const nextLogin = await post('/login', credentials);
  const nextRefresh = cookie(nextLogin, 'portfolio_refresh');
  assert.match((await callback('github', await start('github', nextRefresh))).headers.get('Location'), /oauth=linked$/);
  const both = await currentAccount(nextRefresh);
  assert.deepEqual(both.linkedProviders, ['github', 'google']);
  assert.deepEqual(Object.keys(both).sort(), ['email', 'id', 'linkedProviders', 'name']);
});
