import { searchError, searchQuery } from '../domain/searchRules.js';

export async function getSearchSuggestions(getDatabase, query) {
  const options = searchQuery(query);
  if (options.short) return { query: options.q, suggestions: [], hasMore: false };
  let rows;
  try {
    rows = await (await getDatabase()).searchSuggestions(options);
  } catch {
    throw searchError('Search is temporarily unavailable. Please try again.', 503);
  }
  const suggestions = rows.slice(0, options.limit).map(row => {
    const { type, id, label, showroomId } = row;
    if (type === 'user') return { type, id, label, accountName: row.accountName, email: row.email, showroomId, profileId: row.profileId };
    if (type === 'project') return { type, id, label, creatorName: row.creatorName, showroomId };
    throw new Error('Unexpected search result type.');
  });
  return { query: options.q, suggestions, hasMore: rows.length > options.limit };
}
