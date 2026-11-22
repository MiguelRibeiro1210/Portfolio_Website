import { readFile } from 'node:fs/promises';
import sqlite3 from 'sqlite3';

export async function openDatabase(path) {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  const db = await new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(path, error => {
      if (error) reject(error);
      else resolve(connection);
    });
  });

  const close = () => new Promise((resolve, reject) => {
    db.close(error => error ? reject(error) : resolve());
  });

  try {
    await new Promise((resolve, reject) => {
      db.exec(schema, error => error ? reject(error) : resolve());
    });
  } catch (error) {
    await close();
    throw error;
  }

  return {
    close,
    insertUser(name, email, passwordHash) {
      return new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
          [name, email, passwordHash],
          function (error) {
            if (error) reject(error);
            else resolve(this.lastID);
          },
        );
      });
    },
  };
}
