import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeCursor, encodeCursor, feedPageQuery, commentPageQuery, validateComment } from '../src/domain/feedRules.js';

const id = '932fc85e-9c77-4ec3-9366-3e17ed9f1d84';
const time = '2026-11-23T08:12:13.123456Z';

test('feed cursors preserve database precision and reject malformed or cross-scope boundaries', () => {
  const cursor = encodeCursor({ id, cursorTime: time }, 'feed');
  assert.deepEqual(decodeCursor(cursor, 'feed'), { id, time });
  assert.equal(decodeCursor(undefined, 'feed'), null);
  for (const value of ['', '*', 'a'.repeat(513), [cursor], cursor + '=', Buffer.from('{}').toString('base64url')]) {
    assert.throws(() => decodeCursor(value, 'feed'), /Invalid feed cursor/);
  }
  assert.throws(() => decodeCursor(cursor, `comments:${id}`), /Invalid feed cursor/);
  for (const date of ['0000-01-01T00:00:00.000000Z', '2026-02-30T08:12:13.123456Z', '2026-11-23T25:12:13.123456Z', '2026-11-23T08:12:13.123Z']) {
    assert.throws(() => decodeCursor(encodeCursor({ id, cursorTime: date }, 'feed'), 'feed'), /Invalid feed cursor/);
  }
  const comment = encodeCursor({ id, cursorTime: time }, `comments:${id}`);
  assert.deepEqual(commentPageQuery({ cursor: comment }, id), { limit: 20, cursor: { id, time } });
});

test('feed query limits and comment bodies are validated without accepting impersonation', () => {
  assert.deepEqual(feedPageQuery({}), { limit: 10, cursor: null });
  assert.equal(feedPageQuery({ limit: '50' }).limit, 50);
  for (const limit of ['0', '-1', '51', '1.2', '1e1', '', ['10', '20']]) assert.throws(() => feedPageQuery({ limit }), /limit/);
  assert.throws(() => feedPageQuery({ ownerId: '1' }), /Unknown/);
  assert.throws(() => commentPageQuery({ limit: '100' }, id), /Unknown/);
  assert.equal(validateComment({ text: '  useful\nproject  ' }), 'useful\nproject');
  assert.equal(validateComment({ text: '😀'.repeat(1000) }).length, 2000);
  for (const body of [null, [], {}, { text: 1 }, { text: '' }, { text: ' ' }, { text: 'x'.repeat(1001) }, { text: '\0' }, { text: 'ok', userId: 2 }]) {
    assert.throws(() => validateComment(body));
  }
});
