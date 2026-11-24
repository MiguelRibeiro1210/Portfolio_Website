import { isUUID } from './projectRules.js';

export function feedError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function validTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) return false;
  if (value.startsWith('0000-')) return false;
  const date = new Date(value);
  // Date truncates microseconds; check calendar/time validity without rounding the cursor itself.
  return !Number.isNaN(date.getTime()) && date.toISOString() === value.slice(0, 23) + 'Z';
}

export function decodeCursor(value, scope) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw feedError('Invalid feed cursor.');
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw new Error();
    const cursor = JSON.parse(bytes.toString('utf8'));
    if (!cursor || Object.keys(cursor).sort().join(',') !== 'id,scope,time' || cursor.scope !== scope ||
        !isUUID(cursor.id) || !validTimestamp(cursor.time)) throw new Error();
    return { id: cursor.id, time: cursor.time };
  } catch { throw feedError('Invalid feed cursor.'); }
}

export function encodeCursor(row, scope) {
  return Buffer.from(JSON.stringify({ scope, time: row.cursorTime, id: row.id })).toString('base64url');
}

export function feedPageQuery(query) {
  if (Object.keys(query).some(key => !['cursor', 'limit'].includes(key))) throw feedError('Unknown feed query parameter.');
  const value = query.limit;
  if (value !== undefined && (typeof value !== 'string' || !/^[1-9]\d?$/.test(value) || Number(value) > 50)) {
    throw feedError('Feed limit must be an integer between 1 and 50.');
  }
  return { limit: value === undefined ? 10 : Number(value), cursor: decodeCursor(query.cursor, 'feed') };
}

export function commentPageQuery(query, postId) {
  if (Object.keys(query).some(key => key !== 'cursor')) throw feedError('Unknown comment query parameter.');
  return { limit: 20, cursor: decodeCursor(query.cursor, `comments:${postId}`) };
}

export function validateComment(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object' ||
      Object.keys(body).join(',') !== 'text' || typeof body.text !== 'string') {
    throw feedError('Submit a JSON object containing only comment text.');
  }
  const text = body.text.trim();
  if (text.includes('\0') || [...text].length < 1 || [...text].length > 1000) {
    throw feedError('Comments must contain 1–1000 characters.');
  }
  return text;
}

export function requirePostId(value) {
  if (!isUUID(value)) throw feedError('Feed post not found.', 404);
  return value.toLowerCase();
}
