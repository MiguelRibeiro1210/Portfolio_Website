ALTER TABLE portfolio.projects ADD COLUMN collaboration_notes TEXT NOT NULL DEFAULT '';

CREATE TABLE portfolio.project_collaborators (
  project_id UUID NOT NULL REFERENCES portfolio.projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES portfolio.users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'team_member', 'simple_participation')),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_collaborators_user_idx ON portfolio.project_collaborators(user_id, project_id);

INSERT INTO portfolio.project_collaborators (project_id, user_id, role)
SELECT id, owner_id, 'owner' FROM portfolio.projects;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'portfolio_app') THEN
    GRANT SELECT, INSERT, DELETE ON portfolio.project_collaborators TO portfolio_app;
    GRANT UPDATE (collaboration_notes) ON portfolio.projects TO portfolio_app;
  END IF;
END
$$;
