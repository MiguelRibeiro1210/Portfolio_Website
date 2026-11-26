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
    async suggestions(q, signal) {
      const result = await request(`/api/search/suggestions?q=${encodeURIComponent(q)}&limit=10`, { signal }, true);
      if (result?.query !== q || !Array.isArray(result.suggestions) || typeof result.hasMore !== 'boolean' ||
        result.suggestions.some(item => !item || !['user', 'project'].includes(item.type) ||
          !['id', 'label', 'showroomId'].every(key => typeof item[key] === 'string') ||
          (item.type === 'user' ? typeof item.accountName !== 'string' || typeof item.email !== 'string' || !(item.profileId === null || typeof item.profileId === 'string') : typeof item.creatorName !== 'string'))) {
        throw new Error('Search returned an invalid response. Please try again.');
      }
      return result;
    },
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

export function suggestionUrl(item) {
  const showroom = encodeURIComponent(item.showroomId);
  if (item.type === 'project') return `#/showroom/${showroom}/${encodeURIComponent(item.id)}`;
  return item.profileId ? `#/about/${encodeURIComponent(item.profileId)}?showroom=${showroom}` : `#/showroom/${showroom}`;
}

export function appendUnique(current, incoming) {
  const known = new Set(current.map(item => item.id));
  return [...current, ...incoming.filter(item => {
    if (known.has(item.id)) return false;
    known.add(item.id);
    return true;
  })];
}
