# US001 — Create an Account and Sign In

## 1. Requirements Engineering

### 1.1. User story

As a user, I want to create an account and sign in so I can access my private portfolio workspace.

This plan covers the first backend milestone, account registration with a name, email address, and password. 
### 1.2. Acceptance criteria

- **AC1:** A valid registration request creates one account and returns `201 Created` with its ID, name, and email.
- **AC2:** Missing or invalid fields and malformed JSON return `400 Bad Request` without creating an account.
- **AC3:** An email already registered returns `409 Conflict`. Email matching ignores surrounding whitespace and case. Simultaneous requests for the same email create at most one account.
- **AC4:** The database stores a bcrypt password hash. The API response contains neither the password nor its hash.
- **AC5:** The account persists across server restarts and is available for the later sign-in flow.

### 1.3. Inputs and outputs

**Endpoint** — `POST /api/register` with `Content-Type: application/json`. Registration is open to unauthenticated callers.

| Field | Proposed server validation |
| --- | --- |
| `name` | Required string. Trim surrounding whitespace and require 1–100 characters. |
| `email` | Required string. Trim surrounding whitespace, lowercase, and check for a plausible email format. |
| `password` | Required string. Require at least 8 characters to match the current form and at most 72 UTF-8 bytes for bcrypt. Preserve the submitted password exactly. |

Example request body

```json
{
  "name": "Pedro Pacheco",
  "email": "pedro@example.com",
  "password": "sample-password"
}
```

Example `201 Created` response

```json
{
  "user": {
    "id": 1,
    "name": "Pedro Pacheco",
    "email": "pedro@example.com"
  }
}
```

Use a JSON error message for validation failures and duplicate emails. Unexpected database or hashing failures return a generic `500` response without exposing internal details.

### 1.4. Dependencies and decisions

- Use Express, the `pg` PostgreSQL driver, and bcrypt. Supabase hosts PostgreSQL; Supabase Auth is not used.
- The existing registration form already collects `name`, `email`, and `password`. Frontend integration is a separate task.
- Registration creates the account. A separate login request will start the session once token issuance is implemented.
- Use bcrypt with a cost of 12 as the proposed starting setting. Check the hashing time in the intended runtime when implementing.
- Email verification and profile creation are outside this registration milestone.

## 2. Analysis and Design

The `portfolio.users` table holds a generated integer primary key, name, unique normalized email, password hash, and `TIMESTAMPTZ` creation timestamp. Enforce uniqueness in PostgreSQL so concurrent requests cannot create duplicate accounts. The database adapter uses a connection pool with verified TLS; schema creation is an explicit migration.

| File | Responsibility |
| --- | --- |
| `src/db/migrations/001_create_users.sql` | Create the application schema and users table once, without overwriting existing data. |
| `src/db/database.js` | Connect to PostgreSQL, check the table before accepting requests, and expose parameterized insertion and pool cleanup. |
| `src/services/authService.js` | Validate and normalize registration data, hash the password, insert the user, and translate PostgreSQL `23505` errors for `users_email_key` into duplicate-email responses. |
| `src/routes/auth.routes.js` | Handle `POST /api/register` and map service results to HTTP responses. |
| `src/server.js` | Mount JSON parsing and the auth router while preserving static serving. |

Request flow

```text
POST /api/register
  → Express parses the JSON body
  → Auth route passes the registration fields to the service
  → Service validates input and hashes the password with bcrypt
  → PostgreSQL inserts the user and enforces email uniqueness
  → Auth route returns 201 with the public account fields
```

## 3. Test Plan

1. Submit valid input and verify the `201` response matches the public account fields.
2. Read the saved row and verify bcrypt accepts the original password against the stored hash. Check that the response omits credentials.
3. Submit missing fields, incorrect types, malformed JSON, a short password, and a password exceeding bcrypt's byte limit. Verify `400` and no new rows.
4. Try the same email with different case and whitespace. Also submit concurrent requests for one new email. Verify `409` for duplicates and exactly one saved account per email.
5. Restart the server against the isolated PostgreSQL test database and verify the account still exists. Never run destructive tests against the application database.

## 4. Implementation Order

1. Configure `DATABASE_URL` and verified TLS; apply the initial PostgreSQL migration explicitly.
2. Implement the registration service and handle the PostgreSQL email unique constraint.
3. Add and mount the registration route.
4. Run the endpoint tests against an isolated database and document how to call the endpoint.
