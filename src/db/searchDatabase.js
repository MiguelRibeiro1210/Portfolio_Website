// Each name index can be used independently before aliases are collapsed to one account.
export const searchSuggestionsSql = `WITH normalized AS MATERIALIZED (
    SELECT portfolio.search_normalize($1::text) AS q
  ), patterns AS (
    SELECT q, escaped || '%' AS prefix, '%' || escaped || '%' AS contains
    FROM (SELECT q, replace(replace(replace(q, '!', '!!'), '%', '!%'), '_', '!_') AS escaped FROM normalized) escaped
  ), user_matches AS (
    SELECT u.id, CASE WHEN portfolio.search_normalize(u.name) = s.q THEN 0
      WHEN portfolio.search_normalize(u.name) LIKE s.prefix ESCAPE '!' THEN 1 ELSE 2 END AS rank
    FROM portfolio.users u CROSS JOIN patterns s
    WHERE portfolio.search_normalize(u.name) LIKE s.contains ESCAPE '!'
    UNION ALL
    SELECT p.owner_id, CASE WHEN portfolio.search_normalize(COALESCE(p.fields ->> 'name', '')) = s.q THEN 0
      WHEN portfolio.search_normalize(COALESCE(p.fields ->> 'name', '')) LIKE s.prefix ESCAPE '!' THEN 1 ELSE 2 END
    FROM portfolio.profiles p CROSS JOIN patterns s
    WHERE portfolio.search_normalize(COALESCE(p.fields ->> 'name', '')) LIKE s.contains ESCAPE '!'
  ), user_candidates AS (
    SELECT 'user'::text AS type, u.showroom_id AS id,
      COALESCE(NULLIF(btrim(p.fields ->> 'name'), ''), u.name) AS label,
      u.name AS "accountName", u.email AS email, NULL::text AS "creatorName", u.showroom_id AS "showroomId", p.public_id AS "profileId",
      m.rank, portfolio.search_normalize(COALESCE(NULLIF(btrim(p.fields ->> 'name'), ''), u.name)) COLLATE "C" AS sort_label, 0 AS type_order
    FROM (SELECT id, min(rank) AS rank FROM user_matches GROUP BY id) m
    JOIN portfolio.users u ON u.id = m.id LEFT JOIN portfolio.profiles p ON p.owner_id = u.id
    ORDER BY rank, sort_label, type_order, id LIMIT $2
  ), project_candidates AS (
    SELECT 'project'::text AS type, p.id, p.title AS label,
      NULL::text AS "accountName", NULL::text AS email, u.name AS "creatorName", u.showroom_id AS "showroomId", NULL::uuid AS "profileId",
      CASE WHEN portfolio.search_normalize(p.title) = s.q THEN 0
        WHEN portfolio.search_normalize(p.title) LIKE s.prefix ESCAPE '!' THEN 1 ELSE 2 END AS rank,
      portfolio.search_normalize(p.title) COLLATE "C" AS sort_label, 1 AS type_order
    FROM portfolio.projects p JOIN portfolio.users u ON u.id = p.owner_id CROSS JOIN patterns s
    WHERE p.published AND portfolio.search_normalize(p.title) LIKE s.contains ESCAPE '!'
    ORDER BY rank, sort_label, type_order, id LIMIT $2
  ) SELECT * FROM (SELECT * FROM user_candidates UNION ALL SELECT * FROM project_candidates) candidates
    ORDER BY rank, sort_label COLLATE "C", type_order, id LIMIT $2`;

export function createSearchOperations(pool) {
  return {
    async searchSuggestions({ q, limit }) {
      let client;
      let destroy = false;
      try {
        client = await pool.connect();
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout = '2s'");
        const { rows } = await client.query(searchSuggestionsSql, [q, limit + 1]);
        await client.query('COMMIT');
        return rows;
      } catch (error) {
        if (client) {
          try { await client.query('ROLLBACK'); } catch { destroy = true; }
        }
        throw error;
      } finally { client?.release(destroy); }
    },
  };
}
