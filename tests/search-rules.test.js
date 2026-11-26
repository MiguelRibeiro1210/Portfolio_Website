import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchQuery } from '../src/domain/searchRules.js';
import { getSearchSuggestions } from '../src/services/searchService.js';
import { createSearchOperations } from '../src/db/searchDatabase.js';

test('search validates query shape, Unicode length, literal characters and bounded limits', () => {
  assert.deepEqual(searchQuery({ q: '  José  ' }), { q: 'José', limit: 10, short: false });
  assert.deepEqual(searchQuery({ q: '🧑', limit: '1' }), { q: '🧑', limit: 1, short: true });
  assert.equal(searchQuery({ q: '🧑'.repeat(100), limit: '20' }).limit, 20);
  assert.equal(searchQuery({ q: "50%_!\\'" }).q, "50%_!\\'");
  for (const query of [{}, { q: null }, { q: ['a', 'b'] }, { q: {} }, { q: 'x'.repeat(101) }, { q: '\0' },
    { q: 'hi', email: 'private@example.com' }, ...['0', '21', '01', '-1', '1.5', '', ' 2', ['1', '2'], {}].map(limit => ({ q: 'hi', limit }))]) {
    assert.throws(() => searchQuery(query), error => error.status === 400);
  }
});

test('short searches skip the database; service preserves ordering and exposes only public DTOs', async () => {
  for (const q of ['', ' ', 'é', '🧑']) {
    assert.deepEqual(await getSearchSuggestions(() => { throw new Error('Must not access DB'); }, { q }),
      { query: q.trim(), suggestions: [], hasMore: false });
  }
  const project = { type: 'project', id: 'p', label: 'Focus', creatorName: 'Alex', showroomId: 's' };
  const user = { type: 'user', id: 'u', label: 'Focus Studio', accountName: 'Alex', email: 'alex@example.com', showroomId: 'u', profileId: null };
  const db = async () => ({ searchSuggestions: async () => [project, user].map(row => ({ email: 'project-email-must-be-omitted', ...row, rank: 0, passwordHash: 'secret' })) });
  assert.deepEqual(await getSearchSuggestions(db, { q: 'focus' }), { query: 'focus', suggestions: [project, user], hasMore: false });
  assert.deepEqual(await getSearchSuggestions(db, { q: 'focus', limit: '1' }), { query: 'focus', suggestions: [project], hasMore: true });
  await assert.rejects(getSearchSuggestions(async () => { throw new Error('private connection string'); }, { q: 'focus' }),
    error => error.status === 503 && !error.message.includes('private'));
});

test('search transactions roll back on timeout and destroy a connection if rollback fails', async () => {
  for (const rollbackFails of [false, true]) {
    let released;
    const calls = [];
    const timeout = Object.assign(new Error('private query details'), { code: '57014' });
    const client = {
      async query(sql, parameters) {
        calls.push({ sql, parameters });
        if (parameters) throw timeout;
        if (sql === 'ROLLBACK' && rollbackFails) throw new Error('Connection lost');
      },
      release(destroy) { released = destroy; },
    };
    await assert.rejects(createSearchOperations({ connect: async () => client }).searchSuggestions({ q: 'focus', limit: 10 }), timeout);
    assert.equal(calls[0].sql, 'BEGIN READ ONLY');
    assert.equal(calls[1].sql, "SET LOCAL statement_timeout = '2s'");
    assert.deepEqual(calls[2].parameters, ['focus', 11]);
    assert.equal(calls[3].sql, 'ROLLBACK');
    assert.equal(released, rollbackFails);
  }
});
