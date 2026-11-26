import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { createAppServer } from '../src/server.js';
import { openDatabase } from '../src/db/database.js';
import { applyMigrations } from '../src/db/migrations.js';
import { createSearchOperations, searchSuggestionsSql } from '../src/db/searchDatabase.js';
import { createFileStorage } from '../src/services/fileStorageService.js';
import { openTestDatabase } from './postgres-fixture.js';

const integration = { skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to an isolated _test database.' };

async function fixture() {
  const f = await openTestDatabase();
  const directory = await mkdtemp(join(tmpdir(), 'folio-search-'));
  const database = await openDatabase(f.config);
  const server = createAppServer({ database, projectStorage: createFileStorage(directory),
    authConfig: { jwtSecret: randomBytes(32), secureCookies: false }, oauthConfig: {} });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, options) => fetch(base + path, options);
  const search = async (q, limit) => {
    const response = await request(`/search/suggestions?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ''}`);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  };
  const user = async (name, profileName) => {
    const { rows: [row] } = await f.inspection.query(`INSERT INTO portfolio.users(name, email, password_hash)
      VALUES ($1, $2, 'private hash') RETURNING id, name, email, showroom_id AS "showroomId"`, [name, `${randomUUID()}@private.example`]);
    if (profileName !== undefined) {
      row.profileId = randomUUID();
      await f.inspection.query(`INSERT INTO portfolio.profiles(owner_id, public_id, fields) VALUES ($1, $2, $3)`,
        [row.id, row.profileId, { name: profileName, email: 'private@example.com', summary: 'Private projection check' }]);
    }
    return row;
  };
  const project = async (owner, title, published = true, type = 'open') => {
    const row = { id: randomUUID(), ownerId: owner.id, title, published, type, description: 'description-only-token', stack: 'stack-only-token',
      collaborationNotes: 'notes-only-token', notes: null, media: [{ id: randomUUID(), name: 'filename-only-token.png', type: 'image/png', size: 20 }], build: null };
    await database.createProject(row);
    return row;
  };
  return { ...f, database, base, request, search, user, project,
    async cleanup() { await new Promise(resolve => server.close(resolve)); await f.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('public search ranks names across users/projects, deduplicates aliases and uses safe public destinations', integration, async () => {
  const f = await fixture();
  try {
    const owner = await f.user('Creator');
    const account = await f.user('Fócus', 'Focus Studio');
    const alias = await f.user('Other account', 'Focus');
    const middle = await f.user('My Focus Work');
    const exact = await f.project(owner, 'Focus', true, 'private');
    const prefix = await f.project(owner, 'Focus Desktop');
    await f.project(owner, 'A Focus tool');
    await f.project(owner, 'Focus draft', false);
    await f.inspection.query("INSERT INTO portfolio.project_collaborators(project_id, user_id, role) VALUES ($1, $2, 'team_member')", [exact.id, middle.id]);
    const result = await f.search('  FOCUS  ');
    assert.equal(result.query, 'FOCUS');
    assert.deepEqual(result.suggestions.map(row => [row.type, row.label]), [
      ['user', 'Focus'], ['project', 'Focus'], ['user', 'Focus Studio'], ['project', 'Focus Desktop'],
      ['project', 'A Focus tool'], ['user', 'My Focus Work'],
    ]);
    assert.equal(result.hasMore, false);
    const byId = new Map(result.suggestions.map(row => [row.id, row]));
    assert.deepEqual(byId.get(account.showroomId), { type: 'user', id: account.showroomId, label: 'Focus Studio', accountName: 'Fócus', email: account.email, showroomId: account.showroomId, profileId: account.profileId });
    assert.equal(byId.get(alias.showroomId).profileId, alias.profileId);
    assert.deepEqual(byId.get(exact.id), { type: 'project', id: exact.id, label: 'Focus', creatorName: owner.name, showroomId: owner.showroomId });
    assert.equal(result.suggestions.filter(row => row.id === exact.id).length, 1);
    assert.equal((await f.request(`/showrooms/${owner.showroomId}/projects/${exact.id}`)).status, 200);
    assert.equal((await f.request(`/profiles/${account.profileId}`)).status, 200);
    assert.equal((await f.request(`/showrooms/${middle.showroomId}/projects`)).status, 200);
    for (const row of result.suggestions) {
      assert.deepEqual(Object.keys(row).sort(), (row.type === 'user'
        ? ['type', 'id', 'label', 'accountName', 'email', 'showroomId', 'profileId'] : ['type', 'id', 'label', 'creatorName', 'showroomId']).sort());
    }
    const stale = await f.request('/search/suggestions?q=FOCUS', { headers: { Authorization: 'Bearer expired-token', Cookie: 'portfolio_refresh=stale' } });
    assert.deepEqual(await stale.json(), result);
    for (const hidden of ['description-only-token', 'stack-only-token', 'notes-only-token', 'filename-only-token', 'private@example.com']) {
      assert.deepEqual((await f.search(hidden)).suggestions, []);
    }
    const idTie1 = await f.user('Equal name'), idTie2 = await f.user('Equal name');
    const duplicates = (await f.search('equal name')).suggestions;
    assert.deepEqual(duplicates.map(row => row.id), [idTie1.showroomId, idTie2.showroomId].sort());
    assert.deepEqual(duplicates.map(row => row.email).sort(), [idTie1.email, idTie2.email].sort());
    assert.ok(duplicates.every(row => row.profileId === null));
    assert.deepEqual((await f.search(idTie1.email)).suggestions, []);
    assert.notEqual(account.email, 'private@example.com');
    assert.equal(byId.get(prefix.id).label, prefix.title);
  } finally { await f.cleanup(); }
});

test('search handles literal patterns, Unicode, global bounds, and committed publication/profile changes', integration, async () => {
  const f = await fixture();
  try {
    const owner = await f.user('José Example', '');
    assert.equal((await f.search('JOSE')).suggestions[0].label, 'José Example');
    assert.equal((await f.search('Jose\u0301')).suggestions[0].label, 'José Example');
    const asian = await f.user('東京 太郎');
    assert.equal((await f.search('東京')).suggestions[0].id, asian.showroomId);
    for (const title of ['50% rate', 'under_score', 'hello!world', 'path\\file', "O'Reilly"]) {
      const row = await f.project(owner, title);
      assert.equal((await f.search(title)).suggestions[0].id, row.id);
    }
    for (const q of ['% rate', '_score', '!world', '\\file', "O'Reilly", "'; DROP TABLE portfolio.users;--"]) await f.search(q);
    assert.equal((await f.search('under%score')).suggestions.length, 0);
    assert.equal((await f.search('hello_world')).suggestions.length, 0);
    const project = await f.project(owner, 'Needle draft', false);
    assert.equal((await f.search('needle')).suggestions.length, 0);
    await f.inspection.query('UPDATE portfolio.projects SET published = true WHERE id = $1', [project.id]);
    assert.equal((await f.search('needle')).suggestions[0].id, project.id);
    await f.inspection.query("UPDATE portfolio.projects SET title = 'Renamed project' WHERE id = $1", [project.id]);
    assert.equal((await f.search('needle')).suggestions.length, 0);
    await f.inspection.query('UPDATE portfolio.projects SET published = false WHERE id = $1', [project.id]);
    assert.equal((await f.search('renamed')).suggestions.length, 0);
    await f.inspection.query("UPDATE portfolio.profiles SET fields = '{\"name\":\"Renamed account\"}' WHERE owner_id = $1", [owner.id]);
    assert.equal((await f.search('renamed')).suggestions[0].profileId, owner.profileId);
    await f.inspection.query('DELETE FROM portfolio.profiles WHERE owner_id = $1', [owner.id]);
    assert.equal((await f.search('renamed')).suggestions.length, 0);
    assert.equal((await f.search('jose')).suggestions[0].profileId, null);
    for (let index = 0; index < 21; index++) await f.project(owner, `Bound ${String(index).padStart(2, '0')}`);
    assert.equal((await f.search('bound')).suggestions.length, 10);
    assert.equal((await f.search('bound')).hasMore, true);
    const bounded = await f.search('bound', 20);
    assert.equal(bounded.suggestions.length, 20);
    assert.equal(bounded.hasMore, true);
    assert.equal((await f.search('bound 00', 1)).hasMore, false);
    assert.equal((await f.search('bound', 1)).suggestions[0].label, 'Bound 00');
    await f.inspection.query('DELETE FROM portfolio.projects WHERE id = $1', [bounded.suggestions[0].id]);
    assert.equal((await f.search('bound', 1)).suggestions[0].label, 'Bound 01');
  } finally { await f.cleanup(); }
});

test('search validates HTTP queries before database access and returns safe failures', async () => {
  let calls = 0;
  const database = { close: async () => {}, async searchSuggestions() { calls++; throw new Error('postgres://private-password internal details'); } };
  const server = createAppServer({ database, authConfig: { jwtSecret: randomBytes(32), secureCookies: false }, oauthConfig: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/search/suggestions`;
  try {
    for (const query of ['q=', 'q=%20', 'q=a', 'q=%F0%9F%A7%91']) {
      const response = await fetch(`${base}?${query}`);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).suggestions, []);
    }
    for (const query of ['', 'q=ab&q=cd', 'q[x]=ab', 'q=ab&limit=1&limit=2', 'q=ab&limit=21', 'q=ab&cursor=x', 'q=ab&limit=', 'q=%00', `q=${'x'.repeat(101)}`]) {
      const response = await fetch(`${base}?${query}`);
      assert.equal(response.status, 400, query);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal(calls, 0);
    const response = await fetch(`${base}?q=ab`);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private-password|internal details/);
    assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('search timeout rolls back and returns the pooled connection to its original timeout', integration, async () => {
  const f = await openTestDatabase();
  const pool = new Pool({ ...f.config, max: 1 });
  const locker = await f.inspection.connect();
  try {
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE portfolio.users IN ACCESS EXCLUSIVE MODE');
    await assert.rejects(createSearchOperations(pool).searchSuggestions({ q: 'ab', limit: 10 }), error => error.code === '57014');
    await locker.query('ROLLBACK');
    assert.equal((await pool.query('SHOW statement_timeout')).rows[0].statement_timeout, '0');
    assert.deepEqual(await createSearchOperations(pool).searchSuggestions({ q: 'ab', limit: 10 }), []);
  } finally { await locker.query('ROLLBACK'); locker.release(); await pool.end(); await f.close(); }
});

test('search migration preserves records and uses existing extension schemas and runtime grants', integration, async () => {
  const f = await openTestDatabase();
  let madeRole = false;
  let originalSchemas;
  try {
    const { rows } = await f.inspection.query(`SELECT e.extname, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname IN ('unaccent', 'pg_trgm')`);
    originalSchemas = rows;
    const { rows: [account] } = await f.inspection.query("INSERT INTO portfolio.users(name,email,password_hash) VALUES ('Áccent','migration@example.com','hash') RETURNING id, showroom_id");
    await f.inspection.query('DROP INDEX portfolio.search_users_name_idx, portfolio.search_profiles_name_idx, portfolio.search_projects_title_idx');
    await f.inspection.query('DROP FUNCTION portfolio.search_normalize(text)');
    await f.inspection.query("DELETE FROM portfolio.schema_migrations WHERE filename = '009_add_search_indexes.sql'");
    await f.inspection.query('CREATE SCHEMA uc006_extension_test');
    await f.inspection.query('ALTER EXTENSION unaccent SET SCHEMA uc006_extension_test');
    await f.inspection.query('ALTER EXTENSION pg_trgm SET SCHEMA uc006_extension_test');
    const { rows: [role] } = await f.inspection.query("SELECT EXISTS(SELECT FROM pg_roles WHERE rolname = 'portfolio_app') AS present");
    if (!role.present) { await f.inspection.query('CREATE ROLE portfolio_app'); madeRole = true; }
    assert.deepEqual(await applyMigrations(f.inspection), ['009_add_search_indexes.sql']);
    assert.deepEqual(await applyMigrations(f.inspection), []);
    assert.deepEqual((await f.inspection.query('SELECT id, showroom_id FROM portfolio.users')).rows, [account]);
    const client = await f.inspection.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE portfolio_app');
      assert.equal((await client.query(searchSuggestionsSql, ['accent', 11])).rows[0].id, account.showroom_id);
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      for (const [table, expression, index] of [
        ['users', 'portfolio.search_normalize(name)', 'search_users_name_idx'],
        ['profiles', "portfolio.search_normalize(COALESCE(fields ->> 'name', ''))", 'search_profiles_name_idx'],
        ['projects', 'portfolio.search_normalize(title)', 'search_projects_title_idx'],
      ]) {
        const plan = await client.query(`EXPLAIN SELECT * FROM portfolio.${table} WHERE ${table === 'projects' ? 'published AND ' : ''}${expression} LIKE '%accent%'`);
        assert.match(plan.rows.map(row => row['QUERY PLAN']).join('\n'), new RegExp(index));
      }
      await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK'); client.release(); }
  } finally {
    await f.inspection.query('DROP SCHEMA IF EXISTS portfolio CASCADE');
    if (originalSchemas) {
      for (const row of originalSchemas) {
        const quoted = '"' + row.nspname.replaceAll('"', '""') + '"';
        await f.inspection.query(`ALTER EXTENSION ${row.extname} SET SCHEMA ${quoted}`);
      }
    }
    await f.inspection.query('DROP SCHEMA IF EXISTS uc006_extension_test CASCADE');
    if (madeRole) { await f.inspection.query('DROP OWNED BY portfolio_app'); await f.inspection.query('DROP ROLE portfolio_app'); }
    await f.close();
  }
});
