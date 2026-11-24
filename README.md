# Portfolio_website

![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-Express%20API-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Passwords](https://img.shields.io/badge/Passwords-bcrypt-informational?style=for-the-badge)

A full-stack web platform for developers and students to manage private portfolio projects, downloadable builds, and structured CV entries with strict per-user ownership and session-based security.

**Current implementation:** registration, password login, and application sessions use PostgreSQL. Google and GitHub sign-in are available when configured. Project creation and owner-scoped reads persist in PostgreSQL, with media and an optional build stored on disk. The studio and collection load saved projects after sign-in and reload. Owners can edit or delete saved projects, with revision checks to protect changes from stale editor tabs. The Profile & CV editor saves to PostgreSQL and Supabase Storage, and the public page displays those changes. Default download preferences remain temporary previews. See [Remote database setup](docs/remote_database_setup.md) for the database configuration.

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

Authentication, project creation, and owner-scoped project/file reads are implemented. Project update/delete and persistent profile/CV management remain future work.

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
Supabase PostgreSQL (accounts, sessions, projects, notes, file metadata)
Server file storage (project media and builds, outside public/)
```
## Database Schema

The initial migration is [`001_create_users.sql`](src/db/migrations/001_create_users.sql). It creates `portfolio.users` with a generated integer ID, name, unique normalized email, bcrypt password hash, and `TIMESTAMPTZ` creation time. [`002_create_auth_tables.sql`](src/db/migrations/002_create_auth_tables.sql) adds sign-in sessions and provider identities. Existing PostgreSQL accounts keep their IDs and password hashes. [`003_create_projects.sql`](src/db/migrations/003_create_projects.sql) adds `projects`, `project_notes`, and `project_files`, including owner foreign keys, ordered media, and a unique optional build per project. [`005_add_project_revision.sql`](src/db/migrations/005_add_project_revision.sql) adds revision numbers to existing projects.

---

## Getting Started (Codespaces & Local Setup)

Install dependencies and configure the app from the project root:

1. **Install dependencies:**
   Run `npm install` in the project root.

2. **Configure `.env`:**
   Copy `.env.example` only if you do not already have `.env`; otherwise add the documented database settings to the existing file. Set `DATABASE_URL` to the Supabase **Session pooler** PostgreSQL connection string, with your database password URL-encoded. Keep TLS enabled. Supabase publishable keys do not replace a database connection string. Never commit `.env`.

3. **Apply pending migrations.** Run `npm run db:migrate` with a schema-owner connection. The runner verifies and records an existing compatible `001` schema before applying the remaining migrations. See [setup and restricted runtime credentials](docs/remote_database_setup.md).

4. **Start the server:** Run `npm start` and open `http://localhost:3000`. Startup checks the database and application tables before listening. Set `PORT` to change the port. Set a random `JWT_SECRET` of at least 32 bytes in production.

---

## REST API Endpoints

Authentication, project CRUD, public showrooms, profiles/CVs, and the UC005 feed backend are implemented. The React feed frontend remains planned.

| Method | Path | Auth / Ownership | Purpose |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/register` | No | Register a new user (`201`, `400`, `409`) |
| `POST` | `/api/login` | No | Verify credentials and issue an access token and refresh cookie (`200`, `400`, `401`) |
| `GET` | `/api/me` | Bearer token | Get the signed-in account (`200`, `401`) |
| `POST` | `/api/refresh` | Refresh cookie | Rotate the refresh token and issue an access token (`200`, `401`) |
| `POST` | `/api/logout` | Refresh cookie when present | Revoke the session and clear the cookie (`204`) |
| `GET` | `/api/projects` | Yes (owner) | List projects owned by the signed-in user (`WHERE owner_id = $1`) |
| `POST` | `/api/projects` | Yes | Create a project via multipart upload, owned by `req.user.id` (`201`, `400`, `401`, `413`, `415`) |
| `GET` | `/api/projects/:id` | Yes (owner only) | Get an owned project and its revision `ETag` (`200`, `401`, `404`) |
| `GET` | `/api/projects/files/:id` | Yes (owner only) | Download an owned media/build file (`200`, `401`, `404`) |
| `PUT` | `/api/projects/:id` | Yes (owner only) | Save an owned project with multipart data and `If-Match` (`200`, `412`, `428`) |
| `DELETE` | `/api/projects/:id` | Yes (owner only) | Delete an owned project with `If-Match` (`204`, `412`, `428`) |
| `GET` | `/api/profile/me` | Bearer token | Load the owner's profile and attachment metadata |
| `PUT` | `/api/profile/me` | Bearer token | Save fields and optionally replace or remove the PDF in one multipart request |
| `GET` | `/api/profile/me/cv` | Bearer token | Load the owner's PDF |
| `GET` | `/api/profiles/:publicId` | Public | View the saved profile |
| `GET` | `/api/profiles/:publicId/cv` | Public | Preview the PDF or download it with `?download=1` |
| `GET` | `/api/feed?cursor=…&limit=10` | Public; optional bearer token | Cursor-paginated published post summaries and viewer like state |
| `GET` | `/api/feed/posts/:postId/media` | Public | Published cover media, including video range requests |
| `GET` | `/api/feed/posts/:postId/comments?cursor=…` | Public | Read up to 20 comments, oldest first |
| `PUT` / `DELETE` | `/api/feed/posts/:postId/like` | Bearer token | Idempotently like/unlike as the signed-in account |
| `POST` | `/api/feed/posts/:postId/comments` | Bearer token | Create a plain-text comment with JSON `{ "text": "…" }` |

---

## Creating a Project (UC002)

Sign in, open **Add project**, enter the title, description, tech stack, and showcase type, and select 1–10 gallery files. Notes and one build are optional. **Show in the collection** is selected initially; clear it to save a draft visible only in your studio. Select **Save changes** to persist the project. See the [UC002 contract and workflow](docs/UC002/createProject/UC002_Create_Project.md).

`POST /api/projects` accepts `multipart/form-data` with one JSON `project` text part, repeated `media` file parts, and at most one `build` file part. Include `Authorization: Bearer <accessToken>`. A successful response contains `{ "project": { ... } }`, with a server-generated ID, `ownerId`, ordered media metadata, and nullable `notes` and `build` objects. The client refreshes an expired access token using the existing session cookie.

To edit a project, open it from the studio, make changes, and click **Save changes**. The editor loads and sends back the revision automatically. To remove a project, click **Delete project** and confirm. Existing deployments need `npm run db:migrate` before starting this version. See the [UC003 plan](docs/UC003/UC003_Edit_Project.md) for update fields and sequences.

Text limits are 200 characters for title, 5,000 for description, 1,000 for tech stack, 10,000 each for idea/release notes, 2,000 for compatibility, and 2,048 for the optional HTTP(S) repository URL. Gallery files allow PNG/JPEG/WebP/GIF/MP4/WebM up to 20 MiB each. The optional build allows ZIP/EXE/APK/DMG/DEB/AppImage/MSI/TAR/GZ up to 100 MiB. Combined uploaded file bytes are limited to 300 MiB, including chunked uploads. The server checks file signatures, fields, and ownership before accepting a project.

Set `PROJECT_UPLOAD_DIR` to a persistent, writable server directory; the default is `src/uploads/projects/`. Files are served only through authenticated owner-scoped API requests. Keep this directory on persistent disk and back it up together with PostgreSQL. File bytes are not stored in Supabase Storage or PostgreSQL. All visitor download settings are retained, but visitor/public download and approval workflows are not implemented; owners can download their own builds regardless of that setting.

---

## Project Feed Backend (UC005)

Run `npm run db:migrate` before restarting this backend. Migration `007_create_feed_tables.sql` adds posts, likes, and comments, and backfills existing published projects without changing their project IDs or media. Creating or first publishing a project creates its unique post in the same transaction. Unpublishing hides the post and its public media/interactions; republishing preserves its original post ID and time. Project deletion cascades to the post, likes, and comments.

`GET /api/feed` returns `{ posts, nextCursor }`, with ten posts by default (maximum 50), newest first. Follow the opaque cursor for subsequent pages. Each summary contains an author ID/name, selected public project fields, a cover URL, counts, and `viewerHasLiked`. Sending no bearer token supports anonymous browsing; sending an invalid or revoked token returns `401`. No feed read creates posts or loads the complete owner workspace.

Covers reuse the first gallery image, or the first video if no image exists. Feed media endpoints never serve builds. Like/unlike requires an active session and returns `{ likeCount, viewerHasLiked }`. Comments require JSON with only `text` (1–1,000 trimmed Unicode characters); the server derives the author. Comments are paginated separately in batches of 20. Feed responses use `Cache-Control: no-store`.

See the [UC005 API and design](docs/UC005/projectFeed/UC005_Project_Feed.md) and [future React frontend plan](docs/UC005/projectFeed/UC005_Frontend_Plan.md). This implementation changes no frontend routes, installs no React dependencies, and does not enable a feed landing page yet.

---

## Security Tests

Run `npm test` for frontend, configuration, and authentication checks. PostgreSQL integration tests are skipped when `TEST_DATABASE_URL` is absent.

Set `TEST_DATABASE_URL` to a separate disposable PostgreSQL database whose name ends in `_test`, and set `TEST_DATABASE_SSL=false` for local PostgreSQL. Run `npm run test:integration` for registration, password login, token rotation, logout, simulated provider sign-in, project/profile persistence, and feed pagination/interactions. The tests refuse an existing `portfolio` schema. See [test setup](docs/remote_database_setup.md#testing).

Run `npm run test:e2e` for browser tests. Setting `TEST_DATABASE_URL` also enables the browser sign-in, reload, and logout test.

---

## Continuous Integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to any branch or tag, pull requests, and manual dispatch. Each run installs dependencies with `npm ci`, starts a disposable PostgreSQL 17 service, installs Chromium, and executes [`scripts/ci.sh`](scripts/ci.sh) on Node.js 24.

The script checks JavaScript syntax and runs unit, PostgreSQL integration, and desktop/mobile browser tests. This project executes JavaScript directly, so there is no separate transpilation or bundle build. Integration tests apply their own initial migration; CI does not need Supabase credentials. Browser reports and failure traces are retained as workflow artifacts for seven days.

To run the same checks locally, first install dependencies and Chromium (`npm ci --include=dev` and `npx playwright install chromium`), then provide a separate disposable PostgreSQL database ending in `_test`:

```bash
TEST_DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/portfolio_test \
TEST_DATABASE_SSL=false bash scripts/ci.sh
```

The script requires the test database URL so integration tests cannot silently skip, and ignores local application database credentials. GitHub runs the workflow after commits are pushed; unpushed local commits cannot trigger Actions.

## Known Limitations

* File uploads stored locally on disk may not persist across ephemeral container restarts unless backed by external object storage.
* Rate limiting, CSRF tokens, and automated deployment are not yet enabled in the baseline build (planned for future hardening).

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

## Public Showroom API

Apply [migration 006](src/db/migrations/006_add_public_showrooms.sql) to assign every account a stable showroom ID. This ID is independent of the account's optional public CV profile.

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /api/projects/showroom` | Signed-in owner | Return the owner's showroom ID. |
| `GET /api/showrooms/:showroomId/projects` | Public | List published projects and return the linked public CV profile ID when available. |
| `GET /api/showrooms/:showroomId/projects/:projectId` | Public | Return the published project and its media metadata. |
| `GET /api/showrooms/:showroomId/projects/:projectId/files/:fileId` | Public | Serve gallery media inline and eligible build files as downloads. |

After signing in, use **View public showroom** in your collection's footer to open the shareable page. Visitors can follow that link or a project's overview URL without signing in.

Public reads work for signed-out and signed-in visitors. Drafts and unlisted files return `404`. A build set to `request` or `none` exposes only its permission in the public project response. The public file endpoint returns `404` for those builds. Owners can still use their authenticated file route. Closed-source projects omit the source repository URL from public responses.

## CV Builder Setup

Apply PostgreSQL migration [004_create_profiles.sql](src/db/migrations/004_create_profiles.sql) with `npm run db:migrate`. To enable PDF uploads, create a private `cv-files` bucket in Supabase Storage, restrict it to `application/pdf`, and set its upload limit to 10 MiB. Set `SUPABASE_URL` and `SUPABASE_STORAGE_KEY` in the server's `.env`. Use a server-side Supabase secret key or legacy service role key for storage access.

Sign in and open **Studio → Profile & CV**. **Save profile** saves the fields and the optional file in one request. **View public profile** opens the shareable visitor page. Visitors can see saved fields and preview or download the current CV without signing in. See the [UC004 plan](docs/UC004/UC004_CV_Builder.md).
