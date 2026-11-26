import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendUnique, createFeedApi, suggestionUrl } from '../frontend/feed/feedApi.js';

test('search suggestions use public destinations and feed pages retain unique posts', () => {
  assert.equal(suggestionUrl({type:'project', id:'p', showroomId:'s'}), '#/showroom/s/p');
  assert.equal(suggestionUrl({type:'user', showroomId:'s', profileId:'cv'}), '#/about/cv?showroom=s');
  assert.equal(suggestionUrl({type:'user', showroomId:'a/b', profileId:null}), '#/showroom/a%2Fb');
  assert.deepEqual(appendUnique([{ id: 'one' }], [{ id: 'one' }, { id: 'two' }, { id: 'two' }]), [{ id: 'one' }, { id: 'two' }]);
});

test('search adapter queries the database endpoint independently of feed pagination', async () => {
  const calls = [];
  const api = createFeedApi(async (...args) => { calls.push(args); return {query:'José & Co',suggestions:[],hasMore:false}; });
  const controller = new AbortController();
  await api.suggestions('José & Co', controller.signal);
  assert.equal(calls[0][0], '/api/search/suggestions?q=Jos%C3%A9%20%26%20Co&limit=10');
  assert.equal(calls[0][1].signal, controller.signal);
  assert.equal(calls[0][2], true);
  await assert.rejects(createFeedApi(async()=>({query:'old',suggestions:[],hasMore:false})).suggestions('new'), /invalid response/);
  const user = {type:'user',id:'u',label:'Same name',accountName:'Same name',email:'account@example.com',showroomId:'u',profileId:null};
  const result = {query:'Same name',suggestions:[user],hasMore:false};
  assert.deepEqual(await createFeedApi(async()=>result).suggestions('Same name'),result);
  await assert.rejects(createFeedApi(async()=>({...result,suggestions:[{...user,email:undefined}]})).suggestions('Same name'), /invalid response/);
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
