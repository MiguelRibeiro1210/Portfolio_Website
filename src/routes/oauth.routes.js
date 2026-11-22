import express from 'express';
import { startSession } from '../services/authService.js';
import { beginOAuth, getProviderIdentity, readOAuthTransaction } from '../services/oauthService.js';
import { hashRefreshToken } from '../services/tokenService.js';

const signInPage = '/#/signin';
const securityPage = '/#/studio?section=security';
const withStatus = (page, status) => `${page}${page.includes('?') ? '&' : '?'}oauth=${status}`;

export function createOAuthRouter({ providers, jwtSecret, secureCookies, getDatabase, readRefreshCookie, setRefreshCookie }) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    next();
  });

  function cookieOptions(provider) {
    return { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: `/api/oauth/${provider}/callback` };
  }

  function start(res, provider, config, linkSession) {
    const { url, transaction } = beginOAuth(provider, config, jwtSecret, linkSession);
    res.cookie(`folio_oauth_${provider}`, transaction, { ...cookieOptions(provider), maxAge: 600_000 });
    return res.redirect(303, url.href);
  }

  function configFor(provider) {
    return Object.hasOwn(providers, provider) ? providers[provider] : undefined;
  }

  router.get('/:provider/start', (req, res) => {
    const { provider } = req.params;
    const config = configFor(provider);
    if (!config) return res.redirect(303, withStatus(signInPage, 'unavailable'));
    return start(res, provider, config);
  });

  router.post('/:provider/link', async (req, res) => {
    const { provider } = req.params;
    const config = configFor(provider);
    if (!config) return res.redirect(303, withStatus(securityPage, 'unavailable'));
    const token = readRefreshCookie(req);
    if (!token || req.get('Origin') !== config.origin) {
      return res.redirect(303, withStatus(signInPage, 'signin-required'));
    }

    const db = await getDatabase();
    const session = await db.findRefreshSession(hashRefreshToken(token), Date.now());
    if (!session) return res.redirect(303, withStatus(signInPage, 'signin-required'));
    return start(res, provider, config, session);
  });

  router.get('/:provider/callback', async (req, res) => {
    const { provider } = req.params;
    const config = configFor(provider);
    if (!config) return res.redirect(303, withStatus(signInPage, 'unavailable'));

    const name = `folio_oauth_${provider}`;
    const cookie = (req.get('Cookie') ?? '').split(';').map(value => value.trim())
      .find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
    const transaction = readOAuthTransaction(cookie, provider, req.query.state, jwtSecret);
    if (!transaction) return res.redirect(303, withStatus(signInPage, 'failed'));

    res.clearCookie(name, cookieOptions(provider));
    const linkSession = transaction.linkSession;
    const page = linkSession ? securityPage : signInPage;
    if (req.query.error || typeof req.query.code !== 'string' || !req.query.code) {
      return res.redirect(303, withStatus(page, 'cancelled'));
    }

    try {
      const identity = await getProviderIdentity(provider, config, req.query.code, transaction.verifier);
      const db = await getDatabase();

      if (linkSession) {
        const result = await db.linkProvider(identity, linkSession.id, linkSession.userId);
        return res.redirect(303, withStatus(page, result ? 'linked' : 'signin-required'));
      }

      let user = await db.findProviderUser(provider, identity.providerUserId);
      if (!user) {
        const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';
        if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return res.redirect(303, withStatus(page, 'email-required'));
        }

        const displayName = typeof identity.name === 'string' ? identity.name.trim() : '';
        try {
          user = { id: await db.createProviderUser({ ...identity, name: (displayName || email).slice(0, 100), email }) };
        } catch (error) {
          if (error.code !== '23505' || !['users_email_key', 'provider_identities_pkey'].includes(error.constraint)) throw error;
          user = await db.findProviderUser(provider, identity.providerUserId);
          if (!user) return res.redirect(303, withStatus(page, 'link-required'));
        }
      }

      setRefreshCookie(res, await startSession(db, user.id));
      return res.redirect(303, '/');
    } catch (error) {
      return res.redirect(303, withStatus(page, error.code === '23505' &&
        ['provider_identities_pkey', 'provider_identities_user_provider_key'].includes(error.constraint)
        ? 'already-linked' : 'failed'));
    }
  });

  return router;
}
