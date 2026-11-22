import { Pool } from 'pg';
import { describeDatabaseError } from './errors.js';

export async function openDatabase(config) {
  const pool = new Pool(config);
  // Idle errors must not terminate the process or expose credentials.
  pool.on('error', () => console.error('An idle PostgreSQL connection failed.'));
  try {
    await pool.query('SELECT id, name, email, password_hash, created_at FROM portfolio.users LIMIT 0');
  } catch (error) {
    await pool.end();
    throw new Error(`Unable to connect to PostgreSQL or find portfolio.users. ${describeDatabaseError(error)}`);
  }

  return {
    close: () => pool.end(),
    async insertUser(name, email, passwordHash) {
      const { rows } = await pool.query(
        'INSERT INTO portfolio.users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [name, email, passwordHash],
      );
      return rows[0].id;
    },
  };
}
