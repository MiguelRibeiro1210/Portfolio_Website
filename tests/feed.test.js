import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import jwt from 'jsonwebtoken';
import { createAppServer } from '../src/server.js';
import { openDatabase } from '../src/db/database.js';
import { applyMigrations } from '../src/db/migrations.js';
import { createFileStorage } from '../src/services/fileStorageService.js';
import { loadEnvironment } from '../src/config/env.js';
import { openTestDatabase } from './postgres-fixture.js';

loadEnvironment();
const integration = { skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to a separate disposable _test database.' };
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5qEAAAAASUVORK5CYII=', 'base64');
const details = { title: 'Feed project', type: 'private', description: 'Discover this project', stack: 'JavaScript', published: true };

async function startFixture() {
  const fixture = await openTestDatabase();
  const directory = await mkdtemp(join(tmpdir(), 'folio-feed-'));
  const storage = createFileStorage(directory);
  const jwtSecret = randomBytes(32);
  let server;
  let base;
  const start = async () => {
    server = createAppServer({ databaseConfig: fixture.config, projectStorage: storage, authConfig: { jwtSecret, secureCookies: false }, oauthConfig: {} });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/api`;
  };
  const stop = () => new Promise(resolve => server.close(resolve));
  await start();
  const request = (path, { token, data, raw, method = 'GET', headers = {} } = {}) => fetch(base + path, {
    method, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(data !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw !== undefined ? raw : data === undefined ? undefined : JSON.stringify(data),
  });
  const account = async email => {
    const data = { name: 'Feed Author', email, password: 'sample-password' };
    const registration = await request('/register', { method: 'POST', data });
    assert.equal(registration.status, 201);
    const { user } = await registration.json();
    const login = await request('/login', { method: 'POST', data });
    assert.equal(login.status, 200);
    return { user, token: (await login.json()).accessToken, cookie: login.headers.get('set-cookie').split(';')[0] };
  };
  const project = async (owner, input = details) => {
    const body = new FormData();
    body.append('project', JSON.stringify(input));
    body.append('media', new Blob([image], { type: 'image/png' }), 'first.png');
    const response = await fetch(base + '/projects', { method: 'POST', body, headers: { Authorization: `Bearer ${owner.token}` } });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).project;
  };
  return { ...fixture, directory, storage, jwtSecret, account, project, request,
    async restart() { await stop(); await start(); },
    async cleanup() { if (server?.listening) await stop(); await fixture.close(); await rm(directory, { recursive: true, force: true }); },
  };
}

test('feed is public, cursor-paginated, precise, and exposes only published public summaries', integration, async () => {
  const f = await startFixture();
  try {
    assert.deepEqual(await (await f.request('/feed')).json(), { posts: [], nextCursor: null });
    const owner = await f.account('author@example.com');
    const other = await f.account('other@example.com');
    const draft = await f.project(owner, { ...details, title: 'Secret draft', published: false });
    const publicProject = await f.project(owner);
    assert.equal((await f.inspection.query('SELECT count(*)::int AS n FROM portfolio.feed_posts')).rows[0].n, 1);
    let response = await f.request('/feed');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { posts: [post] } = await response.json();
    assert.deepEqual(Object.keys(post).sort(), ['author', 'commentCount', 'cover', 'createdAt', 'id', 'likeCount', 'project', 'viewerHasLiked'].sort());
    const { rows: [ownerIds] } = await f.inspection.query('SELECT showroom_id FROM portfolio.users WHERE id = $1', [owner.user.id]);
    assert.deepEqual(post.author, { id: owner.user.id, name: owner.user.name, showroomId: ownerIds.showroom_id, profileId: null });
    assert.equal((await f.request(`/showrooms/${post.author.showroomId}/projects/${post.project.id}`)).status, 200);
    const profileBody = new FormData();
    profileBody.set('name', owner.user.name);
    const savedProfile = await fetch(new URL('/api/profile/me', response.url), {
      method: 'PUT', headers: { Authorization: `Bearer ${owner.token}` }, body: profileBody,
    });
    assert.equal(savedProfile.status, 200);
    const { profile } = await savedProfile.json();
    const refreshed = await (await f.request('/feed')).json();
    assert.equal(refreshed.posts[0].author.profileId, profile.publicId);
    assert.equal((await f.request(`/profiles/${refreshed.posts[0].author.profileId}`)).status, 200);
    assert.deepEqual(post.project, { id: publicProject.id, title: details.title, type: 'private', description: details.description, stack: details.stack });
    assert.deepEqual(Object.keys(post.cover).sort(), ['name', 'type', 'url']);
    assert.equal(post.likeCount, 0);
    assert.equal(post.viewerHasLiked, false);
    assert.equal(post.cover.url, `/api/feed/posts/${post.id}/media`);
    assert.equal((await f.request(`/projects/${publicProject.id}`, { token: other.token })).status, 404);
    assert.equal((await f.request(`/projects/files/${publicProject.media[0].id}`)).status, 401);
    assert.equal((await f.request(`/feed/posts/${draft.id}/comments`)).status, 404);
    assert.equal((await f.request('/feed', { token: 'bad-token' })).status, 401);
    assert.equal((await f.request('/feed', { headers: { Authorization: '' } })).status, 401);

    // Database-level setup lets us control exact microsecond timestamps for page boundaries.
    for (let i = 0; i < 11; i++) await f.project(owner, { ...details, title: `Page project ${i}` });
    await f.inspection.query("UPDATE portfolio.feed_posts SET created_at = '2026-11-23T10:00:00.123456Z'");
    const { rows: ordered } = await f.inspection.query('SELECT id FROM portfolio.feed_posts ORDER BY created_at DESC, id DESC');
    const first = await (await f.request('/feed')).json();
    assert.equal(first.posts.length, 10);
    assert.ok(first.nextCursor);
    assert.deepEqual(first.posts.map(p => p.id), ordered.slice(0, 10).map(p => p.id));
    const cursor = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString());
    assert.equal(cursor.time, '2026-11-23T10:00:00.123456Z');
    const second = await (await f.request('/feed?cursor=' + first.nextCursor)).json();
    assert.deepEqual(second.posts.map(p => p.id), ordered.slice(10).map(p => p.id));
    assert.equal(second.nextCursor, null);
    assert.equal((await (await f.request('/feed?limit=1')).json()).posts.length, 1);
    assert.equal((await (await f.request('/feed?limit=50')).json()).posts.length, 12);
    // A newly inserted, newer post must not move the existing older-page boundary.
    const latest = await f.project(owner, { ...details, title: 'A new publication' });
    await f.inspection.query("UPDATE portfolio.feed_posts SET created_at = '2026-11-23T11:00:00.000001Z' WHERE project_id = $1", [latest.id]);
    const afterInsert = await (await f.request('/feed?cursor=' + first.nextCursor)).json();
    assert.deepEqual(afterInsert, second);
    for (const query of ['limit=0', 'limit=51', 'limit=1.5', 'limit=10&limit=20', 'cursor=', 'cursor=garbage', 'ownerId=1', 'cursor=x&cursor=y']) {
      response = await f.request('/feed?' + query);
      assert.equal(response.status, 400, query);
    }
    assert.equal((await f.inspection.query('SELECT count(*)::int AS n FROM portfolio.feed_posts')).rows[0].n, 13);
    await f.restart();
    assert.equal((await (await f.request('/feed?limit=50')).json()).posts.length, 13);
  } finally { await f.cleanup(); }
});

test('feed likes and comments use active identities, serialize changes, and survive reload', integration, async () => {
  const f = await startFixture();
  try {
    const owner = await f.account('owner@example.com');
    const other = await f.account('commenter@example.com');
    const project = await f.project(owner);
    const { posts: [post] } = await (await f.request('/feed')).json();
    const path = `/feed/posts/${post.id}`;
    assert.deepEqual(await (await f.request(path + '/comments')).json(), { comments: [], nextCursor: null });
    for (const method of ['PUT', 'DELETE']) assert.equal((await f.request(path + '/like', { method })).status, 401);
    assert.equal((await f.request(path + '/comments', { method: 'POST', data: { text: 'hello' } })).status, 401);
    const likes = await Promise.all(Array.from({ length: 6 }, () => f.request(path + '/like', { method: 'PUT', token: owner.token })));
    for (const response of likes) { assert.equal(response.status, 200); assert.deepEqual(await response.json(), { likeCount: 1, viewerHasLiked: true }); }
    assert.equal((await f.inspection.query('SELECT count(*)::int AS n FROM portfolio.post_likes')).rows[0].n, 1);
    assert.deepEqual(await (await f.request(path + '/like', { method: 'PUT', token: other.token, data: { userId: owner.user.id } })).json(), { likeCount: 2, viewerHasLiked: true });
    assert.equal((await (await f.request('/feed', { token: owner.token })).json()).posts[0].viewerHasLiked, true);
    assert.equal((await (await f.request('/feed')).json()).posts[0].viewerHasLiked, false);
    const unlikes = await Promise.all(Array.from({ length: 4 }, () => f.request(path + '/like', { method: 'DELETE', token: owner.token })));
    for (const response of unlikes) assert.deepEqual(await response.json(), { likeCount: 1, viewerHasLiked: false });
    for (const data of [{}, [], null, { text: ' ' }, { text: 1 }, { text: 'x'.repeat(1001) }, { text: 'hello', userId: owner.user.id }, { text: '\0' }]) {
      assert.equal((await f.request(path + '/comments', { method: 'POST', token: other.token, data })).status, 400);
    }
    assert.equal((await f.request(path + '/comments', { method: 'POST', token: other.token, raw: '{' })).status, 400);
    assert.equal((await f.request(path + '/comments', { method: 'POST', token: other.token, raw: 'x', headers: { 'Content-Type': 'text/plain' } })).status, 400);
    assert.equal((await f.request(path + '/comments', { method: 'POST', token: other.token, data: { text: 'x'.repeat(18000) } })).status, 413);
    const saved = await f.request(path + '/comments', { method: 'POST', token: other.token, data: { text: '  <script>plain text</script>  ' } });
    assert.equal(saved.status, 201);
    const result = await saved.json();
    assert.equal(result.comment.text, '<script>plain text</script>');
    assert.deepEqual(result.comment.author, { id: other.user.id, name: other.user.name });
    assert.equal(result.commentCount, 1);
    assert.deepEqual(Object.keys(result.comment).sort(), ['id', 'postId', 'text', 'createdAt', 'author'].sort());
    // Multiple writers are serialized, with one confirmed count per committed comment.
    const writes = await Promise.all(Array.from({ length: 21 }, (_, i) => f.request(path + '/comments', { method: 'POST', token: other.token, data: { text: `Comment ${i}` } })));
    const counts = [];
    for (const response of writes) { assert.equal(response.status, 201); counts.push((await response.json()).commentCount); }
    assert.deepEqual(counts.sort((a, b) => a - b), Array.from({ length: 21 }, (_, i) => i + 2));
    await f.inspection.query("UPDATE portfolio.post_comments SET created_at = '2026-11-23T09:01:02.456789Z'");
    const comments = await (await f.request(path + '/comments')).json();
    assert.equal(comments.comments.length, 20);
    assert.ok(comments.nextCursor);
    const remaining = await (await f.request(path + '/comments?cursor=' + comments.nextCursor)).json();
    assert.equal(remaining.comments.length, 2);
    assert.equal(remaining.nextCursor, null);
    assert.equal(new Set([...comments.comments, ...remaining.comments].map(c => c.id)).size, 22);
    const { rows: expected } = await f.inspection.query('SELECT id FROM portfolio.post_comments ORDER BY created_at, id');
    assert.deepEqual([...comments.comments, ...remaining.comments].map(c => c.id), expected.map(c => c.id));
    assert.equal((await f.request('/feed?cursor=' + comments.nextCursor)).status, 400);
    assert.equal((await f.request(path + '/comments?limit=100')).status, 400);
    const feedPost = (await (await f.request('/feed', { token: other.token })).json()).posts[0];
    assert.equal(feedPost.commentCount, 22);
    assert.equal(feedPost.likeCount, 1);
    assert.equal(feedPost.viewerHasLiked, true);
    await f.restart();
    assert.equal((await (await f.request('/feed', { token: other.token })).json()).posts[0].commentCount, 22);
    const claims = jwt.decode(other.token);
    const expired = jwt.sign({ sid: claims.sid }, f.jwtSecret, { subject: claims.sub, issuer: claims.iss, audience: claims.aud, expiresIn: -1 });
    assert.equal((await f.request(path + '/like', { method: 'PUT', token: expired })).status, 401);
    assert.equal((await f.request('/logout', { method: 'POST', headers: { Cookie: other.cookie } })).status, 204);
    assert.equal((await f.request(path + '/comments', { method: 'POST', token: other.token, data: { text: 'rejected' } })).status, 401);
    assert.equal((await f.request('/feed', { token: other.token })).status, 401);
    assert.equal((await f.request(path + '/comments')).status, 200);
    assert.equal((await f.request(`/feed/posts/${randomUUID()}/like`, { method: 'PUT', token: owner.token })).status, 404);
    assert.equal((await f.request('/feed/posts/not-an-id/comments')).status, 404);
    assert.ok(project.id);
  } finally { await f.cleanup(); }
});

test('cover selection excludes builds, supports ranges, and follows publish/update/delete lifecycle', integration, async () => {
  const f = await startFixture();
  let database;
  try {
    const owner = await f.account('media@example.com');
    const project = await f.project(owner, { ...details, published: false });
    database = await openDatabase(f.config);
    const original = await database.findProject(owner.user.id, project.id);
    const publish = await database.updateProject({ ...original, published: true }, original.revision);
    const { posts: [post] } = await (await f.request('/feed')).json();
    const path = `/feed/posts/${post.id}`;
    assert.equal(post.project.id, project.id);
    const video = { id: randomUUID(), name: 'first.mp4', type: 'video/mp4', size: 16, position: 0 };
    const build = { id: randomUUID(), name: 'build.zip', type: 'application/zip', size: 4, permission: 'none' };
    await writeFile(f.storage.path(video.id), Buffer.from('0123456789abcdef'));
    await writeFile(f.storage.path(build.id), Buffer.from('PKxx'));
    const edited = await database.updateProject({ ...publish.project, media: [video, ...publish.project.media], build }, publish.revision);
    assert.equal((await (await f.request('/feed')).json()).posts[0].cover.type, 'image/png');
    const imageResponse = await f.request(path + '/media');
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('cache-control'), 'no-store');
    assert.equal(imageResponse.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(imageResponse.headers.get('content-disposition'), 'inline');
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), image);
    assert.equal((await f.request(`/feed/posts/${build.id}/media`)).status, 404);
    // Removing the image changes the derived cover to the first video, without duplicating the post.
    const videoOnly = await database.updateProject({ ...edited.project, media: [video] }, edited.revision);
    assert.equal((await (await f.request('/feed')).json()).posts[0].cover.type, 'video/mp4');
    const ranged = await f.request(path + '/media', { headers: { Range: 'bytes=2-5' } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), 'bytes 2-5/16');
    assert.equal(await ranged.text(), '2345');
    assert.equal((await f.request(path + '/media', { headers: { Range: 'bytes=999-1000' } })).status, 416);
    await rm(f.storage.path(video.id));
    assert.equal((await f.request(path + '/media')).status, 404);
    assert.equal((await (await f.request('/feed')).json()).posts.length, 1);
    const hidden = await database.updateProject({ ...videoOnly.project, published: false }, videoOnly.revision);
    assert.deepEqual((await (await f.request('/feed')).json()).posts, []);
    for (const suffix of ['/media', '/comments']) assert.equal((await f.request(path + suffix)).status, 404);
    assert.equal((await f.request(path + '/like', { method: 'PUT', token: owner.token })).status, 404);
    assert.equal((await f.request(path + '/comments', { method: 'POST', token: owner.token, data: { text: 'hidden' } })).status, 404);
    const shown = await database.updateProject({ ...hidden.project, published: true }, hidden.revision);
    assert.equal((await (await f.request('/feed')).json()).posts[0].id, post.id);
    assert.equal((await f.inspection.query('SELECT count(*)::int AS n FROM portfolio.feed_posts')).rows[0].n, 1);
    await f.request(path + '/like', { method: 'PUT', token: owner.token });
    await f.request(path + '/comments', { method: 'POST', token: owner.token, data: { text: 'hello' } });
    await database.deleteProject(owner.user.id, project.id, shown.revision);
    for (const table of ['feed_posts', 'post_likes', 'post_comments']) assert.equal((await f.inspection.query(`SELECT count(*)::int AS n FROM portfolio.${table}`)).rows[0].n, 0);
  } finally { await database?.close(); await f.cleanup(); }
});

test('feed migration backfills existing publications and project/post writes roll back together', integration, async () => {
  const fixture = await openTestDatabase();
  let database;
  try {
    // Simulate an installation at migration 006 inside the exclusively owned disposable schema.
    await fixture.inspection.query('DROP TABLE portfolio.post_comments, portfolio.post_likes, portfolio.feed_posts');
    await fixture.inspection.query("DELETE FROM portfolio.schema_migrations WHERE filename = '007_create_feed_tables.sql'");
    const { rows: [owner] } = await fixture.inspection.query("INSERT INTO portfolio.users (name, email, password_hash) VALUES ('Legacy', 'legacy-feed@example.com', '') RETURNING id");
    const publishedId = randomUUID(), draftId = randomUUID();
    for (const [id, published] of [[publishedId, true], [draftId, false]]) {
      await fixture.inspection.query(`INSERT INTO portfolio.projects (id, owner_id, title, type, description, stack, published, created_at)
        VALUES ($1, $2, 'Existing', 'open', 'Existing description', 'JS', $3, '2026-01-01T01:02:03.123456Z')`, [id, owner.id, published]);
    }
    assert.deepEqual(await applyMigrations(fixture.inspection), ['007_create_feed_tables.sql']);
    assert.deepEqual(await applyMigrations(fixture.inspection), []);
    const migration = await readFile(new URL('../src/db/migrations/007_create_feed_tables.sql', import.meta.url), 'utf8');
    const backfill = migration.slice(migration.indexOf('INSERT INTO portfolio.feed_posts'), migration.indexOf('\nDO $$'));
    await fixture.inspection.query(backfill);
    const { rows } = await fixture.inspection.query("SELECT project_id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS time FROM portfolio.feed_posts");
    assert.deepEqual(rows, [{ project_id: publishedId, time: '2026-01-01T01:02:03.123456Z' }]);
    database = await openDatabase(fixture.config);
    // Force the final feed insert to fail, after the project associations have been written.
    await fixture.inspection.query(`CREATE FUNCTION portfolio.fail_feed_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated feed failure'; END $$;
      CREATE TRIGGER fail_feed BEFORE INSERT ON portfolio.feed_posts FOR EACH ROW EXECUTE FUNCTION portfolio.fail_feed_insert()`);
    const rejectedId = randomUUID();
    await assert.rejects(database.createProject({ ...details, id: rejectedId, ownerId: owner.id, notes: null,
      media: [{ id: randomUUID(), name: 'test.png', type: 'image/png', size: 42 }], build: null }));
    assert.equal((await fixture.inspection.query('SELECT count(*)::int AS n FROM portfolio.projects WHERE id = $1', [rejectedId])).rows[0].n, 0);
    assert.equal((await fixture.inspection.query('SELECT count(*)::int AS n FROM portfolio.project_files WHERE project_id = $1', [rejectedId])).rows[0].n, 0);
    await fixture.inspection.query('DROP TRIGGER fail_feed ON portfolio.feed_posts; DROP FUNCTION portfolio.fail_feed_insert()');
  } finally { await database?.close(); await fixture.close(); }
});
