import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSupabaseProjectStorage, ensureProjectBucket } from '../src/services/supabaseProjectStorage.js';
import { createProjectStorage } from '../src/services/projectStorage.js';
import { createProject } from '../src/services/projectService.js';
import { createAppServer } from '../src/server.js';
import { signAccessToken } from '../src/services/tokenService.js';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5qEAAAAASUVORK5CYII=', 'base64');
const env = { SUPABASE_URL: 'https://storage.example.com', SUPABASE_STORAGE_KEY: 'sb_secret_test-only' };

function storageFixture() {
  const files = new Map();
  const requests = [];
  let unavailable = false;
  const client = { storage: { from(name) {
    assert.equal(name, 'project-files');
    return {
      async upload(id, blob, options) {
        assert.equal(options.upsert, false);
        if (unavailable) return { error: new Error('private provider details') };
        if (files.has(id)) return { error: new Error('Already exists') };
        files.set(id, Buffer.from(await blob.arrayBuffer()));
        return { error: null };
      },
      async remove(ids) { ids.forEach(id => files.delete(id)); return { error: null }; },
    };
  } } };
  const request = async (url, options) => {
    requests.push({ url, ...options });
    assert.equal(options.headers.apikey, env.SUPABASE_STORAGE_KEY);
    assert.equal(options.headers.Authorization, undefined);
    if (unavailable) return Response.json({ message: 'private provider details' }, { status: 500 });
    const bytes = files.get(url.split('/').at(-1));
    if (!bytes) return Response.json({ statusCode: '404', message: 'Object not found' }, { status: 400 });
    const headers = { 'content-length': String(bytes.length), 'accept-ranges': 'bytes' };
    if (options.headers.Range) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
      const start = Number(match?.[1]), end = Number(match?.[2]);
      if (!match || start >= bytes.length || end < start) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${bytes.length}` } });
      headers['content-range'] = `bytes ${start}-${end}/${bytes.length}`;
      headers['content-length'] = String(end - start + 1);
      return new Response(options.method === 'HEAD' ? null : bytes.subarray(start, end + 1), { status: 206, headers });
    }
    return new Response(options.method === 'HEAD' ? null : bytes, { headers });
  };
  const fresh = () => createSupabaseProjectStorage(env, { client, request });
  return { files, requests, fresh, storage: fresh(), fail() { unavailable = true; } };
}

test('project storage chooses Supabase for configured/production deployments and rejects incomplete settings', () => {
  assert.equal(typeof createProjectStorage(env).read, 'function');
  assert.equal(typeof createProjectStorage({}).path, 'function');
  assert.equal(typeof createProjectStorage({ ...env, PROJECT_STORAGE_DRIVER: 'local' }).path, 'function');
  assert.throws(() => createProjectStorage({ NODE_ENV: 'production' }), /SUPABASE_URL/);
  assert.throws(() => createProjectStorage({ SUPABASE_URL: env.SUPABASE_URL }), /SUPABASE_STORAGE_KEY/);
  assert.throws(() => createProjectStorage({ PROJECT_STORAGE_DRIVER: 'invalid' }), /PROJECT_STORAGE_DRIVER/);
});

test('bucket setup is private, idempotent, and handles Supabase missing-bucket responses', async () => {
  for (const status of [400, 404]) {
    let options;
    const client = { storage: {
      async getBucket() { return { error: { status, message: 'Bucket not found' } }; },
      async createBucket(name, value) { assert.equal(name, 'project-files'); options = value; return {}; },
    } };
    assert.deepEqual(await ensureProjectBucket({}, client), { created: true });
    assert.deepEqual(options, { public: false });
    client.storage.getBucket = async () => ({ data: { public: false } });
    assert.deepEqual(await ensureProjectBucket({}, client), { created: false });
    client.storage.getBucket = async () => ({ data: { public: true } });
    await assert.rejects(ensureProjectBucket({}, client), /must be private/);
    client.storage.getBucket = async () => ({ error: { status: 401, message: 'Invalid credentials' } });
    await assert.rejects(ensureProjectBucket({}, client), /credentials/);
  }
});

test('bucket uploads validate signatures, survive adapter recreation, and compensate failed database writes', async () => {
  const f = storageFixture();
  const stage = await f.storage.stage();
  const path = join(stage, 'upload');
  const file = { path, size: image.length, originalname: 'test.png', mimetype: 'image/png', fieldname: 'media' };
  try {
    await writeFile(path, image);
    const saved = await f.storage.store(file);
    assert.equal(saved.type, 'image/png');
    assert.deepEqual(Buffer.from(await (await f.fresh().read(saved.id)).arrayBuffer()), image);
    await assert.rejects(createProject({ title: 'Test', description: 'Test', stack: 'JS', type: 'open', published: true }, [file], 1,
      { async createProject() { throw new Error('Database unavailable'); } }, f.storage), /Database unavailable/);
    assert.equal(f.files.size, 1);
    await writeFile(path, '<script>not an image</script>');
    await assert.rejects(f.storage.store(file), error => error.status === 415);
    assert.equal(f.files.size, 1);
    await writeFile(path, image);
    f.fail();
    await assert.rejects(f.storage.store(file), error => error.status === 503 && !error.message.includes('private provider'));
    await f.storage.remove([saved.id]);
    assert.equal(f.files.size, 0);
  } finally { await f.storage.discard(stage); }
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('bucket-backed owner, showroom, and feed routes stream files without bypassing permissions', async () => {
  const f = storageFixture();
  const id = randomUUID(), showroom = randomUUID(), project = randomUUID(), post = randomUUID();
  const file = { id, type: 'image/png', name: 'image.png', kind: 'media', size: image.length };
  f.files.set(id, image);
  let published = true;
  const database = {
    close: async () => {},
    findActiveSessionUser: async (_, user) => user === 1 ? { id: 1 } : null,
    findProjectFile: async (user, fileId) => user === 1 && fileId === id ? file : null,
    findFeedCover: async value => published && value === post ? file : null,
    findPublicProjectFile: async (s, p, value) => published && s === showroom && p === project && value === id ? file : null,
  };
  const jwtSecret = randomBytes(32);
  const token = signAccessToken({ id: randomUUID(), userId: 1 }, jwtSecret);
  const server = createAppServer({ database, projectStorage: f.storage, authConfig: { jwtSecret, secureCookies: false }, oauthConfig: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const owner = `/api/projects/files/${id}`;
  const publicPaths = [`/api/feed/posts/${post}/media`, `/api/showrooms/${showroom}/projects/${project}/files/${id}`];
  try {
    assert.equal((await fetch(base + owner)).status, 401);
    for (const path of [owner, ...publicPaths]) {
      const headers = path === owner ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(base + path, { headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
      const ranged = await fetch(base + path, { headers: { ...headers, Range: 'bytes=2-5' } });
      assert.equal(ranged.status, 206);
      assert.equal(ranged.headers.get('content-range'), `bytes 2-5/${image.length}`);
      assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), image.subarray(2, 6));
      assert.equal((await fetch(base + path, { headers: { ...headers, Range: 'bytes=999-1000' } })).status, 416);
      const head = await fetch(base + path, { method: 'HEAD', headers });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
    }
    published = false;
    const reads = f.requests.length;
    for (const path of publicPaths) assert.equal((await fetch(base + path)).status, 404);
    assert.equal(f.requests.length, reads);
    published = true;
    f.files.delete(id);
    for (const path of publicPaths) assert.equal((await fetch(base + path)).status, 404);
    f.fail();
    for (const path of publicPaths) {
      const response = await fetch(base + path);
      assert.equal(response.status, 503);
      assert.doesNotMatch(await response.text(), /private provider|sb_secret/);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

