CREATE TABLE portfolio.feed_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES portfolio.projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX feed_posts_order_idx ON portfolio.feed_posts(created_at DESC, id DESC);

CREATE TABLE portfolio.post_likes (
  post_id UUID NOT NULL REFERENCES portfolio.feed_posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES portfolio.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE portfolio.post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES portfolio.feed_posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES portfolio.users(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (text = btrim(text) AND char_length(text) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX post_comments_order_idx ON portfolio.post_comments(post_id, created_at, id);

-- Preserve the original project ordering; rerunning the backfill is safe.
INSERT INTO portfolio.feed_posts (project_id, created_at)
SELECT id, created_at FROM portfolio.projects WHERE published
ON CONFLICT (project_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'portfolio_app') THEN
    GRANT SELECT, INSERT ON portfolio.feed_posts, portfolio.post_comments TO portfolio_app;
    GRANT SELECT, INSERT, DELETE ON portfolio.post_likes TO portfolio_app;
    -- FOR UPDATE project locks require an UPDATE privilege on the table.
    GRANT UPDATE (revision) ON portfolio.projects TO portfolio_app;
  END IF;
END
$$;
