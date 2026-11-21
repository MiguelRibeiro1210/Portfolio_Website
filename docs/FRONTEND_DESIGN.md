# Frontend Design

## Purpose and scope

This document defines the **planned frontend** for the portfolio application. It is a design specification. Screens, interactions, layers, and acceptance criteria describe the intended product behavior.

The backend API, database, authentication service, and durable file storage **will be implemented separately**. They appear in this design only to explain the connections the frontend will require. Backend frameworks, database engines, endpoint paths, authentication protocols, schemas, and hosting providers are outside this document's scope.

The frontend will provide a responsive portfolio and editing experience based on the supplied six-screen design. It will use charcoal surfaces, burgundy panels, light neutral project mockups, and consistent typography and controls. It will omit profile pictures and show placeholders for information that has not been supplied.

## Users and navigation

- Visitors will explore the collection, inspect projects, read the maker's profile/CV, and use the download actions available to them.
- The portfolio owner will manage projects, profile information, media, releases, CV documents, and access preferences through the studio.
- A fresh visit will open sign-in. The Projects link will provide access to the public collection, and explicit public links will retain their destination.
- Owner actions will depend on the account and permissions returned by the future backend. Frontend visibility and navigation checks will not replace server authorization.

## Planned screens and interactions

The route names below identify frontend destinations, not backend API endpoints.

| Screen | Frontend destination | Intended behavior |
| --- | --- | --- |
| Account entry | `#/signin`, `#/register`, `#/reset` | Validate form input, allow password visibility changes, submit account requests through the API client, and present pending, success, or failure feedback. GitHub sign-in will depend on the future authentication connection. |
| Project showroom | `#/` | Display a featured slideshow, project cards, and open-source/private filters. Support wheel navigation, horizontal touch swipes, and arrow/keyboard controls. Wheel scrolling at the slideshow's first/last boundary will continue through the page. |
| Project experience | `#/project/:id` | Show project information, an image/video gallery, specification/release tabs, repository links, and permitted release downloads. |
| Project studio | `#/studio`, `#/studio/:id` | Create, edit, and delete owner projects; manage collection visibility, media order, release files, and access preferences; protect unsaved form edits. |
| About and CV | `#/about` | Present introduction, experience, education, skills, and contact information, with a CV download when a document is available. |
| Profile editor | `#/studio?section=profile` | Edit profile information and select, replace, or remove a PDF CV. |
| Access settings | `#/studio?section=security` | Present account connection state and edit download-permission preferences supported by the backend. |
| System states | `#/states` | Define the loading, temporarily unavailable, and first-project/empty presentations and their recovery actions. |
| Missing content | Unknown routes or unavailable project IDs | Explain that the content is unavailable and provide navigation back to the collection. |

Empty modules will retain their layout and useful next action without inventing names, dates, project details, or account information. A request failure will use an error/retry presentation rather than pretending that no data exists.

## Frontend layers

### Presentation layer

The shell, responsive styles, screen views, and shared UI elements will present data and collect user intent. Shared controls will provide consistent forms, dialogs, notifications, tabs, placeholders, and project previews. User-provided text will be rendered safely, and selected media will be previewed without changing source assets.

This layer will cover account screens, the showroom, project details, the studio, and the profile/CV experience. It will not access a database or implement authorization decisions.

### Interaction and state layer

The interaction layer will coordinate routes, account state, collection filters, slideshow position, galleries, forms, validation, and confirmation dialogs. It will track loading/error state and unsaved edits, then request data operations through the API client.

Transient UI state, such as the selected tab or unsent form fields, may live in memory. Durable project/profile data and uploaded files will be obtained from the backend after loading or refreshing the page. The frontend will not use browser persistence as a substitute for the database.

### API integration layer

A dedicated API client will isolate request/response handling from screen rendering. Views will not contain database queries or depend on a database engine. The integration will expose logical capabilities rather than making the UI responsible for server internals.

| Capability | Frontend responsibility | Required external backend behavior |
| --- | --- | --- |
| Account and permissions | Submit account requests; display account state and permitted owner controls. | Authenticate accounts and provide authoritative access decisions. |
| Projects | Request the collection/details; submit create, update, delete, and visibility changes. | Validate ownership and project data, then persist accepted changes. |
| Profile and CV | Load profile information; submit edits and CV replacement/removal requests. | Persist profile data and manage the associated document. |
| Media and releases | Select files, show previews/validation feedback, and submit upload, removal, and ordering requests. | Validate and store files and their association with projects. |
| Downloads and access | Request a file or access action and display the returned result. | Enforce permissions and provide authorized file access. |

The API client will expose pending, success, validation-error, unavailable, and access-denied outcomes so the UI can respond consistently. Exact endpoints and payload formats will be defined with the backend integration, outside this frontend design.

## Backend and database connections — to be implemented

The intended connection is **frontend → backend API → database/file storage**. There will be no direct frontend-to-database connection.

The backend API will be responsible for authentication, authorization, authoritative validation, and persistence. The database will retain project, profile, and access-preference records. The file service will retain media, releases, and CV documents. These external responsibilities identify dependencies; they do not specify the backend's internal layers, schemas, transaction design, or storage technology.

The frontend will consider an operation saved only after a successful backend response. Failed or unavailable requests will preserve editable input and explain the failure. Before an integration is available, a preview may support temporary interactions, but it must not claim that data was persisted or that an account operation succeeded.

## Forms, files, and failure states

- Forms will validate required fields and URL/email formats before submission, identify errors near the affected input, and retain values when submission fails.
- Save actions will show pending state and prevent duplicate submissions. Destructive actions and navigation away from unsaved edits will require an appropriate confirmation.
- File selection will provide type/size feedback, previews, ordering, and removal controls. The frontend selection limits will be 20 MB per image/video, 100 MB per release file, and 10 MB per PDF CV; backend validation will remain authoritative.
- Restricted downloads will show approval-required or access-denied feedback supplied by the backend. A frontend button alone will not provide file protection.
- Loading, empty, missing, unavailable, and access-denied states will be distinct. Retry controls will repeat the relevant request rather than report success without a response.
- Forms, dialogs, tabs, and slideshow controls will support keyboard use, visible focus, meaningful labels, and reduced-motion preferences. Mobile layouts will preserve the same actions and avoid horizontal page overflow.

## Planned connections and flow diagrams

All three diagrams describe the target frontend design. External components are explicitly marked **to be implemented**; arrows show intended interactions rather than completed connections.

- [System context](diagrams/system-context.puml): users, the frontend, and its future API/database/file-storage dependencies.
- [Frontend layers](diagrams/frontend-layers.puml): presentation, interaction/state, and API client responsibilities, with the backend represented as an external boundary.
- [Project update sequence](diagrams/project-update-sequence.puml): frontend validation, a future backend submission, and UI handling of success or failure.


## Acceptance criteria

The frontend design will be accepted when:

1. The planned screens and navigation behave consistently on desktop, mobile, and narrow viewports, with placeholders for absent content and no profile pictures.
2. The slideshow supports scrolling, touch swipes, keyboard controls, and normal page scrolling at its boundaries.
3. Account, project, profile, file, and access actions are routed through the API client, with pending, success, validation, and failure feedback.
4. Failed updates retain user input, repeated submissions are controlled, and unsaved edits and destructive actions receive suitable confirmation.
5. Empty, missing, loading, and failed-request states remain distinguishable and recoverable.
6. Connected data is reloaded from the backend after refresh; no browser persistence fallback replaces the database.
7. Backend-dependent scenarios are verified against an agreed API contract or test responses until those services are available. A preview result is not evidence of successful backend persistence or authorization.

Application setup and commands for checking the current code remain in the [repository README](../README.md). They are separate from this design's intended behavior and acceptance criteria.
