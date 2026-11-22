CREATE TABLE portfolio.projects (
  id UUID PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES portfolio.users(id),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  type TEXT NOT NULL CHECK (type IN ('open', 'private')),
  description TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 5000),
  stack TEXT NOT NULL CHECK (length(btrim(stack)) BETWEEN 1 AND 1000),
  published BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX projects_owner_id_idx ON portfolio.projects(owner_id, created_at, id);

CREATE TABLE portfolio.project_notes (
  project_id UUID PRIMARY KEY REFERENCES portfolio.projects(id) ON DELETE CASCADE,
  story TEXT NOT NULL DEFAULT '',
  compatibility TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  release_notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE portfolio.project_files (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES portfolio.projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('media', 'build')),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  position INTEGER NOT NULL CHECK (position >= 0),
  permission TEXT,
  CHECK ((kind = 'media' AND permission IS NULL) OR
         (kind = 'build' AND permission IS NOT NULL AND permission IN ('public', 'request', 'none'))),
  UNIQUE (project_id, kind, position)
);
CREATE UNIQUE INDEX project_one_build_idx ON portfolio.project_files(project_id) WHERE kind = 'build';

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'portfolio_app') THEN
    GRANT SELECT, INSERT ON portfolio.projects, portfolio.project_notes, portfolio.project_files TO portfolio_app;
  END IF;
END
$$;
