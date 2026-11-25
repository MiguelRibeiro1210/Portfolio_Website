import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { projectError } from '../domain/projectRules.js';
import { describeDatabaseError } from './errors.js';
import { createFeedOperations, ensureFeedPost } from './feedDatabase.js';

const projectSelect = (withRevision = false) => `SELECT ${withRevision ? "p.revision, " : ""}p.id, p.owner_id AS "ownerId", p.title, p.type,
  p.description, p.stack, p.published, p.created_at AS "createdAt",
  (SELECT json_build_object('story', n.story, 'compatibility', n.compatibility,
    'source', n.source, 'releaseNotes', n.release_notes)
   FROM portfolio.project_notes n WHERE n.project_id = p.id) AS notes,
  COALESCE((SELECT json_agg(json_build_object('id', f.id, 'name', f.name,
    'type', f.type, 'size', f.size) ORDER BY f.position)
    FROM portfolio.project_files f WHERE f.project_id = p.id AND f.kind = 'media'), '[]') AS media,
  (SELECT json_build_object('id', f.id, 'name', f.name, 'type', f.type,
    'size', f.size, 'permission', f.permission)
   FROM portfolio.project_files f WHERE f.project_id = p.id AND f.kind = 'build') AS build
  FROM portfolio.projects p`;

const profileSelect = `SELECT p.public_id AS "publicId", p.fields,
  CASE WHEN a.owner_id IS NOT NULL THEN json_build_object(
    'key', a.object_key, 'name', a.filename, 'size', a.size
  ) END AS attachment
  FROM portfolio.profiles p LEFT JOIN portfolio.cv_attachments a USING (owner_id)`;

async function writeProjectAssociations(client, project) {
  if (project.notes) {
    const { story, compatibility, source, releaseNotes } = project.notes;
    await client.query(`INSERT INTO portfolio.project_notes
      (project_id, story, compatibility, source, release_notes) VALUES ($1,$2,$3,$4,$5)`,
    [project.id, story, compatibility, source, releaseNotes]);
  }
  const files = [...project.media, ...(project.build ? [project.build] : [])];
  for (const [position, file] of files.entries()) {
    const kind = file === project.build ? 'build' : 'media';
    await client.query(`INSERT INTO portfolio.project_files
      (id, project_id, kind, name, type, size, position, permission) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [file.id, project.id, kind, file.name, file.type, file.size, position, file.permission ?? null]);
  }
}

async function lockProject(client, ownerId, projectId, revision) {
  const { rows: [project] } = await client.query(
    'SELECT revision FROM portfolio.projects WHERE owner_id = $1 AND id = $2 FOR UPDATE', [ownerId, projectId],
  );
  if (!project) throw projectError('Project not found.', 404);
  if (project.revision !== revision) throw projectError('Project changed. Reload it before trying again.', 412);
}

async function projectFileIds(client, projectId) {
  const { rows } = await client.query('SELECT id FROM portfolio.project_files WHERE project_id = $1', [projectId]);
  return rows.map(row => row.id);
}

export async function openDatabase(config) {
  const pool = new Pool(config);
  pool.on('error', () => console.error('An idle PostgreSQL connection failed.'));
  try {
    await pool.query('SELECT id, name, email, password_hash, created_at, showroom_id FROM portfolio.users LIMIT 0');
    await pool.query('SELECT id, user_id, refresh_token_hash, created_at, last_refreshed_at, expires_at, revoked_at FROM portfolio.sign_in_sessions LIMIT 0');
    await pool.query('SELECT provider, provider_user_id, user_id, linked_at FROM portfolio.provider_identities LIMIT 0');
    await pool.query('SELECT id, owner_id, revision FROM portfolio.projects LIMIT 0');
    await pool.query('SELECT project_id FROM portfolio.project_notes LIMIT 0');
    await pool.query('SELECT id, project_id FROM portfolio.project_files LIMIT 0');
    await pool.query(`${profileSelect} LIMIT 0`);
    await pool.query('SELECT id, project_id, created_at FROM portfolio.feed_posts LIMIT 0');
    await pool.query('SELECT post_id, user_id FROM portfolio.post_likes LIMIT 0');
    await pool.query('SELECT id, post_id, user_id, text, created_at FROM portfolio.post_comments LIMIT 0');
  } catch (error) {
    await pool.end();
    throw new Error(`Unable to connect to PostgreSQL or find the application tables. Run pending migrations. ${describeDatabaseError(error)}`);
  }

  async function first(sql, parameters) {
    const { rows } = await pool.query(sql, parameters);
    return rows[0];
  }

  async function projectTransaction(operation) {
    const client = await pool.connect();
    let committing = false;
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      committing = true;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (committing) error.commitUncertain = true;
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    ...createFeedOperations(pool),
    findOwnerProfile(ownerId) {
      return first(`${profileSelect} WHERE p.owner_id = $1`, [ownerId]);
    },
    findPublicProfile(publicId) {
      return first(`${profileSelect} WHERE p.public_id = $1`, [publicId]);
    },
    async saveProfile(ownerId, fields, change) {
      const client = await pool.connect();
      let committing = false;
      try {
        await client.query('BEGIN');
        // The upsert holds the owner row lock until the attachment change commits.
        await client.query(
          `INSERT INTO portfolio.profiles (owner_id, public_id, fields) VALUES ($1, $2, $3)
           ON CONFLICT (owner_id) DO UPDATE SET fields = EXCLUDED.fields`,
          [ownerId, randomUUID(), fields],
        );
        let retiredKey;
        if (change) {
          const { rows: [previous] } = await client.query(
            'SELECT object_key FROM portfolio.cv_attachments WHERE owner_id = $1', [ownerId],
          );
          retiredKey = previous?.object_key;
          if (change.remove) {
            await client.query('DELETE FROM portfolio.cv_attachments WHERE owner_id = $1', [ownerId]);
          } else {
            await client.query(
              `INSERT INTO portfolio.cv_attachments (owner_id, object_key, filename, size)
               VALUES ($1, $2, $3, $4) ON CONFLICT (owner_id) DO UPDATE
               SET object_key = EXCLUDED.object_key, filename = EXCLUDED.filename, size = EXCLUDED.size`,
              [ownerId, change.key, change.name, change.size],
            );
          }
        }
        const { rows: [profile] } = await client.query(`${profileSelect} WHERE p.owner_id = $1`, [ownerId]);
        committing = true;
        await client.query('COMMIT');
        return { profile, retiredKey };
      } catch (error) {
        if (committing) error.commitUncertain = true;
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
    createProject(project) {
      return projectTransaction(async client => {
        await client.query(`INSERT INTO portfolio.projects
          (id, owner_id, title, type, description, stack, published) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [project.id, project.ownerId, project.title, project.type, project.description, project.stack, project.published]);
        await writeProjectAssociations(client, project);
        await ensureFeedPost(client, project.id);
        const { rows: [saved] } = await client.query(`${projectSelect()} WHERE p.id = $1 AND p.owner_id = $2`, [project.id, project.ownerId]);
        return saved;
      });
    },
    updateProject(project, revision) {
      return projectTransaction(async client => {
        await lockProject(client, project.ownerId, project.id, revision);
        const previous = await projectFileIds(client, project.id);
        await client.query(`UPDATE portfolio.projects
          SET title = $3, type = $4, description = $5, stack = $6, published = $7, revision = revision + 1
          WHERE owner_id = $1 AND id = $2`,
        [project.ownerId, project.id, project.title, project.type, project.description, project.stack, project.published]);
        // Replace associations inside the transaction to avoid transient position conflicts.
        await client.query('DELETE FROM portfolio.project_notes WHERE project_id = $1', [project.id]);
        await client.query('DELETE FROM portfolio.project_files WHERE project_id = $1', [project.id]);
        await writeProjectAssociations(client, project);
        await ensureFeedPost(client, project.id);
        const kept = new Set([...project.media, project.build].filter(Boolean).map(file => file.id));
        const { rows: [saved] } = await client.query(`${projectSelect()} WHERE p.id = $1 AND p.owner_id = $2`,
          [project.id, project.ownerId]);
        return { project: saved, revision: revision + 1, retired: previous.filter(id => !kept.has(id)) };
      });
    },
    deleteProject(ownerId, id, revision) {
      return projectTransaction(async client => {
        await lockProject(client, ownerId, id, revision);
        const retired = await projectFileIds(client, id);
        await client.query('DELETE FROM portfolio.projects WHERE owner_id = $1 AND id = $2', [ownerId, id]);
        return retired;
      });
    },
    async listProjects(ownerId) {
      const { rows } = await pool.query(`${projectSelect()} WHERE p.owner_id = $1 ORDER BY p.created_at, p.id`, [ownerId]);
      return rows;
    },
    findProject(ownerId, id) {
      return first(`${projectSelect(true)} WHERE p.owner_id = $1 AND p.id = $2`, [ownerId, id]);
    },
    findOwnerShowroom(ownerId) {
      return first('SELECT showroom_id AS id FROM portfolio.users WHERE id = $1', [ownerId]);
    },
    findPublicShowroom(showroomId) {
      return first(`SELECT u.showroom_id AS id, profile.public_id AS "profileId"
        FROM portfolio.users u LEFT JOIN portfolio.profiles profile ON profile.owner_id = u.id
        WHERE u.showroom_id = $1`, [showroomId]);
    },
    async listPublicProjects(showroomId) {
      const { rows } = await pool.query(`${projectSelect()}
        JOIN portfolio.users u ON u.id = p.owner_id
        WHERE u.showroom_id = $1 AND p.published
        ORDER BY p.created_at, p.id`, [showroomId]);
      return rows;
    },
    findPublicProject(showroomId, projectId) {
      return first(`${projectSelect()}
        JOIN portfolio.users u ON u.id = p.owner_id
        WHERE u.showroom_id = $1 AND p.id = $2 AND p.published`, [showroomId, projectId]);
    },
    findPublicProjectFile(showroomId, projectId, fileId) {
      return first(`SELECT f.id, f.name, f.type, f.kind
        FROM portfolio.project_files f
        JOIN portfolio.projects p ON p.id = f.project_id
        JOIN portfolio.users u ON u.id = p.owner_id
        WHERE u.showroom_id = $1 AND p.id = $2 AND f.id = $3 AND p.published
          AND (f.kind = 'media' OR (f.kind = 'build' AND f.permission = 'public'))`,
      [showroomId, projectId, fileId]);
    },
    findProjectFile(ownerId, id) {
      return first(`SELECT f.id, f.name, f.type, f.size, f.kind, f.permission
        FROM portfolio.project_files f JOIN portfolio.projects p ON p.id = f.project_id
        WHERE p.owner_id = $1 AND f.id = $2`, [ownerId, id]);
    },
    async insertUser(name, email, passwordHash) {
      const row = await first(
        'INSERT INTO portfolio.users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [name, email, passwordHash],
      );
      return row.id;
    },
    async listLinkedProviders(userId) {
      const { rows } = await pool.query('SELECT provider FROM portfolio.provider_identities WHERE user_id = $1 ORDER BY provider', [userId]);
      return rows.map(row => row.provider);
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
