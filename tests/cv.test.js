import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadEnvironment } from '../src/config/env.js';
import { createAppServer } from '../src/server.js';
import { cvError } from '../src/domain/cvRules.js';
import { openTestDatabase } from './postgres-fixture.js';
import { memoryCvStorage, samplePdf } from './cv-fixture.js';

loadEnvironment();

test('CV save is owner-only and updates the public profile and PDF together', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL for CV persistence tests.',
}, async t => {
  const fixture = await openTestDatabase();
  const storage = memoryCvStorage();
  const server = createAppServer({ databaseConfig: fixture.config, cvStorage: storage, oauthConfig: {} });
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await fixture.close();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const request = (path, options) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, options);
  async function signIn(email) {
    const json = (path, body) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) });
    const credentials = { email, password: 'test-password' };
    assert.equal((await json('/register', { ...credentials, name: 'CV Test' })).status, 201);
    const login = await json('/login', credentials);
    assert.equal(login.status, 200);
    return { Authorization: `Bearer ${(await login.json()).accessToken}` };
  }

  const originalOwner = await signIn('owner@example.com');
  const otherOwner = await signIn('other@example.com');
  function save({ name, pdf, remove, headers = originalOwner, extra = {} }) {
    const body = new FormData();
    body.set('name', name);
    body.set('email', 'public@example.com');
    for (const [key, value] of Object.entries(extra)) body.set(key, value);
    if (pdf) body.set('cv', new Blob([pdf], { type: 'application/pdf' }), 'portfolio.pdf');
    if (remove) body.set('removeCv', 'on');
    return request('/profile/me', { method: 'PUT', headers, body });
  }

  assert.deepEqual(await (await request('/profile/me', { headers: originalOwner })).json(), { profile: null });
  assert.equal((await save({ name: 'Unauthorized', headers: {} })).status, 401);
  const initial = await save({ name: 'Original', pdf: samplePdf() });
  assert.equal(initial.status, 200);
  const { profile } = await initial.json();
  const publicUrl = `/profiles/${profile.publicId}`;
  const publicProfile = async () => (await (await request(publicUrl)).json()).profile;
  assert.equal((await publicProfile()).email, 'public@example.com');
  assert.deepEqual((await publicProfile()).attachment, { name: 'portfolio.pdf', size: samplePdf().length });
  assert.deepEqual((await (await request('/profile/me', { headers: originalOwner })).json()).profile, profile);
  assert.deepEqual(await (await request('/profile/me', { headers: otherOwner })).json(), { profile: null });
  assert.equal((await request('/profile/me/cv', { headers: otherOwner })).status, 404);
  const preview = await request(publicUrl + '/cv');
  assert.equal(preview.headers.get('content-disposition'), 'inline');
  assert.equal(preview.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), samplePdf());
  assert.match((await request(publicUrl + '/cv?download=1')).headers.get('content-disposition'), /attachment.*portfolio\.pdf/);

  assert.equal((await save({ name: 'Invalid PDF', pdf: Buffer.from('not a PDF') })).status, 400);
  assert.equal((await save({ name: 'Invalid field', extra: { github: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await save({ name: 'Oversized', pdf: Buffer.alloc(10 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await save({ name: 'Ambiguous', pdf: samplePdf(), remove: true })).status, 400);
  assert.equal((await publicProfile()).name, 'Original');
  assert.equal(storage.files.size, 1);

  const upload = storage.upload;
  storage.upload = async () => { throw cvError('Test storage unavailable.', 503); };
  assert.equal((await save({ name: 'Failed update', pdf: samplePdf('Replacement') })).status, 503);
  storage.upload = upload;
  assert.equal((await publicProfile()).name, 'Original');

  await fixture.inspection.query(`
    ALTER TABLE portfolio.profiles ADD CHECK (fields->>'name' <> 'Rejected by PostgreSQL')
  `);
  assert.equal((await save({ name: 'Rejected by PostgreSQL', pdf: samplePdf('Replacement') })).status, 500);
  assert.equal((await publicProfile()).name, 'Original');
  assert.deepEqual(Buffer.from(await (await request(publicUrl + '/cv')).arrayBuffer()), samplePdf());
  assert.equal(storage.files.size, 1);

  const other = await save({ name: 'Second owner', headers: otherOwner });
  assert.notEqual((await other.json()).profile.publicId, profile.publicId);
  assert.equal((await publicProfile()).name, 'Original');
  assert.equal((await save({ name: 'Text only' })).status, 200);
  assert.equal((await publicProfile()).attachment.name, 'portfolio.pdf');
  assert.equal((await save({ name: 'Replaced', pdf: samplePdf('Replacement') })).status, 200);
  assert.deepEqual(Buffer.from(await (await request(publicUrl + '/cv')).arrayBuffer()), samplePdf('Replacement'));
  assert.equal(storage.files.size, 1);

  assert.equal((await save({ name: '', remove: true })).status, 200);
  assert.equal((await publicProfile()).name, '');
  assert.equal((await request(publicUrl + '/cv')).status, 404);
  assert.equal(storage.files.size, 0);
});
