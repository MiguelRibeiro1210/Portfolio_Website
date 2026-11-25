# UC007 — Manage Project Collaborators

UC007 uses the existing UC002 creation request, `POST /api/projects`. Collaborator edits use the existing UC003 update request, `PUT /api/projects/:id` with `If-Match`. The project fields, collaborator list, and any uploaded files are submitted together by **Save changes**. Leaving a project is a separate action available to the tagged collaborator.

## 1. Requirements Engineering

As a Folio project creator or owner, I want to credit the people who contributed to a project so it appears in each teammate’s showroom. As a tagged collaborator, I want to be able to remove myself.

| Role | Meaning | Capabilities |
| --- | --- | --- |
| Owner | Shared project leadership | Appears in the published project’s showrooms. Can edit project details, files, publication status, collaboration notes, and the collaborator list, subject to the creator’s reserved controls. |
| Team Member | Substantial contribution without project leadership | Appears in the published project’s showrooms. Can remove their own membership. |
| Simple Participation | A smaller contribution, such as a single feature | Appears in the published project’s showrooms. Can remove their own membership. |

The creator holds a permanent Owner membership and is the only collaborator on a solo project. The creator alone can delete the project or remove or demote another owner. Other owners can leave voluntarily. Only the creator can appoint additional owners so the creator retains control over who gains edit access.

### Acceptance criteria

- An authorized editor can select multiple existing Folio accounts and assign one role per account. Duplicate accounts, unknown accounts, and invalid roles are rejected.
- Saving adds collaborators immediately. Each published project appears once in every current collaborator’s public showroom. Drafts are visible in the studio only to the creator and other owners.
- An authorized editor can add, remove, or change a collaborator’s role within the rules above. Removing a collaborator removes the project from their showroom and revokes any edit access.
- A non-creator collaborator can leave. Leaving keeps the project and other memberships intact. Direct links through the former collaborator’s showroom also stop working.
- Optional project-level collaboration notes can credit a contributor without a Folio account. Notes are displayed on the published project page. The form makes that visibility clear.
- Existing projects retain their creator, public links, and file access.

## 2. Domain Model

The original proposal captured roles and credits. The revised model uses a singular **Project Collaboration** for each project-account pair. A project owns one or more memberships, while an account can hold zero or more memberships across projects. The existing creator relationship records who created the project and supports the reserved actions. Collaboration notes belong to the project because they can mention people who have no account or membership.

See the [global domain model](../global_artifacts/domain-model.puml).

## 3. Design

### API and persistence

| Operation | Behavior |
| --- | --- |
| Select a collaborator | Use authenticated `POST /api/projects/collaborators/lookup` with an exact Folio account email. Return the display name, email, and public showroom ID. Public project responses omit emails. |
| Create or edit | Extend the existing multipart JSON `project` part with optional `collaborators` entries containing `showroomId` and `role`, plus `collaborationNotes`. The server derives the creator membership. On edit, an omitted field preserves the saved value. A supplied list replaces the non-creator memberships. An empty notes string clears the notes. |
| Read in Studio | Return the saved membership list, notes, applicable controls, and current ETag to authorized editors. Include co-owned projects in the editor list. |
| Leave | Use `DELETE /api/projects/:id/collaborators/me` and list the signed-in user’s non-creator memberships with `GET /api/projects/collaborations`. Derive the departing member from the active session, check membership, and remove it in a transaction that advances the project revision. |

Migration `008_create_project_collaborators.sql` adds a `project_collaborators` table with project and account foreign keys and a unique key on the pair. Backfill each existing project’s creator membership in the migration. Delete memberships when their project is deleted. Store collaboration notes on the project.

Reuse the existing UC003 revision check. Within the same transaction, verify the actor’s current edit rights, check the revision, enforce the permitted role changes against the saved membership list, and save project data and memberships together. A concurrent removal or edit must cause a stale save to fail. Keep existing cleanup for uploaded files when a save fails.

### Showroom and permissions

Use membership for the published showroom list, individual project lookup, and public file lookup. All three queries must agree about whether a project belongs in a given showroom. Each collaborator’s showroom link resolves to the same project and files. Keep public build permissions in effect across every showroom.

Keep the original creator ID on updates. Check current edit rights for studio reads, saves, and editor file access. Keep project deletion creator-only. Render studio controls from the permissions returned by the server.

See the [collaborator save sequence](UC007_Save_Collaborators_Sequence.svg) and its [PlantUML source](uml/UC007_Save_Collaborators_Sequence.puml).

## 4. Implementation Order

1. Add the migration and membership queries, then backfill creator memberships.
2. Extend UC002 and UC003 to validate and save collaboration fields. Update studio reads, file access, and authorization checks for other owners.
3. Update the showroom list, project detail, and file queries. Add the authenticated account lookup and self-removal action.
4. Add the collaborator selector, role controls, notes, and leave action. Update UC002 and UC003 documentation when implementation lands.

## 5. Test Plan

- Create a solo project and a project with every role. Confirm each tagged account sees the published project once and no public showroom exposes a draft.
- Verify owner editing and the creator-only actions. Verify Team Members and Simple Participation contributors cannot edit.
- Verify adding, removing, changing roles, and leaving. Check that stale edits fail and that leaving never deletes the project.
- Verify public project and media links across collaborator showrooms. Confirm restricted builds stay restricted and links through removed members stop resolving.
- Verify the migration preserves existing projects and that older edit requests omitting collaboration fields preserve memberships.
