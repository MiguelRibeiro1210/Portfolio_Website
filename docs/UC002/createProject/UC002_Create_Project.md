# UC002 — Create a Project

## 1. Requirements Engineering

### 1.1. User story

As a signed-in user, I want to add a project from my portfolio page, fill in its details and optionally attach notes and a downloadable build, so my work is saved and displayed in my portfolio collection.

This milestone covers project creation, persistence in PostgreSQL, storage of selected files, and displaying the saved project on the owner's page. It follows the existing frontend workflow. Creation and authenticated owner reads are implemented. [UC003](../../UC003/UC003_Edit_Project.md) extends the saved-project studio with editing and deletion. Visitor access is separate work.

### 1.2. Acceptance criteria

- **AC1:** A signed-in user can select **Add project** on their page, or **Add your first project** in the empty state, to open a blank project studio at `#/studio`.
- **AC2:** The user supplies the project's title, showcase type, description, tech stack, and media gallery. Notes and a downloadable build are optional; creation succeeds with neither, either, or both.
- **AC3:** Selecting **Save changes** with valid data creates one project owned by the authenticated account. The server assigns its ID and returns `201 Created` only after persistence succeeds. The client cannot select another owner.
- **AC4:** All supplied project fields, optional notes, media order, and optional build with its download permission are retained. A project has at most one notes record and one build, as defined in the domain model.
- **AC5:** After a successful save, the project appears in the owner's studio list. With **Show in the collection** selected, it also appears on the owner's portfolio page and opens its saved project details. An unchecked project remains a draft in the studio.
- **AC6:** Reloading the page or restarting the server preserves the project, its associations, and its files. Loading one user's collection never returns another user's projects.
- **AC7:** Invalid input or unsupported files produce a clear error without creating a partial project. Missing or expired authentication returns `401`. A storage or database failure shows a failure message and does not report a successful save.
- **AC8:** While saving, the form prevents duplicate submissions. On a recoverable failure, entered values and selected files remain available for correction or retry. Cancelling before submission creates no project.

### 1.3. Inputs and outputs

**Endpoint** — `POST /api/projects`, authenticated with `Authorization: Bearer <accessToken>`. Use `multipart/form-data` to submit a JSON `project` part and the selected media/build files in one creation request. The browser supplies the multipart boundary.

The table maps the domain terms to the existing frontend field names. The JSON part uses those names; file parts use `media` and `build`. Gallery order follows the submitted media order.

| Domain field | Frontend / request field | Server validation |
|:---|:---|:---|
| Title | `title` | Required, non-empty string after trimming. |
| Showcase type | `type` | Required; `open` (open-source) or `private` (private / closed-source). |
| Description | `description` | Required, non-empty string after trimming. |
| Tech stack | `stack` | Required, non-empty string after trimming. |
| Media gallery | `media` file parts | Required; at least one image or video. Allow PNG, JPEG, WebP, GIF, MP4, or WebM, up to 20 MiB per file. Validate file content as well as declared type. |
| Notes: idea | `story` | Optional string. |
| Notes: compatibility | `compatibility` | Optional string. |
| Notes: source repository | `source` | Optional absolute HTTP or HTTPS URL. |
| Notes: release notes | `releaseNotes` | Optional string. |
| Downloadable build: build file | `build` file part | Optional; at most one file. Allow ZIP, EXE, APK, DMG, DEB, AppImage, MSI, TAR, or GZ, up to 100 MiB. Validate the upload server-side. |
| Downloadable build: download permissions | `permission` | Required when a build is supplied; `public` (all visitors), `request` (approved visitors only), or `none` (downloads disabled). Without a build, no build record is created. |
| Collection visibility | `published` | Required boolean representing **Show in the collection**. Select it for the create-and-display flow; `false` saves a draft. This is a presentation field in addition to the domain attributes. |

Trim surrounding whitespace from text fields. Omitted or blank notes fields are allowed individually; create no notes record when all four fields are empty. Neither showcase type requires a repository URL or a build. A `private` showcase type describes closed-source work; collection visibility is controlled separately by `published`.

Example JSON `project` part, submitted with at least one `media` file and no build:

```json
{
  "title": "Focus Timer",
  "type": "open",
  "description": "A desktop timer for focused work sessions.",
  "stack": "Java, JavaScript, PostgreSQL",
  "story": "",
  "compatibility": "",
  "source": "",
  "releaseNotes": "",
  "published": true
}
```

The `201 Created` response returns `{ "project": { ... } }` containing the server-assigned `id`, `ownerId`, accepted fields, ordered media metadata, and nullable `notes` and `build` objects. File metadata contains durable file identifiers rather than local browser object URLs. The client maps the saved result back to the editor and collection views.

| Result | HTTP response | User-visible outcome |
|:---|:---|:---|
| Project and files saved | `201 Created` | Show confirmation, open `#/studio/:id`, and make the published project available in the collection. |
| Invalid fields, malformed metadata, missing media, or multiple builds | `400 Bad Request` | Show validation feedback and keep the form available. |
| Missing, invalid, or expired session | `401 Unauthorized` | Request sign-in before another save attempt. |
| Upload exceeds configured limits | `413 Payload Too Large` | Explain the file limit. |
| Unsupported upload format | `415 Unsupported Media Type` | Explain which file was rejected. |
| Unexpected database or file-storage failure | Generic `500` response | Show a save failure without exposing internal details. |

### 1.4. Dependencies and decisions

- Reuse [UC001 authentication and active-session checks](../../UC001/login/UC001_Login.md). Resolve ownership from the verified session rather than submitted metadata.
- Follow the [domain model](../../global_artifacts/domain-model.puml): an account owns zero or more projects; each project contains zero or one notes record and zero or one downloadable build. A separate profile record is not a prerequisite for owning projects.
- The five core project attributes are required in the creation flow. Text limits are 200 characters for title, 5,000 for description, 1,000 for tech stack, 10,000 each for idea/release notes, 2,000 for compatibility, and 2,048 for the repository URL.
- The editor accepts one optional build and submits it as `build`. The API returns a nullable `build` object; the client maps it to the existing view's `builds` array.
- Preserve the existing visibility choice. The documented create-and-display path selects **Show in the collection**. Draft creation is also supported, without displaying the draft in the collection.
- This use case displays projects on the authenticated owner's portfolio page. Public profile discovery, visitor access, download approval workflows, project editing/deletion, and profile/CV editing are separate work.
- File bytes are stored under `PROJECT_UPLOAD_DIR` (default `src/uploads/projects/`), outside the public directory. Use persistent disk when hosting and back it up with PostgreSQL. The gallery accepts 1–10 files and combined uploads are limited to 300 MiB. PostgreSQL retains project data, file metadata, and associations. All file reads require an authenticated owner; visitor access is separate.

## 2. Analysis and Design

### Main flow

1. The authenticated user opens their portfolio page and selects **Add project**.
2. The studio displays a blank form with project details, media gallery, optional notes, optional build/access settings, and the collection visibility choice.
3. The user fills the required fields, selects media, optionally adds notes and a build, and selects **Show in the collection**.
4. The user selects **Save changes**. The frontend validates the form, shows a pending state, and submits the creation request with the access token.
5. The backend verifies the active session, validates all fields and files, and derives the owner ID from the session.
6. The backend stores the files durably and commits the project, ordered media references, optional notes, and optional build in PostgreSQL.
7. The backend returns the saved project. The frontend replaces temporary form data with the server result, clears the unsaved state, shows confirmation, and opens the saved project's studio route.
8. Returning to the owner's collection displays the new project. Opening its card displays the saved details, media, and any optional content. Reloading obtains the same data from the backend.

### Persistence and responsibilities

Use an owner foreign key on the project, ordered media records associated with that project, and optional notes/build records with unique project foreign keys. These constraints enforce the model's ownership and zero-or-one associations. A gallery file belongs to its project; a build retains its permission with its file reference.

Commit all database records for a creation in one transaction. File storage and PostgreSQL do not share a transaction: stage uploads, ensure durable files exist before committing their references, and clean up staged/unreferenced files after a failed creation. A failed file write must not leave a saved project with missing files; a failed database commit must not leave an accepted partial project.

| Component | Responsibility |
|:---|:---|
| [Project studio and collection](../../../public/js/project.js) | Present required and optional fields, accept one optional build, and render the saved project in the studio, collection, and details views. |
| [Interaction coordinator](../../../public/js/app.js) | Collect data/files, validate, prevent repeated submission while pending, preserve failed form input, and update the UI only after a successful response. |
| [API client](../../../public/js/api.js) | Submit authenticated creation and owner-scoped loading requests, retaining the access token in memory and using the existing refresh flow. |
| `src/routes/project.routes.js`, `src/server.js` | Handle multipart creation and owner-scoped read routes; map service outcomes to HTTP responses. |
| `src/middleware/requireAuth.js` | Reuse active-session authentication before accepting project creation or owner reads. |
| `src/domain/projectRules.js`, `src/services/projectService.js` | Validate fields, assign ownership, persist optional associations, and coordinate database/file writes with cleanup on failure. |
| [Project migration](../../../src/db/migrations/003_create_projects.sql), [database adapter](../../../src/db/database.js) | Add project/media/notes/build tables and parameterized transactional writes; scope list/detail reads to the authenticated owner. |
| [File storage service](../../../src/services/fileStorageService.js) | Validate and store uploads, resolve durable file references, and clean up failed uploads. Apply authorization to file access and build permissions. |

Use `GET /api/projects` and `GET /api/projects/:id` contracts for reloading the owner's collection and project details. A missing or non-owned project returns `404`; the collection query filters by authenticated owner. The studio includes drafts, while the collection renders only projects with `published: true`.

`GET /api/projects/files/:id` serves saved media/build bytes to the owning account and returns `404` for missing or non-owned files. Owners can retrieve their own builds regardless of the stored visitor download setting.

### Sequence diagram

[Create a project](../uml/UC002_Create_Project_Sequence.puml)

## 3. Test Plan

1. Sign in, open **Add project**, fill all required core fields and media, leave notes/build empty, select **Show in the collection**, and save. Verify `201`, correct ownership, no notes/build rows, and a working project card on the owner's page.
2. Create projects with notes only, a build only, and both. Verify partial notes are allowed, every supplied value is retained, media order is preserved, and the build permission is saved. Reject a second build.
3. Reload the browser and restart the server against the isolated test database and file store. Verify the project and files still load from the backend.
4. Omit each required field, submit whitespace-only required text, invalid enum values, malformed metadata, and an invalid repository URL. Verify `400` with no saved project. Confirm that neither showcase type makes notes or a build mandatory.
5. Submit unsupported media/build formats and files exceeding their limits. Verify `415` or `413`, useful feedback, and no partial project or abandoned accepted uploads.
6. Submit without authentication and with expired/revoked credentials. Verify `401`. Attempt to submit another account's owner ID; verify it cannot assign ownership to that account. Sign in as a second account and verify its list/details/files cannot expose the first account's project.
7. Simulate file-storage and database failures. Verify no partial database records, cleanup of unreferenced files, no success notification or collection card, and retained form input for retry.
8. Save with collection visibility unchecked. Verify the draft appears in the owner's studio and persists across reload, while remaining absent from the collection. Cancel before saving and verify no creation request is sent.
9. Exercise pending submission and failure recovery in the browser. Verify repeated clicks while saving produce one request, and a successful save replaces the unsaved state with the server result. Run persistence tests only against isolated test resources.

## 4. Implementation Order

1. Add the PostgreSQL project schema and transactional owner-scoped persistence operations. Define request limits and durable file-storage configuration.
2. Implement core/optional-field validation and file staging/storage with cleanup on failure.
3. Implement and mount authenticated project creation and owner-scoped list/detail endpoints.
4. Connect the API client and studio to the backend, retain access-token handling, and align required fields and the single-build control with this contract.
5. Load saved projects into the studio, collection, and detail views; confirm visibility handling and persistence after reload.
6. Run the endpoint, persistence, failure-path, and browser checks, then document how to exercise the implemented endpoints.
