import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { createRefreshToken, hashRefreshToken, SESSION_LIFETIME_MS } from './tokenService.js';

const BCRYPT_COST = 12;

// Use the same bcrypt cost for unknown accounts and incorrect passwords.
const DUMMY_HASH = '$2b$12$CPL1lVZUTKoF/NRPO1NXNOQVzkpioqx8tNJC6MO0wFqA0C7vmJ0A.';
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const isValidEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export async function registerUser(input, getDatabase) {

  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const email = normalizeEmail(input?.email);
  const password = input?.password;

  if (!name || name.length > 100) {
    return { error: 'Name must be between 1 and 100 characters.' };
  }

  if (!isValidEmail(email)) {
    return { error: 'Enter a valid email address.' };
  }

  if (typeof password !== 'string' || [...password].length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return { error: 'Password must contain at least 8 characters and at most 72 UTF-8 bytes.' };
  }

  const db = await getDatabase();
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  try {

    const id = await db.insertUser(name, email, passwordHash);
    return { user: { id, name, email } };

  } catch (error) {

    if (error.code === '23505' && error.constraint === 'users_email_key') {

      return { duplicate: true };

    }
    throw error;
  }
}

export async function loginUser(input, getDatabase) {

  const email = normalizeEmail(input?.email);
  const password = input?.password;
  if (!isValidEmail(email) || typeof password !== 'string' ||
    !password || Buffer.byteLength(password, 'utf8') > 72) {
    return { error: 'Enter an email and password.' };
  }


  const db = await getDatabase();
  const user = await db.findUserByEmail(email);
  const matches = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
  if (!user?.password_hash || !matches) return { invalidCredentials: true };

  return startSession(db, user.id);
}

export async function startSession(db, userId) {
  const refreshToken = createRefreshToken();
  const createdAt = Date.now();
  const session = {
    id: randomUUID(),
    userId,
    refreshTokenHash: hashRefreshToken(refreshToken),
    createdAt,
    expiresAt: createdAt + SESSION_LIFETIME_MS,
  };
  await db.insertSession(session);
  return { session, refreshToken };
}

export async function refreshSession(refreshToken, getDatabase) {
  const db = await getDatabase();
  const replacement = createRefreshToken();
  const session = await db.rotateRefreshToken(
    hashRefreshToken(refreshToken), hashRefreshToken(replacement), Date.now(),
  );
  return session ? { session, refreshToken: replacement } : null;
}

export async function logoutSession(refreshToken, getDatabase) {
  const db = await getDatabase();
  await db.revokeSession(hashRefreshToken(refreshToken), Date.now());
}
