# Remote database setup and migration guide

This guide explains the change from local SQLite to remote PostgreSQL on Supabase, the current implementation, and how to set up or extend the database. All SQL examples below are instructions; editing this document does not execute them.

## 1. What changed

| Area | Previous SQLite implementation | Current PostgreSQL implementation |
| --- | --- | --- |
| Database location | Local `portfolio.sqlite` file | Supabase-hosted PostgreSQL |
| Node.js driver | `sqlite3`, wrapped in promises | `pg`, using one connection pool with at most five connections |
| Connection configuration | File path / `SQLITE_PATH` | Server-only `DATABASE_URL`, loaded from `.env` |
| Transport security | Local file access | TLS with certificate and hostname verification |
| Schema setup | `schema.sql` executed when opening the database | Explicit `001_create_users.sql` migration; startup only checks the table |
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

Login, access/refresh tokens, GitHub sign-in, password reset, project/CV persistence, and durable uploads remain future work. Project and profile editors still use temporary preview state. Creating database tables alone will not connect those editors to persistence.

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

Keep `.env` private and ignored by Git. If you add an `.env.example` for other developers, include placeholders only; the configuration block above can serve as its template. The `NEXT_PUBLIC_SUPABASE_*` variables are not used by this backend. Shell environment variables take precedence over `.env`; check for an old exported value if a file edit seems ineffective.

### Configure the root certificate

The repository includes the public Supabase root certificate at `src/db/certs/supabase-root-2021.crt`. It was downloaded over HTTPS from [Supabase's certificate distribution](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt) and expires April 26, 2031. It contains no private key or application credentials.

`DATABASE_CA_CERT_PATH` tells Node.js to trust that CA while continuing to verify the hostname and certificate chain. Run commands from the repository root so the relative path resolves correctly. If Supabase rotates its CA, obtain the replacement from **Database Settings → SSL Configuration**, replace the certificate or configure its new path, and verify the connection again. See [Supabase SSL configuration](https://supabase.com/docs/guides/platform/ssl-enforcement).

Do not append SSL query parameters such as `sslmode=require`: this application's configuration rejects them because they can override node-postgres's explicit verification settings. See [node-postgres TLS configuration](https://node-postgres.com/features/ssl).

`DATABASE_SSL=false` is supported only for a local PostgreSQL host (`localhost`, `127.0.0.1`, or `::1`). Use verified TLS for Supabase.

## 3. Apply the initial migration

### New database or new Supabase project

From the repository root:

```bash
npm ci
npm run db:migrate
npm start
```

Alternatively, paste the complete contents of [`001_create_users.sql`](../src/db/migrations/001_create_users.sql) into Supabase's SQL Editor and run it once, then start the application. Choose one migration method.

The migration runs in a transaction and creates:

```text
postgres database
└── portfolio schema
    └── users table
        ├── id: generated integer primary key
        ├── name: required text
        ├── email: required unique text
        ├── password_hash: required bcrypt hash
        └── created_at: timestamp with time zone
```

It deliberately refuses an existing `portfolio` schema. It neither imports SQLite records nor overwrites existing PostgreSQL tables.

### Existing configured project

The initial migration has already been applied to the project's current remote database. For this project, configure `.env` and run `npm start`; do not rerun `001`.

To check another target before setup, run this read-only query in the SQL Editor:

```sql
SELECT to_regclass('portfolio.users') AS users_table;
```

A `portfolio.users` result means the table exists. A null result means it does not; inspect any existing `portfolio` schema before attempting initial setup. After a failed transaction in the SQL Editor, issue `ROLLBACK;` before proceeding if the session is still in an aborted transaction.

### Migration command behavior

**`npm run db:migrate` currently executes only `001_create_users.sql`.** It does not scan the migration directory, maintain a migration-history table, or skip previously applied migrations. Adding `002_*.sql` does not make that command run it.

For subsequent changes, commit a new numbered SQL migration and run its complete contents once through the SQL Editor, using the schema-owner role. Record the filename, target environment, date, and outcome in the change's deployment notes. Apply the same file to each environment in order. For automatic discovery and tracking, implement a version-aware migration runner as a separate change.

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
2. Provision a separate PostgreSQL target and apply the initial schema. Inventory all source tables first; the current migration covers only users.
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
```

Use `portfolio_app.PROJECT_REF` as the session-pooler username in `DATABASE_URL`, with that role's encoded password. Preserve the owner connection separately as `MIGRATION_DATABASE_URL` only where migrations are performed. The migration command prefers `MIGRATION_DATABASE_URL` when set; runtime queries use `DATABASE_URL`.

These are setup instructions: the initial migration does not create `portfolio_app` automatically. Add privileges for new features deliberately. The runtime role should not own schemas or perform DDL.

## Testing

`npm test` runs frontend checks, configuration/startup checks, and the registration integration test. The integration test is explicitly skipped until `TEST_DATABASE_URL` is configured.

Use a separate disposable PostgreSQL database whose name ends in `_test`, never the application database:

```dotenv
TEST_DATABASE_URL=postgresql://postgres:ENCODED_PASSWORD@127.0.0.1:5432/portfolio_test
TEST_DATABASE_SSL=false
```

For a remote test database, enable TLS and configure `TEST_DATABASE_CA_CERT_PATH` as necessary. Then run:

```bash
npm run test:integration
```

The integration test creates its own `portfolio` schema, checks validation, concurrent duplicate emails, bcrypt hashing, and persistence after restarting the server, and removes only its own schema afterward. It refuses an existing schema and never falls back to the application's `DATABASE_URL`.

`npm run test:e2e` uses a separate database-free frontend preview server. Browser layout tests alone do not verify remote persistence. New schema migrations should also be exercised against an isolated test database before deployment; current registration tests do not discover or apply later migration files automatically.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `ENETUNREACH` with a direct database host | Use the exact Session pooler URL, port 5432, for IPv4 access. |
| `SELF_SIGNED_CERT_IN_CHAIN` | Configure `DATABASE_CA_CERT_PATH` with the Supabase root CA and retain TLS verification. |
| Password authentication failure | Check database username/password and URL encoding; API keys are not database passwords. |
| Configuration edit seems ignored | Check exported shell variables and whether `MIGRATION_DATABASE_URL` overrides the migration target. |
| Initial migration reports an existing schema | Inspect it; do not rerun `001` or drop existing data. |
| New numbered migration has no effect | The current runner executes only `001`; apply the new file explicitly through the SQL Editor. |
| Permission denied after adding a schema | Grant schema `USAGE`, required table actions, and identity-sequence `USAGE`. |
| Website reports success but Table Editor looks empty | Select the correct schema, then the table, and refresh; check `portfolio.users` using SQL. |
| Registration works but sign-in does not | Login and token issuance are not implemented yet. |
