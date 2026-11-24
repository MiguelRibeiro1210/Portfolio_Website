import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendUnique, createFeedApi, matchesSearch } from '../frontend/feed/feedApi.js';

test('feed search matches loaded project and creator text without changing pagination', () => {
  const post = { id: 'p', author: { name: 'Zoë Rivera' }, project: { title: 'Focus Timer', description: 'A desktop tool', stack: 'React, JavaScript' } };
  assert.equal(matchesSearch(post, 'zoe'), true);
  assert.equal(matchesSearch(post, 'RIVERA focus'), true);
  assert.equal(matchesSearch(post, 'timer react'), true);
  assert.equal(matchesSearch(post, 'another creator'), false);
  assert.equal(matchesSearch(post, ' '), true);
  assert.deepEqual(appendUnique([{ id: 'one' }], [{ id: 'one' }, { id: 'two' }, { id: 'two' }]), [{ id: 'one' }, { id: 'two' }]);
});

test('feed adapter uses only documented endpoints and forwards cancellation and auth mode', async () => {
  const calls = [];
  const api = createFeedApi(async (...args) => {
    calls.push(args);
    return { posts: [], comments: [], nextCursor: null };
  });
  const controller = new AbortController();
  await api.posts('cursor with spaces', controller.signal);
  assert.equal(calls[0][0], '/api/feed?limit=10&cursor=cursor%20with%20spaces');
  assert.equal(calls[0][1].signal, controller.signal);
  assert.equal(calls[0][2], true);
  await api.comments('post', null, controller.signal);
  assert.equal(calls[1][0], '/api/feed/posts/post/comments');
  await api.like('post', true, controller.signal);
  assert.equal(calls[2][1].method, 'PUT');
  assert.equal(calls[2][2], undefined);
  await api.like('post', false, controller.signal);
  assert.equal(calls[3][1].method, 'DELETE');
  await api.comment('post', '<script>text</script>', controller.signal);
  assert.deepEqual(JSON.parse(calls[4][1].body), { text: '<script>text</script>' });
  const invalid = createFeedApi(async () => ({ posts: [], nextCursor: 1 }));
  await assert.rejects(invalid.posts(), /invalid response/);
});
