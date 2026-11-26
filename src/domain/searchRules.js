export function searchError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function searchQuery(query) {
  if (!query || Object.keys(query).some(key => !['q', 'limit'].includes(key))) {
    throw searchError('Unknown search query parameter.');
  }
  if (typeof query.q !== 'string') throw searchError('Supply one search query using q.');
  const q = query.q.trim();
  if (q.includes('\0') || [...q].length > 100) throw searchError('Search queries must not exceed 100 characters or contain null characters.');
  if (query.limit !== undefined && (typeof query.limit !== 'string' || !/^[1-9]\d?$/.test(query.limit) || Number(query.limit) > 20)) {
    throw searchError('Search limit must be an integer between 1 and 20.');
  }
  return { q, limit: query.limit === undefined ? 10 : Number(query.limit), short: [...q].length < 2 };
}
