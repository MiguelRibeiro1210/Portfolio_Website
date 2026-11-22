# Remote database setup and migration guide

This guide explains the change from local SQLite to remote PostgreSQL on Supabase, the current implementation, and how to set up or extend the database. All SQL examples below are instructions; editing this document does not execute them.

## 1. What changed

| Area | Previous SQLite implementation | Current PostgreSQL implementation |
| --- | --- | --- |
| Database location | Local `portfolio.sqlite` file | Supabase-hosted PostgreSQL |
| Node.js driver | `sqlite3`, wrapped in promises | `pg`, using one connection pool with at most five connections |
| Connection configuration | File path / `SQLITE_PATH` | Server-only `DATABASE_URL`, loaded from `.env` |
| Transport security | Local file access | TLS with certificate and hostname verification |
| Schema setup | `schema.sql` executed when opening the database | Numbered migrations tracked in `portfolio.schema_migrations`; startup checks the auth tables |
| Users table | Unqualified `users` | Explicit `portfolio.users` |
| Generated ID | `INTEGER PRIMARY KEY`, insertion ID from `lastID` | `INTEGER GENERATED ALWAYS AS IDENTITY`, insertion ID from `RETURNING id` |
| Query parameters | `?` placeholders | `$1`, `$2`, `$3` placeholders |
| Creation timestamp | `TEXT DEFAULT CURRENT_TIMESTAMP` | `TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP` |
| Duplicate-email detection | SQLite constraint code and message | PostgreSQL `23505` and named constraint `users_email_key` |
| Authentication ownership | Application registration and bcrypt | Still application registration and bcrypt; Supabase Auth is unused |
| Existing local account | Stored in the SQLite file | Not imported; the remote database started empty |

The SQLite file remains an ignored backup. There is no automatic fallback to SQLite and no SQLite runtime driver.

### What works now

The website registration form calls `POST /api/register`. The backend validates and normalizes input, hashes the password with bcrypt cost 12, inserts into `portfolio.users`, and returns the public account fields. Invalid input returns `400`; an existing normalized email returns `409`; success returns `201`. Registration does not sign the account in.

Password login and token rotation use `portfolio.sign_in_sessions`. Configured Google and GitHub providers use `portfolio.provider_identities`. Password reset, project/CV persistence, and durable uploads remain future work. Project and profile editors still use temporary preview state. Creating database tables alone will not connect those editors to persistence.

```text
Website registration form
  → POST /api/register (your Express backend)
  → validation and bcrypt password hashing
  → pg connection pool with verified TLS
  → Supabase PostgreSQL: portfolio.users
```

Supabase provides the database. Accounts are application records, not Supabase Auth users. The frontend does not connect directly to PostgreSQL.

## 2. Configure a remote connection

### Obtain the correct connection string

In your Supabase project, open **Connect → Session pooler**, port **5432**. Copy the exact hostname and username displayed. The direct `db.PROJECT_REF.supabase.co` endpoint can require IPv6; the session pooler supports IPv4. See [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres).

Update your existing `.env` without overwriting unrelated settings:

```dotenv
DATABASE_URL=postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@POOLER_HOST:5432/postgres
DATABASE_SSL=true
DATABASE_CA_CERT_PATH=./src/db/certs/supabase-root-2021.crt
PORT=3000
```

Replace the placeholders using your project's connection details. The password is the database password, not a Supabase publishable/anon key. URL-encode special password characters such as `@`, `:`, `/`, `#`, and `%`. Do not include the literal password-placeholder brackets.

Keep `.env` private and ignored by Git. The committed `.env.example` contains placeholders. The `NEXT_PUBLIC_SUPABASE_*` variables are not used by this backend. Shell environment variables take precedence over `.env`; check for an old exported value if a file edit seems ineffective.

### Configure the root certificate

The repository includes the public Supabase root certificate at `src/db/certs/supabase-root-2021.crt`. It was downloaded over HTTPS from [Supabase's certificate distribution](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt) and expires April 26, 2031. It contains no private key or application credentials.

`DATABASE_CA_CERT_PATH` tells Node.js to trust that CA while continuing to verify the hostname and certificate chain. Run commands from the repository root so the relative path resolves correctly. If Supabase rotates its CA, obtain the replacement from **Database Settings → SSL Configuration**, replace the certificate or configure its new path, and verify the connection again. See [Supabase SSL configuration](https://supabase.com/docs/guides/platform/ssl-enforcement).

Do not append SSL query parameters such as `sslmode=require`: this application's configuration rejects them because they can override node-postgres's explicit verification settings. See [node-postgres TLS configuration](https://node-postgres.com/features/ssl).

`DATABASE_SSL=false` is supported only for a local PostgreSQL host (`localhost`, `127.0.0.1`, or `::1`). Use verified TLS for Supabase.

## 3. Apply database migrations

From the repository root, run:

```bash
npm ci
npm run db:migrate
npm start
```

[`001_create_users.sql`](../src/db/migrations/001_create_users.sql) creates the `portfolio` schema and account table. [`002_create_auth_tables.sql`](../src/db/migrations/002_create_auth_tables.sql) adds sessions and provider identities. Session timestamps use integer Unix milliseconds. Account creation uses `TIMESTAMPTZ`.

The runner serializes migration attempts with a PostgreSQL transaction lock and records applied filenames in `portfolio.schema_migrations`. If the database already has the original `portfolio.users` table and no history, it checks the column definitions, generated identity, and key constraints before recording `001` and applying `002`. Existing users are preserved. A mismatched schema stops the migration for inspection.

### Inspect the database in WebStorm

Add a PostgreSQL data source in the Database panel. Use the session-pooler host, port, database, and username from the server connection settings. Configure certificate verification and keep the password in the IDE's local credential store. Select the `portfolio` schema and refresh to see its tables.

## 4. Verify registration and find saved accounts

Start the application with `npm start`, open `http://localhost:3000/#/register`, and register an account. Success displays **Account created successfully.**

You can also call the backend directly using disposable demo credentials:

```bash
curl http://localhost:3000/api/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo User","email":"demo@example.com","password":"example-password"}'
```

Expected response: `201` with a numeric ID, name, and normalized email. Repeating the same account returns `409`. The response never contains the password or hash.

In Supabase, open **Table Editor**, change the schema selector from **public** to **portfolio**, select **users**, and refresh. These records do not appear under **Authentication → Users**.

In the SQL Editor:

```sql
SELECT id, name, email, created_at
FROM portfolio.users
ORDER BY created_at DESC;
```

Restart the server and check the same row to verify persistence. The server checks database connectivity and required columns before accepting requests; it does not create tables at startup.

## 5. Migrate existing SQLite records when needed

The completed project migration intentionally started with an empty remote database. **No SQLite data importer is implemented.** The following is the procedure for a future data-preserving migration, not an operation to repeat on the current database:

1. Stop writes to the source application and back up its SQLite file. Work from a read-only copy.
2. Provision a separate PostgreSQL target and apply the initial schema. Inventory all source tables first; the initial migration covers users and migration `002` adds authentication tables.
3. Write a one-off server-side importer using parameterized PostgreSQL inserts in a transaction. Transfer names, normalized emails, original bcrypt hashes, and creation timestamps. Keep password hashes private; do not commit exports.
4. Decide and document duplicate-email handling before importing. Stop and resolve collisions rather than silently replacing accounts.
5. Preserve IDs if other records reference them. PostgreSQL's generated-always identity requires `OVERRIDING SYSTEM VALUE` for explicitly supplied IDs. After import, reset its sequence so new accounts receive unused IDs.
6. Interpret old timestamp strings using the source application's actual timezone; convert them to `TIMESTAMPTZ`. Do not guess a timezone for historical data.
7. Verify counts, IDs, constraints, representative timestamps, and bcrypt password compatibility. Commit only after validation; roll back on failure.
8. Switch `DATABASE_URL`, restart, and verify registration and reads. Keep the source backup until the migration is accepted.

When preserved IDs have been imported, this owner-run query resets the sequence correctly, including an empty table:

```sql
SELECT setval(
    pg_get_serial_sequence('portfolio.users', 'id'),
    COALESCE((SELECT MAX(id) FROM portfolio.users), 1),
    EXISTS (SELECT 1 FROM portfolio.users)
);
```

For this project, new accounts should continue to be created through `/api/register`; do not copy the old SQLite file into Supabase.

## 6. Add more tables and schemas

A schema groups related tables inside the same PostgreSQL database. For example, `portfolio.users` means the `users` table in the `portfolio` schema. An additional table can stay in `portfolio`; use another schema when a separate logical group helps organize the application. Schemas do not replace per-user authorization. See [PostgreSQL schemas](https://www.postgresql.org/docs/current/ddl-schemas.html).

### Worked example: a showcase schema

This example is a future change, not an implemented project feature. Save the SQL below in a new file such as `src/db/migrations/002_create_showcase.sql`, then run the whole file once in the SQL Editor as the migration owner:

```sql
BEGIN;

CREATE SCHEMA showcase;

CREATE TABLE showcase.projects (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES portfolio.users(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX projects_owner_id_idx ON showcase.projects (owner_id);

COMMIT;
```

For a new table in the existing schema, omit `CREATE SCHEMA` and use `portfolio.projects` consistently instead. Do not add a new schema merely to add a table.

Keep names explicit in backend SQL. Example queries for the future project adapter:

```sql
INSERT INTO showcase.projects (owner_id, title, description)
VALUES ($1, $2, $3)
RETURNING id;

SELECT id, title, description, created_at
FROM showcase.projects
WHERE owner_id = $1;
```

Pass values through `pg`'s parameter array, never through SQL string concatenation. Derive `owner_id` from the authenticated account when authentication is implemented. Add routes, service validation, frontend API calls, and integration tests alongside the table; the database migration does not create those application features.

For later alterations, create another numbered migration rather than editing a file already applied. Use transactions where supported, validate against the test database first, back up affected data, and deploy compatible application code after the required schema change. Avoid dropping schemas or tables as a way to rerun setup.

### Grant access to each schema and table

Schema access and table access are separate permissions. The restricted runtime role must exist before the following grants run:

```sql
GRANT USAGE ON SCHEMA showcase TO portfolio_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON showcase.projects TO portfolio_app;
GRANT USAGE ON SEQUENCE showcase.projects_id_seq TO portfolio_app;
```

Grant only the actions the implemented feature needs. To inspect schemas and tables:

```sql
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name IN ('portfolio', 'showcase');

SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('portfolio', 'showcase')
ORDER BY table_schema, table_name;
```

Prefer explicit grants in each migration. If a future schema deliberately gives the runtime role the same permissions on every new table, its owner can configure default privileges. Those defaults affect only future objects created by the specified owner, not existing tables or other creators. See [PostgreSQL default privileges](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html).

### Keep backend schemas out of the Data API

Keep `portfolio` and any new backend-only schemas outside Supabase's exposed Data API schemas. If nothing in the project uses that API, it can be disabled. If another feature uses it, preserve that configuration and leave these schemas unexposed. [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api).

Do not modify Supabase-managed `auth` or `storage` schemas to create application tables. If browser-to-Supabase access is added in future, design its grants, authentication integration, and row-level security separately before exposing tables.

## 7. Separate runtime and migration credentials

Initial setup can use the project database owner. Before public hosting, create a restricted application login in the SQL Editor; replace the password privately:

```sql
CREATE ROLE portfolio_app LOGIN PASSWORD 'REPLACE_WITH_A_STRONG_PASSWORD';
GRANT USAGE ON SCHEMA portfolio TO portfolio_app;
GRANT SELECT, INSERT ON portfolio.users TO portfolio_app;
GRANT USAGE ON SEQUENCE portfolio.users_id_seq TO portfolio_app;
GRANT SELECT, INSERT ON portfolio.sign_in_sessions TO portfolio_app;
GRANT UPDATE (refresh_token_hash, last_refreshed_at, revoked_at)
  ON portfolio.sign_in_sessions TO portfolio_app;
GRANT SELECT, INSERT ON portfolio.provider_identities TO portfolio_app;
```

Use `portfolio_app.PROJECT_REF` as the session-pooler username in `DATABASE_URL`, with that role's encoded password. Preserve the owner connection separately as `MIGRATION_DATABASE_URL` only where migrations are performed. The migration command prefers `MIGRATION_DATABASE_URL` when set; runtime queries use `DATABASE_URL`.

Migration `002` grants auth-table privileges to `portfolio_app` if the role already exists. If you create the role afterward, run the grants above. Add privileges for new features deliberately. The runtime role should not own schemas or perform DDL.

## Testing

`npm test` runs frontend checks, configuration/startup checks, and the registration, login, and OAuth integration tests. The integration tests are skipped until `TEST_DATABASE_URL` is configured.

Use a separate disposable PostgreSQL database whose name ends in `_test`, never the application database:

```dotenv
TEST_DATABASE_URL=postgresql://postgres:ENCODED_PASSWORD@127.0.0.1:5432/portfolio_test
TEST_DATABASE_SSL=false
```

For a remote test database, enable TLS and configure `TEST_DATABASE_CA_CERT_PATH` as necessary. Then run:

```bash
npm run test:integration
```

The integration tests serialize access to their temporary `portfolio` schema and remove it after use. They refuse an existing schema and never fall back to the application's `DATABASE_URL`. The suite exercises both a fresh migration and an upgrade that preserves an existing account.

`npm run test:e2e` runs browser preview tests. Setting `TEST_DATABASE_URL` also enables browser sign-in, reload, and logout against the disposable database.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `ENETUNREACH` with a direct database host | Use the exact Session pooler URL, port 5432, for IPv4 access. |
| `SELF_SIGNED_CERT_IN_CHAIN` | Configure `DATABASE_CA_CERT_PATH` with the Supabase root CA and retain TLS verification. |
| Password authentication failure | Check database username/password and URL encoding; API keys are not database passwords. |
| Configuration edit seems ignored | Check exported shell variables and whether `MIGRATION_DATABASE_URL` overrides the migration target. |
| Existing schema does not match migration `001` | Inspect the columns and constraints on `portfolio.users` before retrying. |
| New numbered migration has no effect | Check the target URL and `portfolio.schema_migrations`. Migration filenames must start with a three-digit number followed by an underscore. |
| Permission denied after adding a schema | Grant schema `USAGE`, required table actions, and identity-sequence `USAGE`. |
| Website reports success but Table Editor looks empty | Select the correct schema, then the table, and refresh; check `portfolio.users` using SQL. |
| Registration works but sign-in does not | Login and token issuance are not implemented yet. |
