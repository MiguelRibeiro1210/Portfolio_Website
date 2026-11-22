# Portfolio_website

![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-Express%20API-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Passwords](https://img.shields.io/badge/Passwords-bcrypt-informational?style=for-the-badge)

A full-stack web platform for developers and students to manage private portfolio projects, downloadable builds, and structured CV entries with strict per-user ownership and session-based security.

**Current implementation:** registration, password login, and application sessions use PostgreSQL. Google and GitHub sign-in are available when configured. The project and CV editors use temporary preview state. Authentication is handled by Express. See [Remote database setup](docs/remote_database_setup.md) for the database configuration.

---

## Table of Contents

- [About the Project & Target Users](#about-the-project--target-users)
- [Key Features](#key-features)
- [Tech Stack & Architecture](#tech-stack--architecture)
- [Database Schema](#database-schema)
- [Getting Started (Codespaces & Local Setup)](#getting-started-codespaces--local-setup)
- [REST API Endpoints](#rest-api-endpoints)
- [Security Tests](#security-tests)
- [Known Limitations](#known-limitations)
- [Contributions, AI Tools & Credits](#contributions-ai-tools--credits)

---

## About the Project & Target Users

**Target users:** Software developers, students, and job applicants who need a single place to organize their projects and CV data without exposing private source code or letting other users access their records.

Developers often struggle to keep track of project write-ups, compiled demo packages, and CV entries while keeping draft/private work isolated per account. Our project lets each authenticated user register, sign in, create/edit/delete their own projects and CV entries, and manage their profile safely.

---

## Key Features

Authentication is implemented. The project and CV features below describe the target platform.

- **Authentication & Session Security:** Account registration with server-side validation (`409` on duplicate email), password hashing with `bcrypt` (cost ≥ 10), generic error responses on failed login (`401`), and revocable PostgreSQL sessions with rotating `HttpOnly` refresh cookies.
- **Per-User Ownership & Authorization:** `requireAuth` middleware protects private endpoints (`401` when unauthenticated), and every read, update, and delete filters by the authenticated session user (`WHERE owner_id = $1`), returning `403` or `404` when attempting to access another user's record.
- **Double Token Security:** Combines a short-lived authentication (access) token for API requests with a longer-lived refresh token to renew sessions safely without requiring frequent re-authentication.
- **Project Management (CRUD):** Create, view, update, and delete projects (open-source links, private/closed-source build downloads, media previews, and technical specs).
- **CV & Profile Management:** Manage structured CV sections (summary, experience, education, skills) and profile details tied to the authenticated user.
- **Safe Browser Client:** Frontend calls the backend via `fetch()`, displays server status messages clearly, and renders user-supplied text using `textContent` rather than `innerHTML`.

---

## Tech Stack & Architecture

- **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+), served from the same Node.js/Express application.
- **Backend:** Node.js + Express REST API, `jsonwebtoken`, `bcrypt`, `dotenv` (plus `multer` where file uploads are used).
- **Database:** Supabase PostgreSQL through the server-only `pg` driver, with parameterized queries (`$1`, `$2`, …), a pool of at most five connections, and verified TLS. Schema changes are explicit migrations, not startup side effects.

```text
Browser (HTML/CSS/JS + fetch + textContent)
        │
        ▼  HTTP / JSON + Bearer JWT and HttpOnly Refresh Cookie
Express REST API (routes, requireAuth, ownership checks)
        │
        ▼  Parameterized SQL ($1, $2, …)
Supabase PostgreSQL (users, sign_in_sessions, provider_identities)
```
## Database Schema

The initial migration is [`001_create_users.sql`](src/db/migrations/001_create_users.sql). It creates `portfolio.users` with a generated integer ID, name, unique normalized email, bcrypt password hash, and `TIMESTAMPTZ` creation time. [`002_create_auth_tables.sql`](src/db/migrations/002_create_auth_tables.sql) adds sign-in sessions and provider identities. Existing PostgreSQL accounts keep their IDs and password hashes.

---

## Getting Started (Codespaces & Local Setup)

Install dependencies and configure the app from the project root:

1. **Install dependencies:**
   Run `npm install` in the project root.

2. **Configure `.env`:**
   Copy `.env.example` only if you do not already have `.env`; otherwise add the documented database settings to the existing file. Set `DATABASE_URL` to the Supabase **Session pooler** PostgreSQL connection string, with your database password URL-encoded. Keep TLS enabled. Supabase publishable keys do not replace a database connection string. Never commit `.env`.

3. **Apply pending migrations.** Run `npm run db:migrate` with a schema-owner connection. The runner verifies and records an existing compatible `001` schema before adding the authentication tables. See [setup and restricted runtime credentials](docs/remote_database_setup.md).

4. **Start the server:** Run `npm start` and open `http://localhost:3000`. Startup checks the database and authentication tables before listening. Set `PORT` to change the port. Set a random `JWT_SECRET` of at least 32 bytes in production.

---

## REST API Endpoints

The authentication endpoints are implemented. Project and CV endpoints are planned contracts.

| Method | Path | Auth / Ownership | Purpose |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/register` | No | Register a new user (`201`, `400`, `409`) |
| `POST` | `/api/login` | No | Verify credentials and issue an access token and refresh cookie (`200`, `400`, `401`) |
| `GET` | `/api/me` | Bearer token | Get the signed-in account (`200`, `401`) |
| `POST` | `/api/refresh` | Refresh cookie | Rotate the refresh token and issue an access token (`200`, `401`) |
| `POST` | `/api/logout` | Refresh cookie when present | Revoke the session and clear the cookie (`204`) |
| `GET` | `/api/projects` | Yes (owner) | List projects owned by the signed-in user (`WHERE owner_id = $1`) |
| `POST` | `/api/projects` | Yes | Create a new project owned by `req.user.id` (`201`, `400`, `401`) |
| `GET` | `/api/projects/:id` | Yes (owner only) | Get a specific project if owned by current user (`200`, `401`, `403`/`404`) |
| `PUT` | `/api/projects/:id` | Yes (owner only) | Update a project owned by current user (`200`, `400`, `401`, `403`/`404`) |
| `DELETE` | `/api/projects/:id` | Yes (owner only) | Delete a project owned by current user (`200`, `401`, `403`/`404`) |
| `GET` | `/api/cv` | Yes (owner) | List CV entries owned by the signed-in user |
| `POST` | `/api/cv` | Yes | Create a CV entry owned by `req.user.id` |
| `PUT` | `/api/cv/:id` | Yes (owner only) | Update a CV entry owned by current user |
| `DELETE` | `/api/cv/:id` | Yes (owner only) | Delete a CV entry owned by current user |

---

## Security Tests

Run `npm test` for frontend, configuration, and authentication checks. PostgreSQL integration tests are skipped when `TEST_DATABASE_URL` is absent.

Set `TEST_DATABASE_URL` to a separate disposable PostgreSQL database whose name ends in `_test`, and set `TEST_DATABASE_SSL=false` for local PostgreSQL. Run `npm run test:integration` for registration, password login, token rotation, logout, and simulated provider sign-in. The tests refuse an existing `portfolio` schema. See [test setup](docs/remote_database_setup.md#testing).

Run `npm run test:e2e` for browser tests. Setting `TEST_DATABASE_URL` also enables the browser sign-in, reload, and logout test.

---

## Known Limitations

* File uploads stored locally on disk may not persist across ephemeral container restarts unless backed by external object storage.
* Rate limiting, CSRF tokens, and automated CI/deployment are not yet enabled in the baseline build (planned for future hardening).

---

## Contributions, AI Tools & Credits

* **Team & Contributions:**
    * **Pedro (`@Pedro-p21`)
    * **Miguel Ribeiro (`@MiguelRibeiro1210`):
    *
* **AI Tools Used:** Used Figma Agent to create a good looking website design.
* **Course & External References:** Adapted patterns from course lab exercises (Express + SQLite session & ownership conventions); `.env`, `node_modules`, and SQLite database files are excluded via `.gitignore`.

## Google and GitHub Sign-In

Configure Google as a web OAuth client and GitHub as an OAuth App. Use the same origin in your browser, `.env`, and the provider callback URLs. For development at `http://localhost:3000`, register these callbacks:

| Provider | Callback URL |
| --- | --- |
| Google | `http://localhost:3000/api/oauth/google/callback` |
| GitHub | `http://localhost:3000/api/oauth/github/callback` |

Add the credentials for each provider you want to enable to your local `.env`:

```dotenv
OAUTH_ORIGIN=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

Restart the app and use **Continue with Google** or **Continue with GitHub** on the sign-in page. New accounts require a verified provider email. If that email is already registered, sign in to the existing account, open **Access & security** in the studio, and connect the provider there. On production, set `OAUTH_ORIGIN` to the HTTPS origin and register its callback URLs with both providers.

Run the integration test with `node --test tests/oauth.test.js`. It uses simulated provider responses and exercises the real Express and PostgreSQL flow.
