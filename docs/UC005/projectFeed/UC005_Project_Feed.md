# UC005 — Create a Project Feed

## 1. Requirements Engineering

### 1.1. User story

As a visitor or signed-in user, I want to scroll through projects shared by different users, see their authors and media, and read their comments, so I can discover their work. As a signed-in user, I also want to like projects and add comments.

The **feed backend is implemented**; the React frontend and feed-first navigation remain planned. The backend can be exercised through the API without changing the current website entry screen. [UC001](../../UC001/login/UC001_Login.md) supplies authentication and [UC002](../../UC002/createProject/UC002_Create_Project.md) supplies project creation and gallery uploads. The current frontend has no React feed. Existing owner-only APIs and the separately implemented public showroom/profile endpoints remain unchanged.

A **Feed Post** is a durable record associated with one project. It is created automatically when that project is first published. A **ProjectPost** is a React component created when fetched post data is rendered. Scrolling creates additional components, not additional database posts.

### 1.2. Acceptance criteria

- **AC1:** Entering the website opens the public feed for visitors and signed-in users. Sign-in, the owner's collection, and the existing studio remain reachable through navigation.
- **AC2:** Each published project has exactly one feed post associated with its owning account. Drafts never appear. Existing published projects receive one post through an idempotent backfill.
- **AC3:** Each card displays the author's name, project title, description, tech stack, cover media, like count, comment count, and comment section. The cover is the first gallery image by media order, or the first video if there is no image. This media is reused without another upload. No author avatar is introduced.
- **AC4:** The first request fetches ten posts. Approaching the bottom fetches the next batch. Only fetched posts become React cards; the browser never requests the whole project collection to build the feed.
- **AC5:** Posts appear newest first with a stable ID tie-breaker. Previously loaded cards are not duplicated. At the end of the published projects, loading stops and an end-of-feed message appears. An empty database produces an empty-feed presentation.
- **AC6:** Anyone can read the feed, cover media, and paginated comments. Only signed-in users with active sessions can like/unlike or submit a comment. Visitors receive a sign-in action for those interactions.
- **AC7:** Each user has at most one like per post. Repeating like/unlike requests is safe. Successful interactions return authoritative counts; failed interactions do not pretend to be saved.
- **AC8:** Comments are attributed to the authenticated account, contain 1–1,000 trimmed characters, and are rendered as plain text. Comments load only when their section opens, in batches of twenty.
- **AC9:** Loading, empty, exhausted, and failed states are distinct. Failed page loads preserve loaded cards and offer retry. Failed comment submissions retain input. Missing media shows a placeholder without removing the card.
- **AC10:** Desktop/mobile scrolling, keyboard navigation, accessible Load more controls, route cleanup, and existing authentication/project flows remain usable.

### 1.3. Inputs and outputs

The following backend endpoints are implemented. Public GET requests may omit authentication. With a bearer token, verify it and its active session before returning viewer-specific state. An invalid supplied token returns `401`; the client may refresh once, then repeat public reads without credentials if the session has ended. Public reads must work without waiting for successful authentication.

| Endpoint | Input / authentication | Success output |
|:---|:---|:---|
| `GET /api/feed` | Optional bearer token; optional `cursor` and `limit` | `200` with `posts` and nullable `nextCursor`. Default limit 10; integers 1–50 accepted. |
| `GET /api/feed/posts/:postId/media` | Public | `200` with the selected cover image/video bytes. Serve video range requests with normal `206` support. |
| `GET /api/feed/posts/:postId/comments` | Public; optional `cursor` | `200` with `comments` and nullable `nextCursor`, at most 20 comments. |
| `PUT /api/feed/posts/:postId/like` | Active bearer session; no request body | `200` with `likeCount` and `viewerHasLiked: true`. Repeated requests do not add duplicate likes. |
| `DELETE /api/feed/posts/:postId/like` | Active bearer session | `200` with `likeCount` and `viewerHasLiked: false`, including when no like existed. |
| `POST /api/feed/posts/:postId/comments` | Active bearer session; JSON `{ "text": "Useful project!" }` | `201` with the saved `comment` and authoritative `commentCount`. |

Example feed response:

```json
{
  "posts": [
    {
      "id": "7e2c1532-8a41-4cab-b387-f9da455b7b01",
      "createdAt": "2026-11-23T09:00:00.000Z",
      "author": { "id": 12, "name": "Alex Rivera" },
      "project": {
        "id": "32f1dbd1-dbb1-4d7a-a746-78d8f41c58ab",
        "title": "Focus Timer",
        "type": "open",
        "description": "A timer for focused work sessions.",
        "stack": "JavaScript, PostgreSQL"
      },
      "cover": {
        "url": "/api/feed/posts/7e2c1532-8a41-4cab-b387-f9da455b7b01/media",
        "type": "image/png",
        "name": "timer.png"
      },
      "likeCount": 3,
      "commentCount": 1,
      "viewerHasLiked": false
    }
  ],
  "nextCursor": null
}
```

The public author contains account ID and display name only. Use the existing account name; a saved profile is not required. The project summary is an explicit allowlist of ID, title, showcase type, description, and tech stack. Do not return account email, password/session data, internal storage paths, build identifiers, or the entire owner-facing project object. Feed cards do not link to the existing owner-only detail route in this milestone; public project-detail pages are separate work.

Cursors are scoped to feed pages or the specific comment post; reusing a cursor in a different scope returns `400`. Comments accept at most 16 KiB of JSON (`413` above the transport limit).

A comment response item contains `id`, `postId`, `author: { id, name }`, `text`, and `createdAt`. Comments are flat, ordered oldest first. Like state is `false` for visitors. Feed responses are not stored in shared caches when they can contain viewer-specific data; use `Cache-Control: no-store` for feed, comments, and interaction responses.

| Failure | Response / frontend handling |
|:---|:---|
| Invalid cursor, limit, comment JSON, or comment text | `400` with a clear JSON `message`. Preserve comment input. |
| Missing/expired session on a mutation, or invalid supplied token on a read | `401`. Refresh once where possible; otherwise offer sign-in. |
| Invalid/missing post ID, draft, or no longer published project | `404` on post-specific operations, without exposing private metadata. |
| Cover metadata exists but stored file is unavailable | `404`; render a media placeholder. |
| Unexpected database/storage error | Generic `500`; retain content and offer a retry. |

### 1.4. Dependencies and decisions

- Reuse UC001 session verification for writes and optional viewer identity on feed reads. Never accept the acting user's ID or post author from the browser.
- Reuse UC002's `published` flag. Both `open` and `private` showcase types can appear when published; `private` means closed-source, not an unpublished draft.
- A published project's feed post is created in the same PostgreSQL transaction as the project. A creation failure cannot leave only one record committed. Draft creation does not create a post. The existing project update transaction creates the post on first publication. Unpublishing hides the existing post and its interactions without deleting them; republishing preserves its ID/time. Deleting the project cascades to its post, likes, and comments.
- Keep a unique project reference on each post. Backfill existing published projects using their project creation time, preserving their ordering and using conflict-safe inserts. Do not backfill drafts. Do not create posts during GET requests.
- Reuse gallery files and their ordering. If the chosen cover file is missing, the media API returns `404`; the planned frontend will show a placeholder rather than silently selecting different media. If no media metadata exists in a legacy project, its summary has `cover: null`. Build files never qualify as cover media.
- Existing project/detail/file APIs remain owner-only. Introduce a separate public cover route that checks publication and post association on every request, including range requests. Existing build permissions and download endpoints are unchanged; feed visibility grants no build access.
- Likes and comments are durable. Notifications, ranking, follows, search, threaded replies, comment editing/deletion, moderation tools, public project-detail/profile pages, avatars, and frontend-wide React migration are outside this milestone.

## 2. Analysis and Design

### 2.1. Main flows

**Post creation:** the owner creates a project through UC002. After validation and file storage, the database transaction inserts the project and its associations. When `published` is true, it also inserts the unique feed post. Commit all records together. The author is derived from the associated project's owner, and the cover from its ordered gallery. Existing published projects follow the same one-post constraint during migration backfill.

**Feed browsing:** entering `#/feed` requests the first ten public post summaries. Render their React cards and observe a sentinel after the list. As the sentinel approaches the viewport, request the next cursor, append previously unseen post IDs, and render the new cards. When `nextCursor` is null, stop observing and show the end state. Reading the feed never requires the owner-only workspace collection.

**Likes:** a signed-in user selects Like or Unlike. Disable that post's control while its idempotent request is pending. After the server verifies publication and session, insert or delete the current account's like and return the resulting count/state. Update the card only on success. A visitor sees a sign-in action instead.

**Comments:** opening a comment section requests its first twenty comments. Read more comments through a separate cursor. A signed-in user submits text; the server validates it, derives the author, saves the comment, and returns the saved item and updated count. Clear input only after success. Do not automatically retry a comment POST after an ambiguous network failure; a missing response does not prove that no comment was saved.

### 2.2. Domain and persistence

The [updated domain model](../../global_artifacts/domain-model.puml) adds feed entities while preserving account/project ownership and optional notes/builds.

| Concept | Planned persistence / invariant |
|:---|:---|
| Feed Post | `portfolio.feed_posts`: UUID ID, unique non-null project foreign key, and creation timestamp. Its author is derived through project ownership, avoiding a second independently editable owner ID. |
| Post Like | `portfolio.post_likes`: post reference, user reference, and creation timestamp; composite primary key `(post_id, user_id)`. |
| Post Comment | `portfolio.post_comments`: UUID ID, post/user references, text, and creation timestamp. Validate length on the server and with a database constraint. |
| Media Item | Existing `portfolio.project_files` rows with `kind = 'media'`, represented explicitly in the model with ID, name, media type, size, and position. Post cover is a derived reference, not a copied file or new upload. |

Migration `007_create_feed_tables.sql` creates these tables, indexes, and the idempotent backfill. Numbers 004–006 are already used by profiles, project revisions, and public showrooms. Grant the runtime role only the required actions: read/insert posts, read/insert/delete likes, and read/insert comments. Preserve account IDs, project IDs, existing files, and authentication data. The migration also grants revision-column UPDATE privilege for project row locks that serialize feed interactions with unpublishing/deletion. Apply pending migrations before deploying the backend.

Use a descending index on feed-post `(created_at, id)`, and ascending comment `(post_id, created_at, id)`. Add indexes supporting counts for each returned post. Aggregate counts for the requested page only, without joining raw likes and comments into a multiplying row set. Use parameterized queries.

Feed pagination uses keyset comparison `(created_at, id) < (cursorTime, cursorId)` with descending ordering; comments use `>` with ascending ordering. Fetch one extra row to determine whether a next page exists. Encode the boundary pair in an opaque base64url cursor, validate both fields, and preserve database timestamp precision when generating it. Cursor contents identify a boundary, not an authorization grant. Publication is always checked in the query. Newly published posts appear on refresh at the top; no live insertion or offset pagination is planned.

### 2.3. Components and implementation status

Backend modules below are implemented. React components and the end-to-end frontend flows remain planned.

| Component | Responsibility |
|:---|:---|
| `src/routes/feed.routes.js`, existing `src/server.js` | Mount public read and authenticated interaction routes under `/api/feed`; validate transport, status codes, and media responses. |
| `src/services/feedService.js` | Enforce published eligibility, derive public projections/cover selection, and coordinate pagination and interactions. |
| `src/domain/feedRules.js` | Validate cursors, limits, IDs, and comment text. |
| Existing `src/middleware/requireAuth.js`; `src/middleware/optionalAuth.js` | Share token/session verification. Permit absent credentials on public reads; reject invalid supplied credentials. |
| `src/db/database.js`, `src/db/feedDatabase.js` | Add post creation to project create/update transactions; implement precise paginated reads, publication-safe row locks, unique like writes, comments, and page-scoped counts. |
| Existing `src/services/fileStorageService.js` | Resolve an already authorized cover reference to a file. Never use a user-supplied path. |
| `src/db/migrations/007_create_feed_tables.sql` | Add feed persistence, grants, indexes, and backfill. |
| Planned React feed and API adapter | Mount the public screen, request batches, manage card interactions, and clean up on navigation. See the [frontend plan](UC005_Frontend_Plan.md). |

### 2.4. Diagrams

UC005 diagrams describe the end-to-end target, including the still-planned React frontend. Backend endpoints are now implemented; participant filenames remain the integration boundaries. Backend participants use existing or proposed file paths.

| Diagram | PlantUML source | Rendered preview |
|:---|:---|:---|
| Automatic feed-post creation | [Creation sequence](../uml/UC005_Post_Creation_Sequence.puml) | [SVG](UC005_Post_Creation_Sequence.svg) |
| Infinite scrolling and incremental card creation | [Scroll sequence](../uml/UC005_Feed_Scroll_Sequence.puml) | [SVG](UC005_Feed_Scroll_Sequence.svg) |
| Like and unlike | [Like sequence](../uml/UC005_Like_Sequence.puml) | [SVG](UC005_Like_Sequence.svg) |
| Comment loading and submission | [Comment sequence](../uml/UC005_Comment_Sequence.puml) | [SVG](UC005_Comment_Sequence.svg) |
| React components and integration boundaries | [Frontend components](../uml/UC005_Frontend_Components.puml) | [SVG](UC005_Frontend_Components.svg) |
| Global domain model including feed entities | [Domain model](../../global_artifacts/domain-model.puml) | [SVG](../../global_artifacts/domain_model.svg) |

## 3. Test Plan

1. Create published projects and drafts through UC002. Verify one post per published project, none per draft, atomic rollback on failure, and no post creation during browsing. Backfill existing published projects twice and verify no duplicates or changed project/file records.
2. Request the public feed without a session and with an active session. Verify the public allowlist, correct author association, counts, and viewer like state. Check invalid/expired supplied tokens and subsequent anonymous read recovery.
3. Request consecutive pages with equal timestamps and different IDs; verify ordering, no duplicates, limit bounds, invalid-cursor rejection, and a null cursor at the end. Test 0, 1, 10, 11, and many posts. Insert a newer post between requests and verify it appears after refreshing, without disrupting existing page boundaries.
4. Select covers from mixed ordered galleries and video-only galleries. Verify first-image preference, video range playback, missing-file placeholders, and rejection of draft media, build files, arbitrary file IDs/paths, and unpublished posts. Verify that a published closed-source project does not expose its build.
5. Submit concurrent/repeated likes and unlikes. Verify one like per account/post, correct persisted state, no impersonation, active-session enforcement, and independent likes from different accounts.
6. Load comments only after opening their section. Verify oldest-first pagination, server-derived authors, trim/length/type validation, malformed JSON, plain-text rendering, persisted counts, and rejection of comments on unavailable posts. Fail a submission and verify input remains; do not silently auto-retry an ambiguous POST.
7. In desktop/mobile browser tests, verify feed-first entry, preserved sign-in/collection/studio navigation, one initial batch, incremental requests, stable card keys, and prevention of concurrent next-page loads. Assert that owner-only collection loading is not used to populate the feed.
8. Verify retry preserves earlier cards, empty and exhausted states differ, comments/media are lazy, video does not autoplay, and the keyboard Load more action works. Leave the route during a request and ensure aborted/stale results cannot update the next screen.
9. Build the planned React bundle before browser tests, and rerun UC001/UC002 regression suites against an isolated test database and upload directory. For documentation updates, validate links, PlantUML syntax, SVG rendering, and cross-document consistency.

## 4. Implementation Order

1. Add the feed schema, indexes, runtime grants, and idempotent published-project backfill; extend UC002's transaction to insert the unique post. Test atomicity before public exposure.
2. Add public feed/comment reads and the publication-checked cover endpoint. Add optional viewer authentication, explicit public projections, and cursor validation.
3. Add authenticated idempotent like/unlike and comment creation; verify ownership attribution and unavailable-post behavior.
4. Add React/Vite for the feed only and integrate its mount/unmount lifecycle with the existing shell. Update navigation and entry routing without migrating existing screens.
5. Implement incremental fetching, lazy media/comments, interaction feedback, and accessibility using the [frontend plan](UC005_Frontend_Plan.md).
6. Add bundle checks to CI and run endpoint, migration, persistence, desktop/mobile, and existing authentication/project regressions. Apply the future migration before enabling the new feed landing page.
