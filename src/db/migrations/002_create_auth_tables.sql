CREATE TABLE portfolio.sign_in_sessions (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES portfolio.users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    created_at BIGINT NOT NULL,
    last_refreshed_at BIGINT,
    expires_at BIGINT NOT NULL,
    revoked_at BIGINT
);

CREATE INDEX sign_in_sessions_user_id_idx ON portfolio.sign_in_sessions (user_id);

CREATE TABLE portfolio.provider_identities (
    provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
    provider_user_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES portfolio.users(id) ON DELETE CASCADE,
    linked_at BIGINT NOT NULL,
    CONSTRAINT provider_identities_pkey PRIMARY KEY (provider, provider_user_id),
    CONSTRAINT provider_identities_user_provider_key UNIQUE (user_id, provider)
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portfolio_app') THEN
        GRANT SELECT, INSERT ON portfolio.sign_in_sessions TO portfolio_app;
        GRANT UPDATE (refresh_token_hash, last_refreshed_at, revoked_at)
            ON portfolio.sign_in_sessions TO portfolio_app;
        GRANT SELECT, INSERT ON portfolio.provider_identities TO portfolio_app;
    END IF;
END
$$;
