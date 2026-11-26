# UC006 — Search Users and Projects

## 1. Requirements Engineering

### 1.1. User story and status

As a visitor or signed-in user, I want to search for a user or project by name, see matching suggestions beneath the search bar, and open one of those public pages. Pressing Enter opens the first suggestion.

**Status: backend and frontend integration implemented.** Apply migration 009 with schema-owner credentials before deployment. The [UC005 search bar](../UC005/projectFeed/UC005_Frontend_Plan.md#7-database-search-suggestions-uc006) requests database suggestions. Typing leaves the feed and its pagination unchanged. Matches appear only in the expanded suggestion bar, with no separate search-results page.

This use case follows [UC001](../UC001/login/UC001_Login.md), [UC002](../UC002/createProject/UC002_Create_Project.md), and [UC005](../UC005/projectFeed/UC005_Project_Feed.md). Reuse their account, project, public profile, and showroom records. Respect [UC007](../UC007/UC007_Project_Collaborators.md): a project can appear in multiple collaborators' showrooms but must appear only once in search.

### 1.2. Acceptance criteria

- **AC1:** Visitors and signed-in users can search the complete database of account/public-profile names and published project titles, including entries absent from loaded feed pages.
- **AC2:** Match any literal part of a name, ignoring case and accents. Search both the registration account name and the optional saved public-profile name. Either can match the same account, which appears once. Account emails are display-only; do not search emails, project descriptions, technology tags, notes, or file names.
- **AC3:** Combine users and projects in one ordered suggestion list. Exact names rank first, then names starting with the query, then other names containing it. Apply the same ranking to both result types.
- **AC4:** User suggestions open the saved public profile when present, otherwise the public showroom. Project suggestions open the existing public project page through the creator's showroom.
- **AC5:** Clicking a suggestion opens that suggestion. Enter opens the first suggestion for the current query. Empty, failed, outdated, and still-loading results must not navigate to another query's first result. The client behavior is specified in section 2.1.
- **AC6:** Suggestions are limited to ten by default, with a maximum of twenty. Additional matches are indicated by `hasMore`; this milestone adds neither a results page nor pagination through the entire directory.
- **AC7:** Drafts never appear, even for their signed-in owners or co-owners. Published open-source and closed-source projects are both searchable. Public search grants no new access to project files, restricted builds, or private account information.
- **AC8:** Searching and selecting suggestions create no accounts, profiles, projects, feed posts, or stored search-history records. Search does not filter, reorder, replace, or eagerly load feed cards.

### 1.3. Backend contract

| Endpoint | Input / authentication | Success | Failure |
| --- | --- | --- | --- |
| `GET /api/search/suggestions` | Public; required string `q`; optional integer `limit` | `200` with `{ query, suggestions, hasMore }` | `400` invalid query; `503` database unavailable or query timed out; `500` unexpected internal failure |

This route is a public read, not a personalized request. Require no bearer token, refresh cookie, or successful session restoration. Do not invoke session authentication or use supplied credentials to change visibility/order. A visitor and signed-in user receive the same result for the same query and database snapshot. Return `Cache-Control: no-store` and JSON; error responses contain only a safe `message`.

Validation and bounds:

- Accept `q` exactly once as a string. Trim surrounding whitespace; require at most 100 Unicode code points and reject null characters. Missing, repeated, nested, or non-string values return `400`.
- An empty or one-character trimmed query returns `200` with an empty list and `hasMore: false`, without running a search query. The client does not request suggestions until two characters are entered.
- `limit` defaults to 10. If supplied, accept exactly one decimal integer from 1 through 20. Reject fractions, empty values, repeated parameters, and unknown parameters, including `cursor`, `email`, and `ownerId`.
- Normalize the query and names consistently in PostgreSQL: Unicode NFC, lowercase, then accent removal with a fixed `unaccent` dictionary. Preserve internal spaces and punctuation. Matching is a literal contiguous substring, not token search or typo correction.
- Escape SQL `LIKE` metacharacters `%`, `_`, and the chosen escape character after normalization. Bind the query through parameters and derive escaped patterns inside SQL; never interpolate search text into SQL.

Example: `GET /api/search/suggestions?q=focus&limit=10`

```json
{
  "query": "focus",
  "suggestions": [
    {
      "type": "project",
      "id": "d84d6cf7-52a0-4405-88c8-a5fbbbd174db",
      "label": "Focus",
      "creatorName": "Miguel Ribeiro",
      "showroomId": "90c560ed-8f56-4527-a9c9-f627c30f81bc"
    },
    {
      "type": "user",
      "id": "076bdfd4-69a0-4533-b9f2-a1ce04ac751a",
      "label": "Focus Studio",
      "accountName": "Alex Rivera",
      "email": "alex@example.com",
      "showroomId": "076bdfd4-69a0-4533-b9f2-a1ce04ac751a",
      "profileId": "39a0c55d-eb63-438c-9d8d-927018ddf62a"
    }
  ],
  "hasMore": false
}
```

The exact project title outranks the user's prefix match. Preserve the array order when displaying suggestions and handling Enter.

Public projection allowlists:

| Type | Fields and meaning |
| --- | --- |
| `user` | `type`, `id` (the public showroom UUID, not the internal account ID), `label` (nonempty saved profile name, otherwise account name), `accountName`, `email` (registration account email), `showroomId`, nullable `profileId`. A match against the account name still returns the public display label; `accountName` lets the suggestion identify that alias. |
| `project` | `type`, `id` (project UUID), `label` (project title), `creatorName` (creator's account name), `showroomId` (creator's public showroom UUID). |

User suggestions deliberately expose the registration account email to visitors and signed-in users to distinguish identical names, including users without public profiles. Project suggestions contain no email. Return neither profile contact emails, password/session/provider data, collaborator emails, raw profile JSON, storage keys/URLs, file metadata, notes, builds, nor the owner-facing project object. Names, account emails on user suggestions, and public navigation identifiers are deliberately discoverable. All registered accounts are eligible, including accounts without profiles or published projects; their showroom may be empty. UC006 does not reuse the authenticated exact-email collaborator lookup from UC007.

## 2. Analysis and Design

### 2.1. Client integration

The implemented React search component consumes the backend as follows.

1. For a trimmed query of at least two characters, request suggestions after a 250 ms typing pause. Abort the previous request and associate each response with its query/generation. Clear results belonging to the old query immediately; never display them as current matches.
2. Expand the suggestion bar with the current ordered list. Distinguish loading, no matches, and failure; an error is not a successful empty result. Show names plus result type, creator/account context, and the account email on every user suggestion to distinguish duplicate labels. Keep all feed cards and normal feed scrolling unaffected.
3. Selecting a suggestion uses the returned public identifiers and the existing route mapping below. No selection endpoint or write request is needed.
4. Enter always opens `suggestions[0]` for the current query. If no successful current response is available, cancel the typing delay and request the current suggestions immediately, then open the first item only if the query/generation is still current. An existing in-flight request for that same generation can be reused. No matches or a request failure means no navigation. Do not build a feed filter, results page, or alternative full-directory fetch on Enter.
5. Clearing the query closes/clears suggestions and cancels the pending request. Leaving the page also aborts it. `hasMore` is informational; refining the query is the way to narrow suggestions in this milestone.

| Suggestion | Existing public destination |
| --- | --- |
| User with a profile | `#/about/:profileId?showroom=:showroomId` |
| User without a profile | `#/showroom/:showroomId` |
| Project | `#/showroom/:creatorShowroomId/:projectId` |

Encode all route values. These destinations reuse existing public read APIs. If a project is unpublished/deleted or an account/profile becomes unavailable after suggestions are fetched, the destination's existing authorization/not-found behavior remains authoritative; suggestions are not access grants.

### 2.2. Matching, ordering, and deduplication

Use normalized literal name matches only. Evaluate account name and nonempty profile name independently; an account's rank is its best matching name's rank. A project uses its title's rank. Rank buckets are exact match `0`, prefix match `1`, substring match `2`.

For deterministic ordering, sort by `(rank ASC, normalized display label COLLATE "C" ASC, type order ASC, public result ID ASC)`, where type order is user `0`, project `1`. Type preference breaks otherwise equal ties; it must never move a weaker user match above a stronger project match. Return the original, unnormalized display strings.

Build each user candidate once by joining `users` to its optional `profiles` record. Match either name without producing an extra result per alias. Build each published project candidate once from `projects`, joining its creator through `projects.owner_id`; do not join raw collaboration memberships or feed posts into this candidate set. Different users/projects with identical names remain separate suggestions, identified by `(type, id)`.

Fetch at most `limit + 1` rows from each already-ranked entity branch, then merge the two branches, apply the same global ordering, and fetch `limit + 1` overall. Only then compute `hasMore` and return the first `limit` rows. Do not allocate separate user/project quotas or limit before applying each branch's complete ordering. A single SQL statement gives the combined list a consistent snapshot. There is no total-count query.

### 2.3. Persistence and domain impact

Search is a read projection of the existing [domain model](../global_artifacts/domain-model.puml): User Account, optional Portfolio Profile, and published Project. **Search Suggestion is a transient response DTO, not a new persistent entity.** No search-history table, duplicated project, file move, storage bucket, or domain-model relationship is required.

Migration `009_add_search_indexes.sql` adds the search helper and indexes after migration 008 (project collaborators). Run `npm run db:migrate` with the schema-owner connection before deployment. Existing application records and files are preserved.

The migration:

- Enables or reuses PostgreSQL `unaccent` and `pg_trgm`, resolving their installed schemas rather than assuming an existing extension lives in `public` or `extensions`. Never relocate an existing extension.
- Defines a schema-qualified `portfolio.search_normalize(text)` helper using the normalization in section 1.3 and an explicitly pinned `unaccent` dictionary. An immutable wrapper for expression indexing assumes that dictionary remains unchanged; document this dependency. If normalization or its dictionary changes, rebuild all dependent indexes before serving the changed semantics.
- Adds GIN trigram expression indexes for normalized `users.name`, normalized `profiles.fields ->> 'name'` with null handled as an empty string, and normalized `projects.title` restricted to `published = true`. Keep query expressions identical to indexed expressions. Preserve every existing business record and ID.
- Gives the runtime database role the needed schema/function usage and SELECT access to existing fields; it must not need extension-installation or schema-owner permissions. Deploy index/extension setup with schema-owner credentials.

PostgreSQL documents [accent removal](https://www.postgresql.org/docs/18/unaccent.html) and [trigram indexes for LIKE/ILIKE](https://www.postgresql.org/docs/18/pgtrgm.html). Trigram indexing is an implementation aid, not permission to add fuzzy matching. Two-character or punctuation-heavy patterns can still require broad scans. Measure these explicitly; use a 2-second transaction-local statement timeout on the search connection, roll back/reset it before releasing the pooled connection, and return a safe `503` on timeout. Do not silently narrow matching or leak database errors.

Publication/name/profile changes are reflected by the existing rows and expression indexes; no background synchronization or manually refreshed search cache is introduced. Public projection and ordering must not depend on session identity.

### 2.4. Implemented backend components

The backend uses the following files.

| File | Responsibility |
| --- | --- |
| `src/routes/search.routes.js`, `src/server.js` | Mount public `GET /api/search/suggestions`; set no-store, map safe JSON/status responses, and avoid session dependencies. |
| `src/domain/searchRules.js` | Validate query shape, lengths, short-query behavior, and limit. |
| `src/services/searchService.js` | Short-query fast path, orchestrate lookup, enforce explicit public DTOs, derive `hasMore`, and preserve ranked order. |
| `src/db/searchDatabase.js`, `src/db/database.js` | Expose the parameterized combined search query, publication filter, normalized ranking, deduplication, bounds, and connection-local timeout cleanup. |
| `src/db/migrations/009_add_search_indexes.sql` | Extension/helper/index setup and runtime grants; preserve application data. |
| `tests/search-rules.test.js`, `tests/search.test.js` | Query validation, public projection, ordering, persistence visibility, bounds, and failure behavior. |

The shared server remains responsible for its existing auth/project/feed routes. Do not add `q` to `/api/feed`, modify its pagination contract, expose an email lookup publicly, or couple search suggestions to feed pagination.

### 2.5. Diagram

[Backend suggestion sequence](uml/UC006_Search_Suggestions_Backend_Sequence.puml) · [Rendered SVG](UC006_Search_Suggestions_Backend_Sequence.svg)

The sequence uses the implemented backend filenames. The backend sequence shows the React search component as its client; frontend behavior is detailed in section 2.1.

## 3. Test Plan

1. Search anonymously and while signed in; verify identical public suggestions and order. Supply stale credentials to this public read and confirm search does not depend on successful session restoration. Verify user suggestions include the account email, project suggestions omit it, and no profile contact email, provider identity, session field, raw profile, storage key, or restricted build leaks.
2. Match account names, public-profile names, and project titles using exact, prefix, and middle substrings, mixed case, composed/decomposed accents, non-Latin names, internal spaces, and literal `%`, `_`, escape characters, quotes, and injection-looking input. Do not match only descriptions, tech tags, notes, collaborator emails, or file names. No typo matching is promised.
3. Verify every rank bucket across both entity types. Exact projects outrank prefix users and exact users outrank prefix projects. Verify alphabetical/type/ID tie-breakers, repeated requests with unchanged data, duplicate display names with distinct account emails and correct destinations, and one user result when both its aliases match.
4. Include accounts without profiles or projects, accounts whose profile and account names differ, saved blank profile names, users with several collaborations, and projects in several showrooms. Verify one result per project and stable creator-showroom destinations.
5. Create drafts and published projects of both showcase types. Drafts stay absent even for their owners/co-owners. Publish, rename, unpublish, edit/remove profile data, and delete through existing APIs; search must reflect committed changes without a separate indexing job. Existing destination routes still enforce publication and download permissions after selection.
6. Test missing/blank/one-character `q`, 2 and 100 code points, overlong Unicode input, repeated/nested/unknown query parameters, and limits missing/1/10/20/out of bounds/fractional/empty. Short valid queries return an empty list without executing the search SQL. Invalid input returns `400`.
7. Test zero, exactly `limit`, and more than `limit` matches; check global limit and `hasMore`, including cases where every top suggestion is of one type. Assert no total-count or whole-feed fetch. Use EXPLAIN with realistic names and test broad two-character patterns, unavailable databases, timeout rollback, and safe connection reuse afterward.
8. Client contract tests: dropdown-only matches, unchanged feed, click navigation, Enter selecting the first current suggestion, Enter during typing/loading, empty/failure states, out-of-order responses, changed/cleared queries, aborts, and removed/unpublished destinations. Browser tests cover unchanged feed cards, current-query navigation, stale responses, clearing, failures, and real database-backed public destinations.
9. Test extension/index migration on an isolated database and an existing application schema, preserving IDs and project/account data. Run UC001/UC002/UC005/UC007 backend regressions before deployment. Never point tests at production.

## 4. Implementation and Deployment

1. Implemented query-rule tests and the public DTO contract; confirmed account/profile/project column mappings and migration 009.
2. Added and tested the extension/normalizer/index migration in isolated PostgreSQL, including runtime grants, existing extension schemas, index EXPLAIN plans, and timeout cleanup.
3. Implemented the combined database query and the service's short-query path, safe projection, bounded response, and `hasMore` calculation.
4. Mounted the public route and added API tests for ranking, eligibility, alias/project deduplication, invalid queries, and storage/auth-independent reads.
5. Run isolated backend regressions and deploy the additive database changes before enabling the new endpoint. The frontend consumes UC006 independently of feed pagination.
6. Implemented dropdown suggestions in `frontend/feed/SearchSuggestions.jsx`, using `frontend/feed/feedApi.js` for requests and public route mapping. Loaded-feed filtering has been removed.
