# UC005 — React Project Feed Frontend Plan

## 1. Goal and integration boundary

The React feed described here is implemented, using the existing site theme. It is the default landing page; other screens remain in vanilla JavaScript. Search uses the UC006 database suggestion endpoint without filtering loaded feed cards. The feed author projection includes public showroom and nullable profile IDs for navigation. Follow the [UC005 use case and API contract](UC005_Project_Feed.md). Add a public social-style project feed using React, while retaining the existing vanilla JavaScript authentication, collection, studio, project details, and profile screens.

React owns only the feed container. The current shell owns navigation, account/session state, and the other screens. Do not let the shell's whole-page `innerHTML` rendering replace a mounted React root: unmount it first. Use one React root for the feed, not one root per post. This follows React's [incremental integration guidance](https://react.dev/learn/add-react-to-an-existing-project) and [createRoot lifecycle](https://react.dev/reference/react-dom/client/createRoot).

## 2. Entry, routing, and build plan

- Project names link to `#/showroom/:showroomId/:projectId`. Creator names link to `#/about/:profileId?showroom=:showroomId`, falling back to the public showroom when no profile exists. Both destinations reuse existing public pages.
- Add `#/feed`. Fresh entry and the wordmark open the feed for both visitors and signed-in users. Keep `#/` as the existing owner's collection destination; use the existing **Discover** and **Showroom** navigation labels for the feed and collection. Explicit authentication/studio/profile links retain their destinations.
- Change the current sign-in-first default and the successful-sign-in default to `#/feed`. After signing out, show the public feed with visitor controls. Preserve the existing unsaved-edit confirmation when leaving studio/profile forms.
- Initialize the public feed without loading the owner's entire workspace. Restore the session independently; later account-state updates can enable mutations and refetch viewer like state for loaded pages while preserving card order and scroll position. Owner workspace requests remain limited to screens that require them.
- React and React DOM are runtime dependencies; Vite and its React plugin are development dependencies. The lockfile records them. Vite requires Node.js 20.19+ or 22.12+. `build:feed` builds the isolated bundle, and `dev:feed` watches its source files.
- Put feed JSX source under `frontend/feed/`, with a separate feed entry module and scoped styles. Configure Vite with `publicDir: false` and a dedicated output directory `public/feed-assets/`; cleaning that directory must not remove existing static assets. Generate a manifest and let the shell's loader resolve the entry's hashed JavaScript/CSS filenames.
- Add a feed-bundle build command and invoke it before production startup/deployment and browser tests. Update CI to build JSX instead of relying on `node --check` for JSX files. Keep existing backend/static JavaScript syntax checks. Do not commit generated bundles; build them in CI/deployment and serve them through Express.

## 3. Components and state ownership

The filenames below are implemented source modules for the [component diagram](../uml/UC005_Frontend_Components.puml).

| Source | Responsibility |
|:---|:---|
| `frontend/feed/mountFeed.jsx` | Export mount, account-update, and unmount functions for the existing shell. Own one root, load scoped styles, and perform cleanup. |
| `frontend/feed/FeedPage.jsx` | Present the feed heading, loaded cards, sentinel, Load more action, loading/retry feedback, and empty/end states. |
| `frontend/feed/useFeed.js` | Own loaded summaries, cursor, ordered unique post IDs, pending/error/exhausted state, request cancellation, and observer coordination. |
| `frontend/feed/ProjectPost.jsx` | Render author/project summary, cover, counts, and per-post interactions using `key={post.id}`. It is a component, not a database-writing object constructor. |
| `frontend/feed/PostMedia.jsx` | Render image/video media with reserved layout space and a missing-media placeholder. |
| `frontend/feed/LikeButton.jsx` | Own per-post pending/error feedback; request authenticated like/unlike and accept confirmed server state. |
| `frontend/feed/CommentSection.jsx` | Open/close the comment list, request its independent pages, retain draft input, and display submission feedback. |
| `frontend/feed/SearchSuggestions.jsx` | Query UC006, render ordered suggestions, cancel stale requests, and navigate current matches without filtering the feed. |
| `frontend/feed/feedApi.js` | Implement feed/comment reads and interaction requests with fetch, abort signals, contract-shaped results, and session integration. Do not duplicate token storage. |

Reuse the current `public/js/api.js` session mechanism through a shared transport interface: public reads may omit credentials, optional personalized reads can use the in-memory access token, and protected writes can refresh once before requiring sign-in. The bundler must not create an independent bundled copy of the existing session module with different token state. Pass the shared transport and account-state callbacks into `mountFeed` from the existing shell; never expose the raw token as component state or store it in browser persistence.

Feed state belongs to `useFeed`. Each post's comment draft, opened state, and pending controls belong to its components. Counts and confirmed like state are synchronized into that post's summary after a successful response. No browser database replaces server persistence.

## 4. Incremental loading algorithm

1. On mount, request `GET /api/feed?limit=10`. Instantiate cards only for returned summaries. Keep the returned `nextCursor`; do not calculate it from a rounded JavaScript date.
2. Observe a sentinel after the rendered list using [IntersectionObserver](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API), with a 600 px bottom prefetch margin. Also expose the same action through a keyboard-accessible **Load more projects** button.
3. Start the next request only when a cursor exists, no page request is pending, the route is still mounted, and no unresolved page error is blocking automatic retry. Keep an immediate in-flight guard, not only asynchronously updated React state.
4. Fetch one page for that cursor, deduplicate by post ID, append new summaries in server order, and advance the cursor only after success. Render the appended cards. Never call the owner-only workspace load method to populate this list.
5. If another page is needed to fill a tall viewport, permit the observer to request it after the previous request completes. Do not launch a loop that drains every cursor without a viewport need.
6. When the cursor is null, stop observing, hide Load more, and show **You're all caught up**. If the first successful response has no posts, show an empty-feed invitation instead.
7. On failure, retain cards and the failed cursor, show **Retry loading projects**, and pause observer retries. An explicit retry resumes the same page; no duplicate append is allowed.
8. On unmount, disconnect the observer and abort page/comment requests. Ignore results from stale request generations. Account changes must not apply an old user's viewer like state to the next session.

Appending cards progressively meets the initial requirement. It does not guarantee a bounded DOM after someone has traversed the entire feed. List virtualization is outside this milestone and can be added later if measurements justify it. Do not preload all post objects or media as a substitute for pagination.

## 5. Media, likes, and comments

**Media:** use the server-provided cover URL. Images use native lazy loading and asynchronous decoding; reserve a consistent media frame to reduce layout jumps. Render videos with controls, no autoplay, and `preload="none"`. The cover may be a video; no video-poster generation or new cover upload is required. Supply meaningful image alt text from the media name/project title. Replace unavailable media with a labelled placeholder while retaining interactions.

**Likes:** show count and pressed state. Visitors see a sign-in action. Signed-in users submit PUT or DELETE through the shared transport; disable that button while pending, update only with the returned count/state, and show an inline error on failure. Other cards remain usable. A revoked/expired session cannot create a successful-looking local like.

**Comments:** do not request a post's comments until its section opens. Load twenty oldest-first comments and provide a separate Load more comments control. Visitors may browse them but see a sign-in action instead of the submit form. Signed-in users submit 1–1,000 trimmed characters with a labelled textarea and pending state. Render text through React's normal text interpolation, never raw HTML.

On successful submission, clear only the submitted draft and update the count. If the list is exhausted, append the returned comment with ID deduplication. If older pages remain, display the saved comment separately as **Your comment was posted** until its ID appears in the paginated list; do not insert it into the middle of an incomplete chronological list. Retain input on errors and avoid automatic retry of an ambiguous comment POST.

## 6. Accessibility, failures, and acceptance checks

- Use a labelled feed section and semantic article cards. Announce loading/status changes without moving keyboard focus or reading every appended card automatically. Like buttons use `aria-pressed`; comment controls expose expanded state.
- Preserve visible focus and keyboard access to navigation, interaction controls, and Load more. Keep the same actions at mobile widths with no horizontal overflow. Respect reduced-motion preferences.
- Render first-load errors separately from an empty feed. A later page failure leaves previous cards visible. A failed personalized read may refresh once and fall back to anonymous browsing; protected mutations require sign-in when renewal fails.
- If the React bundle cannot load, show a recoverable feed-unavailable state and preserve navigation to sign-in and the existing workspace. Do not replace an error with an empty project list.
- For account changes, cancel outdated personalized reads, clear the previous viewer's like flags, and refetch the same loaded pages using the new identity or anonymous transport. Preserve displayed public content, page boundaries, and scroll position; do not fetch the unseen remainder of the feed.
- Verify the first request/page size, one in-flight next-page request, cursor advancement only on success, deduplication, end-of-feed termination, retry without lost cards, lazy comments/media, and cleanup after navigation.
- Verify visitors can browse without owner-workspace requests; signed-in interactions persist across reload; drafts/build files stay private; existing UC001/UC002 flows pass after entry routing and bundle-build changes.

## 7. Database search suggestions (UC006)

`frontend/feed/SearchSuggestions.jsx` queries `GET /api/search/suggestions?q=...&limit=10` after a 250 ms typing pause and at least two trimmed characters. The expanded list preserves backend ranking and shows result type plus account/creator context and the registration email on user suggestions. Visitors can see this email; matching remains name-only. Links open existing public profile/showroom/project destinations. Enter opens the first current suggestion, requesting immediately or reusing a pending request if necessary.

Changing or clearing the query aborts the previous request and invalidates its results. Unmounting also aborts requests. Loading, empty results, failures with retry, and informational `hasMore` feedback stay inside the expanded bar. Escape dismisses it; keyboard users can tab through links or use arrow keys. Search does not change feed cards, its cursor, its observer, or its Load more action.
