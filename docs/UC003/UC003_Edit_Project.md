# UC003 — Edit or Remove a Project

UC007 adds collaborator edits and access for additional owners to the existing update flow. [UC007 design](../UC007/UC007_Project_Collaborators.md)

## 1. Requirements Engineering

### 1.1. User story

As a signed-in portfolio owner, I want to update or remove a previously saved project so the studio and collection reflect the work I want to keep.

UC003 extends [UC002 — Create a Project](../UC002/createProject/UC002_Create_Project.md). It uses the same project form, PostgreSQL tables, file storage, and validation rules. Editing requires an Owner membership, while deletion is reserved for the creator. A saved draft and a project shown in the collection can both be edited or removed.

### 1.2. Acceptance criteria

- **AC1:** Opening a saved project in the studio preloads its details, notes, ordered gallery, optional build, download permission, and **Show in the collection** setting.
- **AC2:** **Save changes** updates the existing project in one request. Its ID and creator stay the same, and existing collection and studio links still resolve.
- **AC3:** The owner can retain, add, remove, or reorder gallery files. The saved gallery must contain 1–10 files. A details-only edit keeps current files without uploading them again.
- **AC4:** The owner can edit or clear optional notes, retain or change the build's download permission, replace the build, or remove it. A project has at most one notes record and one build.
- **AC5:** The saved project stays in the studio. **Show in the collection** determines whether it appears in each collaborator’s collection. Showcase type and collection visibility remain separate, as in UC002.
- **AC6:** After the creator confirms **Delete project**, the project and its associations disappear from the studio and collection. Its details and files can no longer be retrieved through the project's API.
- **AC7:** Only a confirmed Owner can load the editor or submit changes. Only the creator can delete the project. An absent session returns `401`. A missing or inaccessible project returns `404`.
- **AC8:** Invalid edits and failed saves preserve the previous project and files. Failed saves keep the form input available for retry. A stale editor cannot overwrite or delete a newer revision.

### 1.3. Inputs and outputs

| Endpoint | Input | Success |
|:---|:---|:---|
| `GET /api/projects/:id` | Project ID and bearer token | Existing owner-scoped read. Return the saved project and an `ETag` for its revision. |
| `PUT /api/projects/:id` | Bearer token, `If-Match` with the loaded revision, and multipart form | `200 OK` with the updated project in the UC002 response shape and a new `ETag`. |
| `DELETE /api/projects/:id` | Bearer token and `If-Match` with the loaded revision | `204 No Content` after deletion commits. |

The update uses the same multipart fields as UC002. The JSON `project` part contains the editable fields `title`, `type`, `description`, `stack`, `published`, `story`, `compatibility`, `source`, and `releaseNotes`. New files use `media` and `build` parts. The update JSON adds two instructions:

| Instruction | Meaning |
|:---|:---|
| `mediaOrder` | The complete desired gallery order. Each entry refers to an existing file belonging to this project by `fileId`, or refers to a new `media` part by zero-based `uploadIndex`. Existing files omitted from the order are removed. Reject duplicate entries, unreferenced uploads, and file IDs outside the project. |
| `buildAction` | `keep`, `replace`, or `remove`. A replacement requires exactly one `build` part. Whenever the result has a build, `permission` must be `public`, `request`, or `none`. The permission can change while retaining the existing build file. |

Reuse UC002's text and URL rules, allowed media/build formats, 20 MiB per media file, 100 MiB per build, and 300 MiB combined limit for incoming uploads. Check the media count against the complete saved gallery, including retained files. All-blank notes remove the optional notes record.

Missing `If-Match` returns `428`. A stale revision returns `412` and asks the owner to reload before retrying. Invalid fields or references return `400`, oversized requests return `413`, and unsupported files return `415`. Unexpected errors return a generic `500`.

### 1.4. Dependencies and decisions

- Reuse [UC001 sign-in](../UC001/login/UC001_Login.md) and `req.user.id` for authorization. The client cannot change the project owner.
- Keep the [existing project schema](../../src/db/migrations/003_create_projects.sql) and add a revision column in [migration 005](../../src/db/migrations/005_add_project_revision.sql), with existing projects starting at revision 1.
- Reuse the UC002 project storage adapter, file validation, and serving paths (private Supabase bucket in production; explicit local storage for development). New file IDs are generated on the server. Retained media and builds keep their existing IDs.
- Visitor access and build approval remain separate from owner editing. Saving the build permission persists the owner's choice for the visitor workflow.
- **Delete project** requires confirmation and permanently removes the saved project. Cancel closes the confirmation and sends no request.

## 2. Analysis and Design

### 2.1. Editor and update

The owner opens `#/studio/:id`. Load the current project and revision with the existing detail endpoint, then populate the UC002 form. Reuse the existing controls for staging files and keeping gallery order. While a save is pending, prevent duplicate submissions. On success, replace the local project with the server response so the studio and collection agree.

Validate incoming values, stage accepted uploads, then lock and recheck the project ID, current editor membership, and revision in the PostgreSQL transaction before saving. Commit the fields, notes, media order, build, and incremented revision together. Write new files before committing references to them. Remove superseded files after commit and clean up staged or newly stored files after a confirmed rollback. If commit status is uncertain, preserve the files until their references can be checked. A cleanup failure after commit is logged and handled separately from the save result.

### 2.2. Deletion

After confirmation, the backend checks ownership and revision in the deletion transaction, captures the file IDs, and deletes the project. PostgreSQL cascades the delete to notes and file metadata. After commit, remove the project's stored files. If physical cleanup fails, log the file IDs for retry. The committed database deletion makes the files inaccessible through the owner-scoped file route.

On `204`, the frontend removes the project from its state and returns the owner to the studio list. A failed request keeps the project in the UI.

### 2.3. File responsibilities

| File | Responsibility |
|:---|:---|
| `public/js/project.js` | Make saved projects editable using the UC002 form. Show the delete control and existing attachments. |
| `public/js/app.js`, `public/js/api.js` | Load the editor, submit changes, confirm deletion, handle conflicts, and apply server results. |
| `src/server.js`, `src/routes/project.routes.js` | Use the existing `/api/projects` mount and add owner-scoped update and delete handlers. |
| `src/middleware/requireAuth.js` | Authenticate each owner request. |
| `src/domain/projectRules.js`, `src/services/projectService.js` | Reuse UC002 validation, resolve the requested file changes, and coordinate persistence and cleanup. |
| `src/services/fileStorageService.js` | Stage and validate uploads, store new files, and remove obsolete files. |
| `src/db/database.js` and the new revision migration | Load, lock, update, and delete owner-scoped records. Preserve associations and commit metadata changes atomically. |

### Sequence diagrams

- [Open a saved project in the editor](UC003_Open_Project_Sequence.svg) · [PlantUML source](uml/UC003_Open_Project_Sequence.puml)
- [Save project changes](UC003_Edit_Project_Sequence.svg) · [PlantUML source](uml/UC003_Edit_Project_Sequence.puml)
- [Confirm and delete a project](UC003_Delete_Project_Sequence.svg) · [PlantUML source](uml/UC003_Delete_Project_Sequence.puml)

## 3. Test Plan

1. Create a project through UC002, then open it for editing. Verify that required fields, optional associations, saved file order, and the revision load correctly.
2. Save a details-only update. Check that the project ID, owner, file IDs, and bytes are retained. Reload and verify the new values.
3. Add, remove, and reorder media. Reject removing the last file, exceeding gallery limits, or selecting media IDs from another project. Exercise build replacement, permission-only edits, removal, and clearing notes.
4. Switch a project between draft and collection. Verify it remains in the studio and only appears in each collaborator’s collection when selected.
5. Simulate upload and database failures and verify that the previous project remains usable. Submit from two editor instances and verify a stale save or delete is rejected.
6. Verify that unauthenticated requests return `401`, and a second user cannot edit or delete the owner's project. Confirm deletion and verify that project, association, and file reads no longer return it. Verify cancellation sends no request.
7. Run UC002 creation and file-serving regression tests against disposable PostgreSQL and isolated file storage.

## 4. Implementation Order

1. Add the revision migration and return the revision when opening a saved project. Wire the existing studio form to load saved data.
2. Implement single-request updates with shared validation, ordered media, notes/build changes, and cleanup.
3. Implement confirmed deletion and file cleanup.
4. Verify UC003 in the browser and run the UC002 regression tests.
