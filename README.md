# Portfolio_website

![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-Express%20API-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Passwords](https://img.shields.io/badge/Passwords-bcrypt-informational?style=for-the-badge)

A full-stack web platform for developers and students to manage private portfolio projects, downloadable builds, and structured CV entries with strict per-user ownership and session-based security.

**Current implementation:** the frontend is a temporary in-memory preview. The backend implements `POST /api/register`, with bcrypt password hashing and PostgreSQL persistence on Supabase. Login, access/refresh tokens, project/CV APIs, and durable uploads are planned. Supabase Auth is not used. See [Remote database setup](docs/remote_database_setup.md) for the database configuration.

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

The following describes the target platform; only registration and the frontend preview are currently implemented.

- **Authentication & Session Security:** Account registration with server-side validation (`409` on duplicate email), password hashing with `bcrypt` (cost ≥ 10), generic error responses on failed login (`401`), and `express-session` (`httpOnly`, `sameSite`) with session regeneration on login and destruction on logout.
- **Per-User Ownership & Authorization:** `requireAuth` middleware protects private endpoints (`401` when unauthenticated), and every read, update, and delete filters by the authenticated session user (`WHERE owner_id = ?`), returning `403` or `404` when attempting to access another user's record.
- **Double Token Security:** Combines a short-lived authentication (access) token for API requests with a longer-lived refresh token to renew sessions safely without requiring frequent re-authentication.
- **Project Management (CRUD):** Create, view, update, and delete projects (open-source links, private/closed-source build downloads, media previews, and technical specs).
- **CV & Profile Management:** Manage structured CV sections (summary, experience, education, skills) and profile details tied to the authenticated user.
- **Safe Browser Client:** Frontend calls the backend via `fetch()`, displays server status messages clearly, and renders user-supplied text using `textContent` rather than `innerHTML`.

---

## Tech Stack & Architecture

- **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+), served from the same Node.js/Express application.
- **Backend:** Node.js + Express REST API, `express-session`, `bcrypt`, `dotenv` (plus `multer` where file uploads are used).
- **Database:** Supabase PostgreSQL through the server-only `pg` driver, with parameterized queries (`$1`, `$2`, …), a pool of at most five connections, and verified TLS. Schema changes are explicit migrations, not startup side effects.

```text
Browser (HTML/CSS/JS + fetch + textContent)
        │
        ▼  HTTP / JSON + Session Cookie (httpOnly, sameSite)
Express REST API (routes, requireAuth, ownership checks)
        │
        ▼  Parameterized SQL ($1, $2, …)
Supabase PostgreSQL (portfolio.users; other tables planned)
```
## Database Schema

The initial migration is [`001_create_users.sql`](src/db/migrations/001_create_users.sql). It creates `portfolio.users` with a generated integer ID, name, unique normalized email, bcrypt password hash, and `TIMESTAMPTZ` creation time. The old local SQLite file is not imported or deleted.

---

## Getting Started (Codespaces & Local Setup)

Install dependencies and configure the app from the project root:

1. **Install dependencies:**
   Run `npm install` in the project root.

2. **Configure `.env`:**
   Copy `.env.example` only if you do not already have `.env`; otherwise add the documented database settings to the existing file. Set `DATABASE_URL` to the Supabase **Session pooler** PostgreSQL connection string, with your database password URL-encoded. Keep TLS enabled. Supabase publishable keys do not replace a database connection string. Never commit `.env`.

3. **Create the schema once:** Run `npm run db:migrate`, or run the committed migration in the Supabase SQL Editor. It intentionally refuses an existing `portfolio` schema; inspect existing data instead of dropping it. See [setup and restricted runtime credentials](docs/remote_database_setup.md).

4. **Start the server:** Run `npm start` and open `http://localhost:3000`. Startup verifies the database connection and table before listening. Set `PORT` to change the port.

---

## REST API Endpoints

Only `/api/register` is connected in this milestone. The remaining endpoints below are planned contracts.

| Method | Path | Auth / Ownership | Purpose |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/register` | No | Register a new user (`201`, `400`, `409`) |
| `POST` | `/api/login` | No | Authenticate user and regenerate session (`200`, `400`, `401`) |
| `POST` | `/api/logout` | Yes | Destroy active session and clear cookie (`200`, `401`) |
| `GET` | `/api/projects` | Yes (owner) | List projects owned by the signed-in user (`WHERE owner_id = ?`) |
| `POST` | `/api/projects` | Yes | Create a new project owned by `req.session.userId` (`201`, `400`, `401`) |
| `GET` | `/api/projects/:id` | Yes (owner only) | Get a specific project if owned by current user (`200`, `401`, `403`/`404`) |
| `PUT` | `/api/projects/:id` | Yes (owner only) | Update a project owned by current user (`200`, `400`, `401`, `403`/`404`) |
| `DELETE` | `/api/projects/:id` | Yes (owner only) | Delete a project owned by current user (`200`, `401`, `403`/`404`) |
| `GET` | `/api/cv` | Yes (owner) | List CV entries owned by the signed-in user |
| `POST` | `/api/cv` | Yes | Create a CV entry owned by `req.session.userId` |
| `PUT` | `/api/cv/:id` | Yes (owner only) | Update a CV entry owned by current user |
| `DELETE` | `/api/cv/:id` | Yes (owner only) | Delete a CV entry owned by current user |

---

## Security Tests

Run `npm test` for frontend checks, configuration/startup checks, and registration integration tests. The PostgreSQL integration test is explicitly skipped when `TEST_DATABASE_URL` is absent.

To exercise real persistence, set `TEST_DATABASE_URL` to a **separate disposable PostgreSQL database whose name ends in `_test`**, and run `npm run test:integration`. For local PostgreSQL, set `TEST_DATABASE_SSL=false`. The test creates and removes only its own `portfolio` schema and refuses an existing schema. Do not point it at the application database. See [test setup](docs/remote_database_setup.md#testing).

Run `npm run test:e2e` for the existing desktop/mobile frontend preview tests. Their test-only server does not require database credentials and does not validate hosted persistence.

The login/ownership/logout placeholder files are still empty. Their planned checks are:

1. **Invalid login (`401` & uniform message):** Verifies unknown email and wrong password return `401` with the same non-revealing message.
2. **Cross-user isolation (`403`/`404`):** Verifies User B cannot read, edit, or delete User A's records even when supplying User A's record ID.
3. **Post-logout session invalidation:** Verifies an old session cookie is rejected (`401`) after `POST /api/logout`.

Once implemented, run the scripts from the project root with the app running as required by the tests:

* `node tests/01_invalid_login.js`
* `node tests/02_ownership.js`
* `node tests/03_session_logout.js`

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
* **Course & External References:** Adapted patterns from course lab exercises (Express registration and ownership conventions); `.env`, `node_modules`, and old SQLite database files are excluded via `.gitignore`.
