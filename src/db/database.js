import { Pool } from 'pg';
import { describeDatabaseError } from './errors.js';

export async function openDatabase(config) {
  const pool = new Pool(config);
  pool.on('error', () => console.error('An idle PostgreSQL connection failed.'));
  try {
    await pool.query('SELECT id, name, email, password_hash, created_at FROM portfolio.users LIMIT 0');
    await pool.query('SELECT id, user_id, refresh_token_hash, created_at, last_refreshed_at, expires_at, revoked_at FROM portfolio.sign_in_sessions LIMIT 0');
    await pool.query('SELECT provider, provider_user_id, user_id, linked_at FROM portfolio.provider_identities LIMIT 0');
  } catch (error) {
    await pool.end();
    throw new Error(`Unable to connect to PostgreSQL or find the authentication tables. ${describeDatabaseError(error)}`);
  }

  async function first(sql, parameters) {
    const { rows } = await pool.query(sql, parameters);
    return rows[0];
  }

  return {
    close: () => pool.end(),
    async insertUser(name, email, passwordHash) {
      const row = await first(
        'INSERT INTO portfolio.users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [name, email, passwordHash],
      );
      return row.id;
    },
    findUserByEmail(email) {
      return first('SELECT id, password_hash FROM portfolio.users WHERE email = $1', [email]);
    },
    findProviderUser(provider, providerUserId) {
      return first('SELECT user_id AS id FROM portfolio.provider_identities WHERE provider = $1 AND provider_user_id = $2',
        [provider, providerUserId]);
    },
    async createProviderUser({ provider, providerUserId, name, email }) {
      // A single statement inserts the account and its identity atomically.
      const row = await first(
        `WITH account AS (
           INSERT INTO portfolio.users (name, email, password_hash) VALUES ($1, $2, '') RETURNING id
         )
         INSERT INTO portfolio.provider_identities (provider, provider_user_id, user_id, linked_at)
         SELECT $3, $4, id, $5 FROM account
         RETURNING user_id AS id`,
        [name, email, provider, providerUserId, Date.now()],
      );
      return row.id;
    },
    async linkProvider({ provider, providerUserId }, sessionId, userId) {
      const now = Date.now();
      const { rowCount } = await pool.query(
        `INSERT INTO portfolio.provider_identities (provider, provider_user_id, user_id, linked_at)
         SELECT $1, $2, user_id, $3 FROM portfolio.sign_in_sessions
         WHERE id = $4 AND user_id = $5 AND revoked_at IS NULL AND expires_at > $3
         FOR UPDATE`,
        [provider, providerUserId, now, sessionId, userId],
      );
      return rowCount === 1;
    },
    findRefreshSession(hash, now) {
      return first(
        `SELECT id, user_id AS "userId" FROM portfolio.sign_in_sessions
         WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`, [hash, now],
      );
    },
    async insertSession({ id, userId, refreshTokenHash, createdAt, expiresAt }) {
      await pool.query(
        `INSERT INTO portfolio.sign_in_sessions (id, user_id, refresh_token_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, userId, refreshTokenHash, createdAt, expiresAt],
      );
    },
    findActiveSessionUser(sessionId, userId, now) {
      return first(
        `SELECT u.id, u.name, u.email
         FROM portfolio.sign_in_sessions AS s JOIN portfolio.users AS u ON u.id = s.user_id
         WHERE s.id = $1 AND s.user_id = $2 AND s.expires_at > $3 AND s.revoked_at IS NULL`,
        [sessionId, userId, now],
      );
    },
    async rotateRefreshToken(currentHash, newHash, now) {
      const session = await first(
        `UPDATE portfolio.sign_in_sessions SET refresh_token_hash = $1, last_refreshed_at = $2
         WHERE refresh_token_hash = $3 AND expires_at > $2 AND revoked_at IS NULL
         RETURNING id, user_id AS "userId", expires_at AS "expiresAt"`,
        [newHash, now, currentHash],
      );
      return session && { ...session, expiresAt: Number(session.expiresAt) };
    },
    async revokeSession(refreshTokenHash, now) {
      await pool.query(
        'UPDATE portfolio.sign_in_sessions SET revoked_at = $1 WHERE refresh_token_hash = $2 AND revoked_at IS NULL',
        [now, refreshTokenHash],
      );
    },
  };
}
