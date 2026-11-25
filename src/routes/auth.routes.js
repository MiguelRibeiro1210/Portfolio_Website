import express from 'express';
import { createOAuthRouter } from './oauth.routes.js';
import { loginUser, logoutSession, refreshSession, registerUser } from '../services/authService.js';
import { signAccessToken } from '../services/tokenService.js';
import { requireAuth } from '../middleware/requireAuth.js';

const REFRESH_COOKIE = 'portfolio_refresh';

function readRefreshCookie(req) {
  const cookies = (req.get('Cookie') ?? '').split(';');
  for (const cookie of cookies) {
    const match = /^portfolio_refresh=([A-Za-z0-9_-]{43})$/.exec(cookie.trim());
    if (match) return match[1];
  }
}

export function createAuthRouter(getDatabase, { jwtSecret, secureCookies }, providers) {
  const router = express.Router();

  router.post('/register', express.json(), async (req, res) => {

    const result = await registerUser(req.body, getDatabase);

    if (result.error) return res.status(400).json({ message: result.error });

    if (result.duplicate) return res.status(409).json({ message: 'An account already exists for that email.' });

    res.status(201).json({ user: result.user });

  });

  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/api' };
  const authenticate = requireAuth(getDatabase, jwtSecret);

  function setRefreshCookie(res, { session, refreshToken }) {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...cookieOptions,
      maxAge: Math.max(0, session.expiresAt - Date.now()),
    });
  }

  function sendTokens(res, result) {
    const accessToken = signAccessToken(result.session, jwtSecret);
    setRefreshCookie(res, result);
    return res.json({ accessToken });
  }

  router.use('/oauth', createOAuthRouter({
    providers, jwtSecret, secureCookies, getDatabase, readRefreshCookie, setRefreshCookie,
  }));

  router.use(['/login', '/me', '/refresh', '/logout'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/login', express.json(), async (req, res) => {
    const result = await loginUser(req.body, getDatabase);
    if (result.error) return res.status(400).json({ message: result.error });
    if (result.invalidCredentials) return res.status(401).json({ message: 'Invalid email or password.' });
    return sendTokens(res, result);
  });

  router.get('/me', authenticate, async (req, res) => {
    const linkedProviders = await (await getDatabase()).listLinkedProviders(req.user.id);
    res.json({ user: { ...req.user, linkedProviders } });
  });

  router.post('/refresh', async (req, res) => {
    const token = readRefreshCookie(req);
    const result = token && await refreshSession(token, getDatabase);
    if (!result) return res.status(401).json({ message: 'Invalid or expired session.' });
    return sendTokens(res, result);
  });

  router.post('/logout', async (req, res) => {
    const token = readRefreshCookie(req);
    if (token) await logoutSession(token, getDatabase);
    res.clearCookie(REFRESH_COOKIE, cookieOptions).status(204).end();
  });

  router.use((error, req, res, next) => {

    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ message: 'Invalid JSON request body.' });
    }

    if (error.status >= 400 && error.status < 500) {
      return res.status(error.status).json({ message: 'Unable to read the request body.' });
    }

    const message = req.path === '/register' ? 'Unable to register the account.' : 'Unable to complete the authentication request.';
    res.status(500).json({ message });
  });

  return router;
}
