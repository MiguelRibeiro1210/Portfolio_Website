import { commentPageQuery, encodeCursor, feedError, feedPageQuery, requirePostId, validateComment } from '../domain/feedRules.js';

function pageResult(rows, { limit }, scope, field) {
  const hasNext = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    [field]: page.map(({ cursorTime, ...item }) => item),
    nextCursor: hasNext ? encodeCursor(page.at(-1), scope) : null,
  };
}

export async function getFeed(database, query, viewerId) {
  const options = feedPageQuery(query);
  const rows = await database.listFeedPosts(options, viewerId);
  const result = pageResult(rows, options, 'feed', 'posts');
  result.posts = result.posts.map(post => ({
    ...post,
    cover: post.cover ? { url: `/api/feed/posts/${post.id}/media`, ...post.cover } : null,
  }));
  return result;
}

export async function getFeedComments(database, id, query) {
  const postId = requirePostId(id);
  const options = commentPageQuery(query, postId);
  const rows = await database.listFeedComments(postId, options);
  if (!rows) throw feedError('Feed post not found.', 404);
  return pageResult(rows, options, `comments:${postId}`, 'comments');
}

export async function setLike(database, id, userId, liked) {
  return database.setFeedLike(requirePostId(id), userId, liked);
}

export async function addComment(database, id, userId, body) {
  return database.createFeedComment(requirePostId(id), userId, validateComment(body));
}
