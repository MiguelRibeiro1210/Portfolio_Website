import { randomBytes } from 'node:crypto';

export function loadAuthConfig(env = process.env) {
  const secureCookies = env.NODE_ENV === 'production';
  const secret = env.JWT_SECRET;
  if ((secret !== undefined || secureCookies) && Buffer.byteLength(secret ?? '') < 32) {
    throw new Error('JWT_SECRET must be at least 32 bytes.');
  }

  return { jwtSecret: secret ?? randomBytes(32), secureCookies };
}

export function loadOAuthConfig(env = process.env) {
  const providers = {};
  for (const name of ['google', 'github']) {
    const prefix = name.toUpperCase();
    const clientId = env[`${prefix}_CLIENT_ID`];
    const clientSecret = env[`${prefix}_CLIENT_SECRET`];
    if (!clientId && !clientSecret) continue;
    if (!clientId || !clientSecret || !env.OAUTH_ORIGIN) {
      throw new Error(`Set ${prefix}_CLIENT_ID, ${prefix}_CLIENT_SECRET, and OAUTH_ORIGIN together.`);
    }

    const origin = new URL(env.OAUTH_ORIGIN);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if ((origin.protocol !== 'https:' && !(origin.protocol === 'http:' && local && env.NODE_ENV !== 'production')) ||
      origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
      throw new Error('OAUTH_ORIGIN must be an HTTPS origin or a local HTTP origin for development.');
    }
    providers[name] = { clientId, clientSecret, origin: origin.origin };
  }
  return providers;
}
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';

export function loadEnvironment() {
  dotenv.config({ quiet: true });
}

export function getDatabaseConfig(env = process.env) {
  if (!env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL is required. Copy the PostgreSQL Session pooler connection string from Supabase Connect into .env.');
  }
  let url;
  try {
    url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error();
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection string, including a host and database name.');
  }

  // pg URL SSL options override the explicit ssl object. Reject conflicts
  // instead of accidentally disabling certificate verification.
  for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) {
    if (url.searchParams.has(key)) {
      throw new Error('Remove SSL query parameters from DATABASE_URL; use DATABASE_SSL and DATABASE_CA_CERT_PATH instead.');
    }
  }
  if (env.DATABASE_SSL && !['true', 'false'].includes(env.DATABASE_SSL)) {
    throw new Error('DATABASE_SSL must be true or false.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (env.DATABASE_SSL === 'false' && !local) {
    throw new Error('DATABASE_SSL=false is allowed only for local PostgreSQL. Supabase requires verified TLS.');
  }
  let ca;
  if (env.DATABASE_CA_CERT_PATH && env.DATABASE_SSL !== 'false') {
    try {
      ca = readFileSync(env.DATABASE_CA_CERT_PATH, 'utf8');
    } catch {
      throw new Error('Unable to read DATABASE_CA_CERT_PATH. Use the downloaded PostgreSQL root certificate path.');
    }
  }
  return {
    connectionString: url.toString(),
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    ssl: env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
  };
}
