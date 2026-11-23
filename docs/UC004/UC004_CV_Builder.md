# UC004 — Build and Share a Portfolio CV

## 1. Requirements Engineering

### 1.1. User story

As a portfolio owner, I want to edit my professional profile and attach a PDF CV so recruiters and visitors can read my saved profile and preview or download the CV.

### 1.2. Acceptance criteria

- **AC1:** A signed-in user can save and reload one portfolio profile and update its optional PDF from the same CV editor. The existing Profile & CV page displays the fields in one form, with the PDF control below them and a single **Save profile** button.
- **AC2:** The API takes the owner from the authenticated session. A user can edit or attach a document only to their own profile.
- **AC3:** An owner can upload, replace, preview, or remove one PDF CV up to 10 MiB. A rejected or failed save leaves the previously saved profile and attachment available.
- **AC4:** Any visitor can open the public About & CV page and see the profile information the owner has saved in the About, Experience, Education, Skills, and Contact tabs. Visitors can preview or download the current PDF as soon as the upload succeeds.
- **AC5:** Visitors see only the information the owner has provided. Clearing an optional field removes its value from the public view. Removing the PDF removes the preview and download controls and makes its URL return `404`.
- **AC6:** Saved profile fields and the PDF survive a page reload and server restart.

### 1.3. Input and output data

The field list follows [Portfolio Profile and CV File in the domain model](../global_artifacts/domain-model.puml).

| Editor section | Fields |
|:---|:---|
| A little about you | Name, role, location, contact email, About, Experience, Education, Skills, GitHub URL, and LinkedIn URL |
| Your CV, in good hands | One optional PDF with its display filename |

The public About & CV page presents the saved information in five read-only tabs. **About** shows the biography alongside the profile name, role, and location. **Experience**, **Education**, and **Skills** show their respective fields. **Contact** uses the saved contact email and social links. The PDF controls are separate from the tabs and appear when a profile has an attachment.

The original brief lists Certifications. The current domain model has no Certifications field, so this plan leaves it out. Experience, education, and skills use multiline text fields, consistent with the current editor. The profile contact email is entered separately from the account login email.

### 1.4. Dependencies and decisions

- Reuse the access token and `requireAuth` middleware from [UC001 login](../UC001/login/UC001_Login.md).
- Continue with Express and PostgreSQL. Use the private Supabase Storage bucket `cv-files` for the PDF and store its metadata in PostgreSQL.
- Use the existing [Profile & CV editor and About view](../FRONTEND_DESIGN.md) as the browser entry points. Replace their in-memory profile and file behavior with API calls when implementing.
- Use an opaque public profile ID for the shareable About & CV URL. **Save profile** updates the information available to visitors. Owners leave fields empty when they prefer to omit them. The CV file is optional.

## 2. Analysis and Design

### 2.1. Data and ownership

Add PostgreSQL tables for the profile and its optional attachment in the [004_create_profiles.sql](../../src/db/migrations/004_create_profiles.sql). Use a unique account foreign key for the profile and a unique profile foreign key for the attachment. Store the profile's public ID separately from its display fields. Store the PDF's private object key, display filename, and size as attachment metadata.

Validate profile text lengths and contact information on the server. Allow HTTP(S) URLs for the two social links. For uploads, enforce the size limit and validate the PDF content independently of the extension and submitted MIME type. Generate a storage key on the server and use the filename only for display and download headers.

Validate the profile and optional PDF before saving. When a PDF is selected, store it under a new object key before starting the PostgreSQL transaction. In that transaction, save the profile fields and update its attachment reference together. Serialize saves per profile when changing the attachment. After commit, clean up the superseded object. If the transaction rolls back, clean up the staged object and keep serving the previous profile and PDF.

Serve visitors the PDF through Express by resolving the profile’s current attachment on each request. Return the PDF inline for preview or as an attachment for download. Use a non-caching policy so changes and attachment removal take effect on subsequent requests.

### 2.2. Proposed API

Clicking **Save profile** sends one `multipart/form-data` request containing the current profile fields and an optional `cv` file. Selecting a new PDF replaces the current one. Saving without a PDF keeps the current attachment. An explicit `removeCv` form field detaches it as part of the same save. A request that supplies both a replacement and a removal is rejected as ambiguous.

| Endpoint | Access | Success |
|:---|:---|:---|
| `GET /api/profile/me` | Signed-in owner | `200` with saved fields and attachment metadata, or an empty profile state |
| `PUT /api/profile/me` | Signed-in owner | `200` with saved fields, public ID, and attachment metadata after one multipart save |
| `GET /api/profile/me/cv` | Signed-in owner | `200` with the PDF for preview |
| `GET /api/profiles/:publicId` | Public | `200` with saved profile fields and CV availability |
| `GET /api/profiles/:publicId/cv` | Public | `200` with the PDF for inline preview, or download with `?download=1` |

Missing profiles or attachments return `404`. Owner routes return `401` without a valid session. Invalid fields or PDF content return `400`, and oversized uploads return `413`. Public responses omit login details, account IDs, and private storage keys.

### 2.3. File responsibilities

| File | Responsibility |
|:---|:---|
| `src/server.js` | Mount the CV routes under `/api`. |
| `src/middleware/requireAuth.js` | Verify the owner session and set `req.user` for protected routes. |
| `src/routes/cv.routes.js` | Handle profile and attachment requests, multipart parsing, and PDF response headers. |
| `src/domain/cvRules.js` | Validate profile fields and attachment constraints. |
| `src/services/cvService.js` | Coordinate owner saves, PDF storage, and visitor access. |
| `src/db/database.js` and `004_create_profiles.sql` | Persist profile and attachment metadata with ownership and uniqueness constraints. |
| `src/services/cvStorage.js` | Read, write, and remove PDFs in private durable storage. |

### Sequence diagrams

- [Open the CV builder](UC004_Profile_Save_Sequence.svg) · [PlantUML source](uml/UC004_Profile_Save_Sequence.puml)
- [Update profile information and the optional PDF](UC004_CV_Update_Sequence.svg) · [PlantUML source](uml/UC004_CV_Update_Sequence.puml)
- [View the profile and preview or download the PDF](UC004_Visitor_CV_Access_Sequence.svg) · [PlantUML source](uml/UC004_Visitor_CV_Access_Sequence.puml)

## 3. Test Plan

1. Save profile fields and add a PDF from the same editor, then verify both persist after reopening the studio and restarting the server. Save text alone and verify the existing PDF remains attached.
2. Verify owner endpoints reject unauthenticated requests and a second user cannot change the first user's profile or PDF.
3. Upload, preview, replace, and remove a valid PDF. Reject oversized or invalid files and confirm a failed save leaves both the previously saved fields and PDF visible to visitors.
4. Visit the profile URL while signed out immediately after a save. Verify the saved fields, inline PDF preview, and download. Clear a field and remove the PDF, then verify the profile still loads, the field value is gone, and the PDF endpoint returns `404`.
5. Run the backend integration suite against disposable PostgreSQL and isolated file storage. Verify that one **Save profile** action sends exactly one multipart request and saves both the fields and the selected PDF. Test the recruiter flow in the browser.

## 4. Implementation Order

1. Add the PostgreSQL migration and owner profile read/save endpoints.
2. Add PDF validation, private storage, owner preview, replacement, and removal.
3. Implement public profile reads and PDF delivery for saved content.
4. Wire the existing studio form and public view to the API and run integration and browser tests.
