import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

const providers = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    exchange: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
  },
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    exchange: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
  },
};

function callbackUrl(provider, config) {
  return `${config.origin}/api/oauth/${provider}/callback`;
}

const transactionClaims = { issuer: 'portfolio-oauth', audience: 'portfolio-oauth' };

export function beginOAuth(provider, config, secret, linkSession) {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const transaction = jwt.sign({ state, verifier, provider, linkSession }, secret, {
    ...transactionClaims, algorithm: 'HS256', expiresIn: '10m',
  });
  const url = new URL(providers[provider].authorize);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callbackUrl(provider, config),
    response_type: 'code',
    scope: providers[provider].scope,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  return { url, transaction };
}

export function readOAuthTransaction(token, provider, state, secret) {
  if (!token || typeof state !== 'string') return null;
  try {
    const payload = jwt.verify(token, secret, { ...transactionClaims, algorithms: ['HS256'] });
    return payload.provider === provider && payload.state === state ? payload : null;
  } catch {
    return null;
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Provider request failed.');
  return response.json();
}

export async function getProviderIdentity(provider, config, code, verifier) {
  const result = await requestJson(providers[provider].exchange, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: config.clientId, client_secret: config.clientSecret,
      code, code_verifier: verifier, redirect_uri: callbackUrl(provider, config),
      grant_type: 'authorization_code',
    }),
  });
  if (typeof result.access_token !== 'string' || !result.access_token) throw new Error('Provider token missing.');
  const headers = { Authorization: `Bearer ${result.access_token}`, Accept: 'application/json' };

  if (provider === 'google') {
    const user = await requestJson('https://openidconnect.googleapis.com/v1/userinfo', { headers });
    if (typeof user.sub !== 'string' || !user.sub) throw new Error('Provider identity missing.');
    return { provider, providerUserId: user.sub, name: user.name, email: user.email_verified === true ? user.email : null };
  }

  const user = await requestJson('https://api.github.com/user', {
    headers: { ...headers, 'User-Agent': 'folio-portfolio' },
  });
  if (!Number.isSafeInteger(user.id) || user.id < 1) throw new Error('Provider identity missing.');
  const emails = await requestJson('https://api.github.com/user/emails', {
    headers: { ...headers, 'User-Agent': 'folio-portfolio' },
  });
  return {
    provider, providerUserId: String(user.id), name: user.name || user.login,
    email: emails.find(email => email.primary && email.verified)?.email,
  };
}
