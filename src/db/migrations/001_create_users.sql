BEGIN;

-- Intentionally fail if this schema already exists. Inspect existing data first.
CREATE SCHEMA portfolio;

CREATE TABLE portfolio.users (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_email_key UNIQUE (email)
);

COMMIT;
