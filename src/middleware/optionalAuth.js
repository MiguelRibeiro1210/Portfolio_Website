import { requireAuth } from './requireAuth.js';

export function optionalAuth(getDatabase, jwtSecret) {
  const authenticate = requireAuth(getDatabase, jwtSecret);
  return (req, res, next) => {
    if (req.get('Authorization') === undefined) return next();
    return authenticate(req, res, next);
  };
}
