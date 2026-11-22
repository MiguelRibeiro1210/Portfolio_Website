import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const jwtScope = { issuer: 'portfolio-api', audience: 'portfolio-api' };

export function signAccessToken(session, secret) {
  return jwt.sign({ sid: session.id }, secret, {
    ...jwtScope,
    algorithm: 'HS256',
    subject: String(session.userId),
    expiresIn: '15m',
  });
}

export function verifyAccessToken(token, secret) {
  try {
    const claims = jwt.verify(token, secret, { ...jwtScope, algorithms: ['HS256'] });
    if (typeof claims.sid === 'string' && typeof claims.exp === 'number' &&
      typeof claims.sub === 'string' && /^[1-9]\d*$/.test(claims.sub)) {

      const userId = Number(claims.sub);

      if (Number.isSafeInteger(userId)) return { sessionId: claims.sid, userId };

    }
  } catch (error) {
    if (!(error instanceof jwt.JsonWebTokenError)) throw error;
  }
  return null;
}

export function createRefreshToken() {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
