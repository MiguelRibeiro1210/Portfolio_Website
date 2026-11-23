ALTER TABLE portfolio.users
  ADD COLUMN showroom_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT users_showroom_id_key UNIQUE (showroom_id);

CREATE INDEX projects_published_owner_idx
  ON portfolio.projects (owner_id, created_at, id) WHERE published;
