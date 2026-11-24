import { feedError } from '../domain/feedRules.js';

// PostgreSQL Date conversion loses microseconds. Keep exact cursor boundaries separately.
const cursorTime = alias => `to_char(${alias}.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const commentFields = `c.id, c.post_id AS "postId", c.text, c.created_at AS "createdAt",
  ${cursorTime('c')} AS "cursorTime", json_build_object('id', u.id, 'name', u.name) AS author`;

export async function ensureFeedPost(client, projectId) {
  await client.query(`INSERT INTO portfolio.feed_posts (project_id)
    SELECT id FROM portfolio.projects WHERE id = $1 AND published
    ON CONFLICT (project_id) DO NOTHING`, [projectId]);
}

export function createFeedOperations(pool) {
  async function mutatePublishedPost(postId, operation) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize interactions with project edits/deletion and with each other.
      // Locking the project prevents a concurrent unpublish from accepting a write afterward.
      const { rows: [post] } = await client.query(`SELECT f.id FROM portfolio.feed_posts f
        JOIN portfolio.projects p ON p.id = f.project_id
        WHERE f.id = $1 AND p.published FOR UPDATE OF p`, [postId]);
      if (!post) throw feedError('Feed post not found.', 404);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  return {
    async listFeedPosts({ cursor, limit }, viewerId) {
      const { rows } = await pool.query(`WITH page AS (
        SELECT f.id, f.project_id, f.created_at FROM portfolio.feed_posts f
        JOIN portfolio.projects p ON p.id = f.project_id
        WHERE p.published AND ($1::timestamptz IS NULL OR (f.created_at, f.id) < ($1::timestamptz, $2::uuid))
        ORDER BY f.created_at DESC, f.id DESC LIMIT $3
      ) SELECT f.id, f.created_at AS "createdAt", ${cursorTime('f')} AS "cursorTime",
        json_build_object('id', u.id, 'name', u.name) AS author,
        json_build_object('id', p.id, 'title', p.title, 'type', p.type,
          'description', p.description, 'stack', p.stack) AS project,
        CASE WHEN cover.id IS NOT NULL THEN json_build_object('name', cover.name, 'type', cover.type) END AS cover,
        (SELECT count(*)::int FROM portfolio.post_likes l WHERE l.post_id = f.id) AS "likeCount",
        (SELECT count(*)::int FROM portfolio.post_comments c WHERE c.post_id = f.id) AS "commentCount",
        EXISTS(SELECT 1 FROM portfolio.post_likes l WHERE l.post_id = f.id AND l.user_id = $4) AS "viewerHasLiked"
      FROM page f JOIN portfolio.projects p ON p.id = f.project_id
      JOIN portfolio.users u ON u.id = p.owner_id
      LEFT JOIN LATERAL (SELECT m.id, m.name, m.type FROM portfolio.project_files m
        WHERE m.project_id = p.id AND m.kind = 'media'
        ORDER BY (m.type LIKE 'image/%') DESC, m.position, m.id LIMIT 1) cover ON true
      ORDER BY f.created_at DESC, f.id DESC`, [cursor?.time ?? null, cursor?.id ?? null, limit + 1, viewerId ?? null]);
      return rows;
    },
    async findFeedCover(postId) {
      const { rows: [file] } = await pool.query(`SELECT cover.id, cover.name, cover.type
        FROM portfolio.feed_posts f JOIN portfolio.projects p ON p.id = f.project_id
        JOIN LATERAL (SELECT m.id, m.name, m.type FROM portfolio.project_files m
          WHERE m.project_id = p.id AND m.kind = 'media'
          ORDER BY (m.type LIKE 'image/%') DESC, m.position, m.id LIMIT 1) cover ON true
        WHERE f.id = $1 AND p.published`, [postId]);
      return file;
    },
    async listFeedComments(postId, { cursor, limit }) {
      // A single statement distinguishes an empty comment page from an unavailable post.
      const { rows: [post] } = await pool.query(`SELECT COALESCE((SELECT json_agg(page) FROM (
          SELECT ${commentFields} FROM portfolio.post_comments c
          JOIN portfolio.users u ON u.id = c.user_id
          WHERE c.post_id = f.id AND ($2::timestamptz IS NULL OR (c.created_at, c.id) > ($2::timestamptz, $3::uuid))
          ORDER BY c.created_at, c.id LIMIT $4
        ) page), '[]') AS comments
        FROM portfolio.feed_posts f JOIN portfolio.projects p ON p.id = f.project_id
        WHERE f.id = $1 AND p.published`, [postId, cursor?.time ?? null, cursor?.id ?? null, limit + 1]);
      return post?.comments;
    },
    setFeedLike(postId, userId, liked) {
      return mutatePublishedPost(postId, async client => {
        if (liked) {
          await client.query('INSERT INTO portfolio.post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, userId]);
        } else {
          await client.query('DELETE FROM portfolio.post_likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
        }
        const { rows: [result] } = await client.query('SELECT count(*)::int AS "likeCount" FROM portfolio.post_likes WHERE post_id = $1', [postId]);
        return { ...result, viewerHasLiked: liked };
      });
    },
    createFeedComment(postId, userId, text) {
      return mutatePublishedPost(postId, async client => {
        const { rows: [comment] } = await client.query(`WITH inserted AS (
          INSERT INTO portfolio.post_comments (post_id, user_id, text) VALUES ($1, $2, $3) RETURNING *
        ) SELECT c.id, c.post_id AS "postId", c.text, c.created_at AS "createdAt",
          json_build_object('id', u.id, 'name', u.name) AS author
          FROM inserted c JOIN portfolio.users u ON u.id = c.user_id`, [postId, userId, text]);
        const { rows: [counts] } = await client.query('SELECT count(*)::int AS "commentCount" FROM portfolio.post_comments WHERE post_id = $1', [postId]);
        return { comment, ...counts };
      });
    },
  };
}
