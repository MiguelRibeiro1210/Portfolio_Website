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
