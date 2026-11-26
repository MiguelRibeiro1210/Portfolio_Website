import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { createAppServer } from '../src/server.js';
import { openDatabase } from '../src/db/database.js';
import { createFileStorage } from '../src/services/fileStorageService.js';
import { createProject } from '../src/services/projectService.js';
import { loadEnvironment } from '../src/config/env.js';
import { openTestDatabase } from './postgres-fixture.js';

loadEnvironment();
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5qEAAAAASUVORK5CYII=', 'base64');
const archive = Buffer.from('504b0506000000000000000000000000000000000000', 'hex');
const details = { title: ' Focus timer ', type: 'open', description: ' A useful timer ', stack: ' JavaScript ', published: true };

// An injected database failure verifies compensating cleanup independently of PostgreSQL.
test('project service cleans stored files when storage or database fails', async () => {
  const files = [{ fieldname: 'media', size: 50, originalname: 'one.png' }, { fieldname: 'build', size: 50, originalname: 'one.zip' }];
  for (const failStorage of [false, true]) {
    const removed = [];
    let calls = 0;
    const storage = {
      async store() { if (++calls === 2 && failStorage) throw new Error('storage failure'); return { id: String(calls) }; },
      async remove(ids) { removed.push(...ids); },
    };
    await assert.rejects(createProject({ ...details, permission: 'public' }, files, 1,
      { async createProject() { throw new Error('database failure'); } }, storage), /failure/);
    assert.deepEqual(removed, failStorage ? ['1'] : ['1', '2']);
  }
});

test('project API persists optional associations/files, enforces ownership, validates and rolls back', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to a disposable _test database.',
}, async () => {
  const fixture = await openTestDatabase();
  const directory = await mkdtemp(join(tmpdir(), 'folio-project-test-'));
  const storage = createFileStorage(directory);
  const jwtSecret = randomBytes(32);
  let server;
  let base;
  const start = async database => {
    server = createAppServer({ databaseConfig: fixture.config, database, authConfig: { jwtSecret, secureCookies: false }, oauthConfig: {}, projectStorage: storage });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}/api`;
  };
  const stop = () => new Promise(resolve => server.close(resolve));
  const headers = token => token ? { Authorization: `Bearer ${token}` } : {};
  const get = (path, token) => fetch(base + path, { headers: headers(token) });
  const create = (input, token, media = [{ name: 'first.png', type: 'image/png', bytes: image }], builds = []) => {
    const body = new FormData();
    body.append('project', typeof input === 'string' ? input : JSON.stringify(input));
    for (const file of media) body.append('media', new Blob([file.bytes], { type: file.type }), file.name);
    for (const file of builds) body.append('build', new Blob([file.bytes], { type: 'application/octet-stream' }), file.name);
    return fetch(base + '/projects', { method: 'POST', headers: headers(token), body });
  };
  const signIn = async email => {
    const data = { name: 'Project owner', email, password: 'sample-password' };
    const post = (path) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const registered = await post('/register');
    assert.equal(registered.status, 201);
    const user = (await registered.json()).user;
    const response = await post('/login');
    return { token: (await response.json()).accessToken, cookie: response.headers.get('Set-Cookie').split(';')[0], user };
  };
  try {
    await start();
    const owner = await signIn('owner@example.com');
    const other = await signIn('other@example.com');
    assert.equal((await create(details)).status, 401);
    assert.equal((await get('/projects', other.token)).status, 200);
    const minimal = await create(details, owner.token);
    assert.equal(minimal.status, 201, await minimal.clone().text());
    const { project } = await minimal.json();
    assert.equal(project.ownerId, owner.user.id);
    assert.equal(project.title, 'Focus timer');
    assert.equal(project.collaborators.length, 1);
    assert.equal(project.collaborators[0].role, 'owner');
    assert.equal(project.collaborators[0].creator, true);
    assert.equal(project.notes, null);
    assert.equal(project.build, null);
    assert.equal(project.media.length, 1);
    assert.equal(project.media[0].name, 'first.png');
    const file = await get(`/projects/files/${project.media[0].id}`, owner.token);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), image);
    assert.equal((await get(`/projects/files/${project.media[0].id}`, other.token)).status, 404);
    assert.equal((await get(`/projects/${project.id}`, other.token)).status, 404);
    assert.deepEqual((await (await get('/projects', other.token)).json()).projects, []);

    for (const type of ['open', 'private']) {
      const notesOnly = await create({ ...details, type, story: 'The idea' }, owner.token);
      assert.equal(notesOnly.status, 201);
      assert.equal((await notesOnly.json()).project.notes.story, 'The idea');
      const buildOnly = await create({ ...details, type, permission: 'none' }, owner.token, undefined, [{ name: 'release.zip', bytes: archive }]);
      assert.equal(buildOnly.status, 201);
      const withBuild = (await buildOnly.json()).project;
      assert.equal(withBuild.notes, null);
      assert.equal(withBuild.build.permission, 'none');
      assert.equal((await get(`/projects/files/${withBuild.build.id}`, owner.token)).status, 200);
    }
    const both = await create({ ...details, published: false, story: ' Idea ', compatibility: 'Linux', source: 'https://example.com/repo', releaseNotes: 'v1', permission: 'request' }, owner.token,
      [{ name: 'second.png', type: 'image/png', bytes: image }, { name: 'first.png', type: 'image/png', bytes: image }], [{ name: 'release.zip', bytes: archive }]);
    assert.equal(both.status, 201);
    const draft = (await both.json()).project;
    assert.equal(draft.published, false);
    assert.deepEqual(draft.notes, { story: 'Idea', compatibility: 'Linux', source: 'https://example.com/repo', releaseNotes: 'v1' });
    assert.deepEqual(draft.media.map(file => file.name), ['second.png', 'first.png']);
    const ownerShowroom = (await (await get('/projects/showroom', owner.token)).json()).showroom;
    const otherShowroom = (await (await get('/projects/showroom', other.token)).json()).showroom;
    const publicList = `/showrooms/${ownerShowroom.id}/projects`;
    const publicDetail = id => `${publicList}/${id}`;
    const publicFile = (row, file) => `${publicDetail(row.id)}/files/${file.id}`;
    const visitorList = await get(publicList);
    assert.equal(visitorList.status, 200);
    assert.equal(visitorList.headers.get('Cache-Control'), 'no-store');
    const listed = await visitorList.json();
    assert.equal(listed.showroom.id, ownerShowroom.id);
    assert.equal(listed.showroom.profileId, null);
    assert.equal(listed.projects.length, 5);
    assert.ok(listed.projects.every(item => item.published && !Object.hasOwn(item, 'ownerId')));
    assert.ok(!listed.projects.some(item => item.id === draft.id));
    assert.deepEqual((await (await get(publicList, other.token)).json()).projects, listed.projects);
    assert.deepEqual((await (await get(`/showrooms/${otherShowroom.id}/projects`)).json()).projects, []);
    assert.equal((await get('/showrooms/00000000-0000-0000-0000-000000000000/projects')).status, 404);
    assert.equal((await get(publicDetail(project.id))).status, 200);
    assert.equal((await get(publicDetail(draft.id))).status, 404);
    assert.equal((await get(publicFile(draft, draft.media[0]))).status, 404);
    assert.equal((await get(`/showrooms/${otherShowroom.id}/projects/${project.id}`)).status, 404);
    assert.equal((await get(publicFile(project, draft.media[0]))).status, 404);
    const publicImage = await get(publicFile(project, project.media[0]));
    assert.equal(publicImage.status, 200);
    assert.equal(publicImage.headers.get('Content-Disposition'), 'inline');
    assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), image);

    const filesBefore = (await readdir(directory)).filter(name => !name.startsWith('.upload-')).sort();
    const countBefore = (await fixture.inspection.query('SELECT count(*) FROM portfolio.projects')).rows[0].count;
    for (const input of ['{', null, [], { ...details, title: ' ' }, { ...details, description: '' }, { ...details, stack: '' }, { ...details, type: 'bad' }, { ...details, published: 'true' }, { ...details, source: 'javascript:alert(1)' }, { ...details, ownerId: other.user.id }, { ...details, title: 'x'.repeat(201) }]) {
      assert.equal((await create(input, owner.token)).status, 400, JSON.stringify(input));
    }
    assert.equal((await create(details, owner.token, [])).status, 400);
    assert.equal((await create(details, owner.token, undefined, [{ name: 'build.zip', bytes: archive }])).status, 400);
    assert.equal((await create({ ...details, permission: 'public' }, owner.token, undefined, [{ name: 'a.zip', bytes: archive }, { name: 'b.zip', bytes: archive }])).status, 400);
    assert.equal((await create(details, owner.token, [{ name: 'fake.png', type: 'image/png', bytes: Buffer.from('<script>bad</script>') }])).status, 415);
    // Valid media is stored before an invalid build: cleanup must remove that stored media too.
    assert.equal((await create({ ...details, permission: 'public' }, owner.token, undefined, [{ name: 'bad.zip', bytes: Buffer.from('not a zip') }])).status, 415);
    assert.equal((await create(details, owner.token, [{ name: 'huge.png', type: 'image/png', bytes: Buffer.alloc(20 * 1024 * 1024 + 1) }])).status, 413);
    assert.equal((await fixture.inspection.query('SELECT count(*) FROM portfolio.projects')).rows[0].count, countBefore);
    assert.deepEqual((await readdir(directory)).filter(name => !name.startsWith('.upload-')).sort(), filesBefore);
    assert.equal((await get('/projects/not-an-id', owner.token)).status, 404);
    assert.equal((await get('/projects/files/../../etc/passwd', owner.token)).status, 404);
    const expired = jwt.sign({ sub: String(owner.user.id), sid: jwt.decode(owner.token).sid }, jwtSecret, { expiresIn: -1 });
    assert.equal((await create(details, expired)).status, 401);

    // Restart both API and database pool, then verify durable data and bytes.
    await stop();
    await start();
    assert.equal((await get(`/projects/${draft.id}`, owner.token)).status, 200);
    assert.deepEqual(Buffer.from(await (await get(`/projects/files/${project.media[0].id}`, owner.token)).arrayBuffer()), image);
    assert.equal((await (await get('/projects', owner.token)).json()).projects.length, 6);

    // Force a real transaction failure after inserting the project: invalid owner FK on the file.
    const db = await openDatabase(fixture.config);
    const broken = { ...db, createProject: p => db.createProject({ ...p, media: [{ ...p.media[0], size: -1 }] }) };
    await stop();
    await start(broken);
    assert.equal((await create(details, owner.token)).status, 500);
    assert.equal((await fixture.inspection.query('SELECT count(*) FROM portfolio.projects')).rows[0].count, countBefore);
    assert.deepEqual((await readdir(directory)).filter(name => !name.startsWith('.upload-')).sort(), filesBefore);
    const draftUrl = `/projects/${draft.id}`;
    const existing = await get(draftUrl, owner.token);
    const originalRevision = existing.headers.get('ETag');
    assert.equal(originalRevision, '"1"');
    const [first, second] = draft.media;
    const edit = { ...details, title: 'Edited project', published: false, permission: 'public',
      buildAction: 'keep', mediaOrder: [{ fileId: second.id }, { fileId: first.id }] };
    const update = (input, tag, { token = owner.token, uploads = [], build } = {}) => {
      const body = new FormData();
      body.set('project', JSON.stringify(input));
      uploads.forEach(name => body.append('media', new Blob([image], { type: 'image/png' }), name));
      if (build) body.set('build', new Blob([archive]), build);
      return fetch(base + draftUrl, { method: 'PUT',
        headers: { ...headers(token), ...(tag ? { 'If-Match': tag } : {}) }, body });
    };
    const remove = (tag, token = owner.token) => fetch(base + draftUrl, {
      method: 'DELETE', headers: { ...headers(token), ...(tag ? { 'If-Match': tag } : {}) },
    });

    assert.equal((await update(edit, null)).status, 428);
    assert.equal((await update(edit, originalRevision, { token: other.token })).status, 404);
    assert.equal((await remove(originalRevision, other.token)).status, 404);
    assert.equal((await update({ ...edit, mediaOrder: [] }, originalRevision)).status, 400);
    assert.equal((await update({ ...edit, mediaOrder: [{ fileId: project.media[0].id }] }, originalRevision)).status, 400);
    assert.equal((await update({ ...edit, mediaOrder: [{ fileId: first.id }, { fileId: first.id }] }, originalRevision)).status, 400);
    assert.equal((await update(edit, originalRevision, { uploads: ['unreferenced.png'] })).status, 400);

    const races = await Promise.all([update(edit, originalRevision), update(edit, originalRevision)]);
    assert.deepEqual(races.map(response => response.status).sort(), [200, 412]);
    const saved = races.find(response => response.ok);
    const revised = saved.headers.get('ETag');
    const edited = (await saved.json()).project;
    assert.equal(edited.id, draft.id);
    assert.equal(edited.ownerId, draft.ownerId);
    assert.equal(edited.notes, null);
    assert.deepEqual(edited.media.map(media => media.id), [second.id, first.id]);
    assert.equal(edited.build.id, draft.build.id);
    assert.equal(edited.build.permission, 'public');
    assert.equal((await remove(originalRevision)).status, 412);

    await fixture.inspection.query("ALTER TABLE portfolio.projects ADD CHECK (title <> 'Database rejects edit')");
    const replace = { ...edit, title: 'Database rejects edit', published: true, story: 'New story',
      buildAction: 'replace', mediaOrder: [{ uploadIndex: 0 }, { fileId: first.id }] };
    assert.equal((await update(replace, revised, { uploads: ['third.png'], build: 'new.zip' })).status, 500);
    assert.equal((await get(draftUrl, owner.token)).headers.get('ETag'), revised);
    assert.deepEqual((await readdir(directory)).filter(name => !name.startsWith('.upload-')).sort(), filesBefore);

    const replaced = await update({ ...replace, title: 'Replacement' }, revised, { uploads: ['third.png'], build: 'new.zip' });
    assert.equal(replaced.status, 200, await replaced.clone().text());
    const finalProject = (await replaced.json()).project;
    assert.equal(finalProject.published, true);
    assert.equal(finalProject.notes.story, 'New story');
    assert.deepEqual(finalProject.media.map(media => media.name), ['third.png', first.name]);
    assert.equal(finalProject.media[1].id, first.id);
    assert.equal((await get(`/projects/files/${second.id}`, owner.token)).status, 404);
    assert.equal((await get(`/projects/files/${draft.build.id}`, owner.token)).status, 404);
    const shared = await get(publicDetail(finalProject.id));
    assert.equal(shared.status, 200);
    assert.deepEqual((await shared.json()).project.build, finalProject.build);
    const download = await get(publicFile(finalProject, finalProject.build));
    assert.equal(download.status, 200);
    assert.match(download.headers.get('Content-Disposition'), /attachment.*new\.zip/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), archive);

    let tag = replaced.headers.get('ETag');
    for (const permission of ['request', 'none']) {
      const restricted = await update({
        ...edit, type: 'private', source: 'https://example.com/private-repo', published: true,
        permission, mediaOrder: finalProject.media.map(file => ({ fileId: file.id })),
      }, tag);
      assert.equal(restricted.status, 200);
      tag = restricted.headers.get('ETag');
      const { project: sharedProject } = await (await get(publicDetail(finalProject.id))).json();
      assert.deepEqual(sharedProject.build, { permission });
      assert.equal(sharedProject.notes.source, '');
      assert.equal((await get(publicFile(finalProject, finalProject.build), other.token)).status, 404);
      assert.equal((await get(publicFile(finalProject, finalProject.build), owner.token)).status, 404);
      assert.equal((await get(`/projects/files/${finalProject.build.id}`, owner.token)).status, 200);
    }
    const removedBuild = await update({ ...edit, buildAction: 'remove', mediaOrder: [{ fileId: first.id }] }, tag);
    assert.equal(removedBuild.status, 200);
    assert.equal((await removedBuild.json()).project.build, null);
    assert.equal((await get(publicDetail(finalProject.id))).status, 404);
    assert.equal((await get(publicFile(finalProject, first))).status, 404);
    assert.equal((await get(`/projects/files/${finalProject.build.id}`, owner.token)).status, 404);
    assert.equal((await remove(null)).status, 428);
    assert.equal((await remove(removedBuild.headers.get('ETag'))).status, 204);
    assert.equal((await get(draftUrl, owner.token)).status, 404);
    assert.equal((await get(`/projects/files/${first.id}`, owner.token)).status, 404);
    assert.ok(!(await readdir(directory)).includes(first.id));
    const associations = await fixture.inspection.query('SELECT count(*) FROM portfolio.project_files WHERE project_id = $1', [draft.id]);
    assert.equal(associations.rows[0].count, '0');

    await stop();
    await start();
    const teamMember = await signIn('teammate@example.com');
    const lookupTeammate = (email, token) => fetch(base + '/projects/collaborators/lookup', {
      method: 'POST', headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    assert.equal((await lookupTeammate(other.user.email)).status, 401);
    assert.equal((await lookupTeammate('missing@example.com', owner.token)).status, 404);
    const lookup = await lookupTeammate('  OTHER@EXAMPLE.COM  ', owner.token);
    assert.equal(lookup.status, 200);
    const { account: teammate } = await lookup.json();
    assert.deepEqual(teammate, { showroomId: otherShowroom.id, name: other.user.name, email: other.user.email });
    const { showroom: teamShowroom } = await (await get('/projects/showroom', teamMember.token)).json();
    const collaborators = [{ showroomId: teammate.showroomId, role: 'owner' },
      { showroomId: teamShowroom.id, role: 'team_member' }];
    const collaborative = await create({
      ...details, collaborators, collaborationNotes: 'Thanks to an offline contributor.',
    }, owner.token);
    assert.equal(collaborative.status, 201, await collaborative.clone().text());
    const { project: sharedTeamProject } = await collaborative.json();
    assert.equal(sharedTeamProject.collaborators.length, 3);
    const teamProjectUrl = `/projects/${sharedTeamProject.id}`;
    const collaboratorProject = showroom => `/showrooms/${showroom.id}/projects/${sharedTeamProject.id}`;
    for (const showroom of [otherShowroom, teamShowroom]) {
      const response = await get(collaboratorProject(showroom));
      assert.equal(response.status, 200);
      const { project: publicProject } = await response.json();
      assert.equal(publicProject.collaborationNotes, 'Thanks to an offline contributor.');
      assert.ok(publicProject.collaborators.every(member => !('email' in member)));
      assert.equal((await get(`${collaboratorProject(showroom)}/files/${sharedTeamProject.media[0].id}`)).status, 200);
    }
    const editor = await get(teamProjectUrl, other.token);
    assert.equal(editor.status, 200);
    assert.equal((await get(teamProjectUrl, teamMember.token)).status, 404);
    const change = {
      ...details, title: 'Edited by an owner', mediaOrder: [{ fileId: sharedTeamProject.media[0].id }], buildAction: 'keep',
    };
    const saveTeamProject = (input, token, revision) => {
      const body = new FormData();
      body.append('project', JSON.stringify(input));
      return fetch(base + teamProjectUrl, { method: 'PUT', headers: { ...headers(token), 'If-Match': revision }, body });
    };
    const tagBeforeEdit = editor.headers.get('ETag');
    assert.equal((await saveTeamProject({ ...change, collaborators: [] }, other.token, tagBeforeEdit)).status, 403);
    const updated = await saveTeamProject(change, other.token, tagBeforeEdit);
    assert.equal(updated.status, 200, await updated.clone().text());
    const { project: teamUpdate } = await updated.json();
    assert.equal(teamUpdate.ownerId, owner.user.id);
    assert.equal(teamUpdate.collaborators.length, 3);
    assert.equal(teamUpdate.collaborationNotes, 'Thanks to an offline contributor.');
    const leave = token => fetch(base + teamProjectUrl + '/collaborators/me', { method: 'DELETE', headers: headers(token) });
    assert.equal((await leave(owner.token)).status, 403);
    assert.equal((await leave(other.token)).status, 204);
    assert.equal((await saveTeamProject(change, other.token, updated.headers.get('ETag'))).status, 404);
    assert.equal((await get(collaboratorProject(otherShowroom))).status, 404);
    assert.equal((await get(collaboratorProject(teamShowroom))).status, 200);
    assert.equal((await saveTeamProject(change, owner.token, updated.headers.get('ETag'))).status, 412);
    const afterLeave = await get(teamProjectUrl, owner.token);
    const revisedMembership = await saveTeamProject({
      ...change, collaborators: [{ showroomId: teamShowroom.id, role: 'simple_participation' }],
    }, owner.token, afterLeave.headers.get('ETag'));
    assert.equal(revisedMembership.status, 200, await revisedMembership.clone().text());
    const publicTeamProject = (await (await get(collaboratorProject(teamShowroom))).json()).project;
    assert.equal(publicTeamProject.collaborators.find(member => member.showroomId === teamShowroom.id).role, 'simple_participation');


    const logout = await fetch(base + '/logout', { method: 'POST', headers: { Cookie: owner.cookie } });
    assert.equal(logout.status, 204);
    assert.equal((await get('/projects', owner.token)).status, 401);
  } finally {
    if (server?.listening) await stop();
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
