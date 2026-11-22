import { verifyAccessToken } from '../services/tokenService.js';

export function requireAuth(getDatabase, jwtSecret) {
  return async (req, res, next) => {
    const token = /^Bearer ([^\s]+)$/i.exec(req.get('Authorization') ?? '')?.[1];
    const identity = token && verifyAccessToken(token, jwtSecret);
    if (!identity) return res.status(401).json({ message: 'Authentication required.' });

    const db = await getDatabase();
    const user = await db.findActiveSessionUser(identity.sessionId, identity.userId, Date.now());
    if (!user) return res.status(401).json({ message: 'Authentication required.' });

    req.user = user;
    next();
  };
}
