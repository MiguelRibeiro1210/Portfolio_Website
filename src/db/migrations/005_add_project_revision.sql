ALTER TABLE portfolio.projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'portfolio_app') THEN
    GRANT UPDATE (title, type, description, stack, published, revision) ON portfolio.projects TO portfolio_app;
    GRANT DELETE ON portfolio.projects, portfolio.project_notes, portfolio.project_files TO portfolio_app;
  END IF;
END
$$;
