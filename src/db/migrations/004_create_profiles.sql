CREATE TABLE portfolio.profiles (
  owner_id INTEGER PRIMARY KEY REFERENCES portfolio.users(id) ON DELETE CASCADE,
  public_id UUID NOT NULL UNIQUE,
  fields JSONB NOT NULL CHECK (jsonb_typeof(fields) = 'object')
);

CREATE TABLE portfolio.cv_attachments (
  owner_id INTEGER PRIMARY KEY REFERENCES portfolio.profiles(owner_id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size BETWEEN 1 AND 10485760)
);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'portfolio_app') THEN
    GRANT SELECT, INSERT, UPDATE ON portfolio.profiles TO portfolio_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON portfolio.cv_attachments TO portfolio_app;
  END IF;
END
$$;
