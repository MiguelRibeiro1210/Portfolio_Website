# Portfolio_website

![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-Express%20API-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-Relational%20DB-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Sessions](https://img.shields.io/badge/Auth-express--session%20%2B%20bcrypt-informational?style=for-the-badge)

A full-stack web platform for developers and students to manage private portfolio projects, downloadable builds, and structured CV entries with strict per-user ownership and session-based security.

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
- **Database:** SQLite with foreign keys enabled and parameterized queries (`?` placeholders) across all SQL statements.

```text
Browser (HTML/CSS/JS + fetch + textContent)
        │
        ▼  HTTP / JSON + Session Cookie (httpOnly, sameSite)
Express REST API (routes, requireAuth, ownership checks)
        │
        ▼  Parameterized SQL (? placeholders)
SQLite Database (users, projects, cv_entries)
```
## Database Schema


---

## Getting Started (Codespaces & Local Setup)

Install dependencies and configure the app from the project root:

1. **Install dependencies:**
   Run `npm install` in the project root.

2. **Create `.env` from `.env.example`:**
   Run `cp .env.example .env` and set `SESSION_SECRET` to a random string of **at least 32 characters** (never commit `.env` to Git).

3. **Start the server.** Run `npm start`. The server entry point is currently empty, so this command exits until the server is implemented.

---

## REST API Endpoints

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

The files in `tests/` are currently empty. The planned checks are:

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
* **Course & External References:** Adapted patterns from course lab exercises (Express + SQLite session & ownership conventions); `.env`, `node_modules`, and SQLite database files are excluded via `.gitignore`.
