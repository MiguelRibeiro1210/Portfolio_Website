import bcrypt from 'bcrypt';

const BCRYPT_COST = 12;

export async function registerUser(input, getDatabase) {

  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = input?.password;

  if (!name || name.length > 100) {
    return { error: 'Name must be between 1 and 100 characters.' };
  }

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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

    if (error.code === 'SQLITE_CONSTRAINT' && error.message.endsWith('UNIQUE constraint failed: users.email')) {

      return { duplicate: true };

    }
    throw error;
  }
}
