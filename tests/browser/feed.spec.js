import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5qEAAAAASUVORK5CYII=', 'base64');
const makePost = (index, changes = {}) => ({
  id: `post-${index}`, createdAt: '2026-11-24T10:00:00.000Z', author: { id: index, name: index === 1 ? 'Zoë Rivera' : `Creator ${index}` },
  project: { id: `project-${index}`, title: `Project ${index}`, type: index % 2 ? 'open' : 'private', description: 'A project made by a curious person.', stack: 'React, JavaScript' },
  cover: { url: `/api/feed/posts/post-${index}/media`, name: 'project.png', type: 'image/png' }, likeCount: 0, commentCount: 0, viewerHasLiked: false, ...changes,
});
async function json(route, value, status = 200) { await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) }); }
async function mockSession(page, user = null) {
  await page.route('**/api/refresh', route => user ? json(route, { accessToken: 'feed-test-token' }) : json(route, { message: 'No session' }, 401));
  await page.route('**/api/me', route => json(route, { user }));
  await page.route('**/api/feed/posts/*/media', route => route.fulfill({ contentType: 'image/png', body: image }));
}

test.beforeEach(async ({ page }) => {
  page.__errors = [];
  page.on('pageerror', error => page.__errors.push(error.message));
});
test.afterEach(async ({ page }) => expect(page.__errors).toEqual([]));

test('public entry loads one page, search filters loaded creators/projects, and loading more preserves unique cards', async ({ page }, info) => {
  await mockSession(page);
  const requests = [];
  const ownerReads = [];
  page.on('request', request => { if (/\/api\/(projects|profile\/me)/.test(request.url())) ownerReads.push(request.url()); });
  await page.route('**/api/feed?*', async route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    requests.push(cursor);
    await json(route, cursor ? { posts: [makePost(10), makePost(11), makePost(12)], nextCursor: null } : { posts: Array.from({ length: 10 }, (_, index) => makePost(index + 1)), nextCursor: 'page-two' });
  });
  await page.goto('/');
  await expect(page).toHaveURL(/#\/feed$/);
  await expect(page.locator('.feed-post')).toHaveCount(10);
  expect(requests).toEqual([null]);
  expect(ownerReads).toEqual([]);
  await page.screenshot({ path: info.outputPath('feed-viewport.png') });
  await expect(page.locator('.feed-media img').first()).toHaveAttribute('loading', 'lazy');
  await page.getByLabel('Search projects or creators').fill('zoe');
  await expect(page.locator('.feed-post')).toHaveCount(1);
  await expect(page.locator('.feed-author')).toHaveText('Zoë Rivera');
  await page.getByLabel('Search projects or creators').fill('Project 12');
  await expect(page.getByRole('heading', { name: 'No matches in loaded projects.' })).toBeVisible();
  expect(requests).toEqual([null]);
  await page.getByRole('button', { name: 'Load more projects to search' }).click();
  await expect(page.locator('.feed-post')).toHaveCount(1);
  await expect(page.locator('.feed-post h2')).toHaveText('Project 12');
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.locator('.feed-post')).toHaveCount(12);
  await expect(page.getByText('You’re all caught up.')).toBeVisible();
  expect(requests).toEqual([null, 'page-two']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('feed-320.png'), fullPage: true });
});

test('scroll prefetch allows one next-page request and stops at the end', async ({ page }) => {
  await mockSession(page);
  const cursors = [];
  await page.route('**/api/feed?*', async route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    cursors.push(cursor);
    if (cursor) await new Promise(resolve => setTimeout(resolve, 150));
    await json(route, cursor ? { posts: [makePost(11)], nextCursor: null } : { posts: Array.from({ length: 10 }, (_, index) => makePost(index + 1)), nextCursor: 'next' });
  });
  await page.goto('/');
  await expect(page.locator('.feed-post')).toHaveCount(10);
  await page.locator('.feed-pagination').scrollIntoViewIfNeeded();
  await expect(page.locator('.feed-post')).toHaveCount(11);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(page.getByText('You’re all caught up.')).toBeVisible();
  expect(cursors).toEqual([null, 'next']);
});

test('comments are lazy, public and paginated; visitors get sign-in actions', async ({ page }) => {
  await mockSession(page);
  const calls = [];
  await page.route('**/api/feed?*', route => json(route, { posts: [makePost(1, { commentCount: 21 })], nextCursor: null }));
  await page.route('**/api/feed/posts/post-1/comments*', async route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor'); calls.push(cursor);
    const comment = i => ({ id: `c${i}`, postId: 'post-1', author: { id: 2, name: 'Comment author' }, text: i === 1 ? '<script>plain text</script>' : `Comment ${i}`, createdAt: '2026-11-24T10:00:00Z' });
    await json(route, cursor ? { comments: [comment(20), comment(21)], nextCursor: null } : { comments: Array.from({ length: 20 }, (_, i) => comment(i + 1)), nextCursor: 'comments-two' });
  });
  await page.goto('/');
  await expect(page.locator('.feed-post')).toHaveCount(1);
  expect(calls).toEqual([]);
  await expect(page.getByRole('link', { name: 'Sign in to like this project' })).toBeVisible();
  await page.getByRole('button', { name: '21 comments' }).click();
  await expect(page.locator('.feed-comment')).toHaveCount(20);
  await expect(page.locator('.feed-comments')).toContainText('<script>plain text</script>');
  expect(await page.locator('.feed-comments script').count()).toBe(0);
  await expect(page.locator('.feed-signin')).toContainText('Sign in');
  await page.getByRole('button', { name: 'Load more comments' }).click();
  await expect(page.locator('.feed-comment')).toHaveCount(21);
  expect(calls).toEqual([null, 'comments-two']);
  await page.getByRole('button', { name: '21 comments' }).click();
  await expect(page.locator('.feed-comments')).toBeHidden();
  await page.getByRole('button', { name: '21 comments' }).click();
  expect(calls).toHaveLength(2);
});

test('signed-in likes and comments use confirmed results and retain failed comment input', async ({ page }, info) => {
  await mockSession(page, { id: 42, name: 'Member', email: 'member@example.com' });
  let liked = false, writes = 0, failComment = false;
  const comments = [];
  await page.route('**/api/feed?*', route => json(route, { posts: [makePost(1, { viewerHasLiked: liked, likeCount: liked ? 1 : 0, commentCount: comments.length })], nextCursor: null }));
  await page.route('**/api/feed/posts/post-1/like', async route => {
    writes++; liked = route.request().method() === 'PUT';
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(route.request().headers().authorization).toBe('Bearer feed-test-token');
    await json(route, { likeCount: liked ? 1 : 0, viewerHasLiked: liked });
  });
  await page.route('**/api/feed/posts/post-1/comments', async route => {
    if (route.request().method() === 'GET') return json(route, { comments, nextCursor: null });
    if (failComment) return json(route, { message: 'Comment service unavailable.' }, 503);
    const comment = { id: 'saved-comment', postId: 'post-1', author: { id: 42, name: 'Member' }, text: route.request().postDataJSON().text, createdAt: '2026-11-24T11:00:00Z' };
    comments.push(comment);
    await json(route, { comment, commentCount: comments.length }, 201);
  });
  await page.goto('/');
  const like = page.getByRole('button', { name: 'Like project', exact: true });
  await expect(like).toBeVisible();
  await like.click();
  await expect(like).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Unlike project' })).toBeEnabled();
  expect(writes).toBe(1);
  await page.getByRole('button', { name: '0 comments' }).click();
  await page.getByLabel('Add a comment').fill('A thoughtful project.');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(page.locator('.feed-comment')).toContainText('A thoughtful project.');
  await expect(page.getByLabel('Add a comment')).toHaveValue('');
  await expect(page.getByRole('button', { name: '1 comment', exact: true })).toBeVisible();
  failComment = true;
  await page.getByLabel('Add a comment').fill('Keep this draft.');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(page.getByRole('alert')).toContainText('Comment service unavailable.');
  await expect(page.getByLabel('Add a comment')).toHaveValue('Keep this draft.');
  await page.screenshot({ path: info.outputPath('feed-comments.png') });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Unlike project' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Unlike project' }).click();
  await expect(page.getByRole('button', { name: 'Like project', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('a failed later page preserves cards and retry repeats the same cursor', async ({ page }) => {
  await mockSession(page);
  await page.addInitScript(() => { window.IntersectionObserver = undefined; });
  let failures = 0;
  const requests = [];
  await page.route('**/api/feed?*', async route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor'); requests.push(cursor);
    if (cursor && failures++ === 0) return json(route, { message: 'Try the next page again.' }, 503);
    return json(route, cursor ? { posts: [makePost(2)], nextCursor: null } : { posts: [makePost(1)], nextCursor: 'page-two' });
  });
  await page.goto('/');
  await expect(page.locator('.feed-post')).toHaveCount(1);
  await page.getByRole('button', { name: 'Load more projects', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Try the next page again.');
  await expect(page.locator('.feed-post')).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry loading projects' }).click();
  await expect(page.locator('.feed-post')).toHaveCount(2);
  expect(requests).toEqual([null, 'page-two', 'page-two']);
});

test('first-load errors are distinct from empty feed and navigation cancels late results', async ({ page }) => {
  await mockSession(page);
  let failed = false;
  await page.route('**/api/feed?*', route => {
    if (!failed) { failed = true; return json(route, { message: 'Feed temporarily unavailable.' }, 503); }
    return json(route, { posts: [], nextCursor: null });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Feed temporarily unavailable.');
  await expect(page.getByRole('heading', { name: 'No published projects yet.' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry loading projects' }).click();
  await expect(page.getByRole('heading', { name: 'No published projects yet.' })).toBeVisible();
  await page.unroute('**/api/feed?*');
  let finish;
  await page.route('**/api/feed?*', async route => {
    await new Promise(resolve => { finish = resolve; });
    await json(route, { posts: [makePost(1)], nextCursor: null }).catch(() => {});
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: /Discover what’s/ })).toBeVisible();
  await expect.poll(() => Boolean(finish)).toBe(true);
  await page.getByRole('navigation').getByRole('link', { name: 'Showroom', exact: true }).click();
  finish();
  await expect(page.getByRole('heading', { name: 'Your Projects' })).toBeVisible();
  await expect(page.locator('.feed-post')).toHaveCount(0);
});

test('real feed interactions persist and names open public project and creator pages', async ({ page, browser }) => {
  test.skip(!process.env.TEST_DATABASE_URL, 'Requires isolated PostgreSQL.');
  const email = `feed-ui-${randomUUID()}@example.com`;
  const account = { name: 'Feed Browser Member', email, password: 'sample-password' };
  expect((await page.request.post('/api/register', { data: account })).status()).toBe(201);
  const login = await page.request.post('/api/login', { data: account });
  const token = (await login.json()).accessToken;
  const title = `Browser feed project ${randomUUID()}`;
  const created = await page.request.post('/api/projects', { headers: { Authorization: `Bearer ${token}` }, multipart: {
    project: JSON.stringify({ title, type: 'open', description: 'A saved feed project.', stack: 'React', published: true }),
    media: { name: 'project.png', mimeType: 'image/png', buffer: image },
  } });
  expect(created.status()).toBe(201);
  const project = (await created.json()).project;
  await page.goto('/');
  const post = page.locator('.feed-post').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(post).toBeVisible();
  await post.getByRole('button', { name: 'Like project', exact: true }).click();
  await expect(post.getByRole('button', { name: 'Unlike project' })).toHaveAttribute('aria-pressed', 'true');
  await post.getByRole('button', { name: '0 comments' }).click();
  await post.getByLabel('Add a comment').fill('Persist this browser comment.');
  await post.getByRole('button', { name: 'Post comment' }).click();
  await expect(post.locator('.feed-comment')).toContainText('Persist this browser comment.');
  await page.reload();
  await expect(post.getByRole('button', { name: 'Unlike project' })).toHaveAttribute('aria-pressed', 'true');
  await post.getByRole('button', { name: '1 comment', exact: true }).click();
  await expect(post.locator('.feed-comment')).toContainText('Persist this browser comment.');
  const visitor = await browser.newPage();
  try {
    await visitor.goto('/#/feed');
    const visitorPost = visitor.locator('.feed-post').filter({ has: visitor.getByRole('heading', { name: title, exact: true }) });
    await visitorPost.getByRole('link', { name: title, exact: true }).click();
    await expect(visitor).toHaveURL(new RegExp(`#/showroom/[^/]+/${project.id}$`));
    await expect(visitor.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
    await expect(visitor.getByRole('link', { name: 'Edit project' })).toHaveCount(0);
    await visitor.goto('/#/feed');
    await visitorPost.locator('.feed-author a').click();
    await expect(visitor).toHaveURL(/#\/showroom\/[^/]+$/);
    await expect(visitor.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
    const saved = await page.request.put('/api/profile/me', {
      headers: { Authorization: `Bearer ${token}` }, multipart: { name: 'Public Feed Creator', role: 'Developer' },
    });
    expect(saved.status()).toBe(200);
    const { profile } = await saved.json();
    await visitor.goto('/#/feed');
    await visitorPost.locator('.feed-author a').click();
    await expect(visitor).toHaveURL(new RegExp(`#/about/${profile.publicId}\\?showroom=`));
    await expect(visitor.getByRole('heading', { name: 'Public Feed Creator', exact: true })).toBeVisible();
    await expect(visitor.getByRole('link', { name: 'Edit CV' })).toHaveCount(0);
  } finally { await visitor.close(); }
});


test('expired feed credentials refresh once and rejected mutations return to visitor controls', async ({ page }) => {
  const user = { id: 42, name: 'Session Member', email: 'session@example.com' };
  let refreshes = 0, rejectMutation = false;
  const tokens = [];
  await page.route('**/api/refresh', route => {
    refreshes++;
    return refreshes > 2 ? json(route, { message: 'Session ended' }, 401) : json(route, { accessToken: refreshes === 1 ? 'old-token' : 'new-token' });
  });
  await page.route('**/api/me', route => json(route, { user }));
  await page.route('**/api/feed/posts/*/media', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.route('**/api/feed?*', route => {
    const token = route.request().headers().authorization;
    tokens.push(token);
    if (token === 'Bearer old-token') return json(route, { message: 'Expired' }, 401);
    return json(route, { posts: [makePost(1, { viewerHasLiked: token === 'Bearer new-token', likeCount: 1 })], nextCursor: null });
  });
  await page.route('**/api/feed/posts/post-1/like', route => {
    expect(route.request().headers().authorization).toBe('Bearer new-token');
    return rejectMutation ? json(route, { message: 'Session revoked' }, 401) : json(route, { likeCount: 0, viewerHasLiked: false });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Unlike project' })).toBeVisible();
  expect(refreshes).toBe(2);
  expect(tokens).toContain('Bearer new-token');
  rejectMutation = true;
  await page.getByRole('button', { name: 'Unlike project' }).click();
  await expect(page.getByRole('link', { name: 'Sign in to like this project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  expect(refreshes).toBe(3);
});
