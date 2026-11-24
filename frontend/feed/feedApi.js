export function createFeedApi(request) {
  const postPath = id => `/api/feed/posts/${encodeURIComponent(id)}`;
  const query = cursor => cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  function page(result, key) {
    if (!Array.isArray(result?.[key]) || !(result.nextCursor === null || typeof result.nextCursor === 'string')) {
      throw new Error('The feed returned an invalid response. Please try again.');
    }
    return result;
  }
  return {
    async posts(cursor, signal) {
      return page(await request(`/api/feed?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal }, true), 'posts');
    },
    async comments(id, cursor, signal) {
      return page(await request(`${postPath(id)}/comments${query(cursor)}`, { signal }, true), 'comments');
    },
    like(id, liked, signal) {
      return request(`${postPath(id)}/like`, { method: liked ? 'PUT' : 'DELETE', signal });
    },
    comment(id, text, signal) {
      return request(`${postPath(id)}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal });
    },
  };
}

export function matchesSearch(post, query) {
  const normalize = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const content = normalize([post.author?.name, post.project?.title, post.project?.description, post.project?.stack].join(' '));
  return terms.every(term => content.includes(term));
}

export function appendUnique(current, incoming) {
  const known = new Set(current.map(item => item.id));
  return [...current, ...incoming.filter(item => {
    if (known.has(item.id)) return false;
    known.add(item.id);
    return true;
  })];
}
