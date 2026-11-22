# UC001 — Sign In with Google or GitHub

## 1. Requirements Engineering

### 1.1. User story

As a user, I want to sign in with Google or GitHub so I can access my portfolio with an account I already use. If I already have a portfolio account, I want to link a provider to that account and keep my existing portfolio.

### 1.2. Acceptance criteria

- **AC1:** A user can start sign-in from the Google or GitHub button. After the provider verifies the user, a linked identity signs in to its existing portfolio account.
- **AC2:** An unlinked identity with a verified email can create a portfolio account if that email is available. Account and identity creation succeed or fail together.
- **AC3:** If a provider email matches an existing account, the user signs in to that account and explicitly links the provider from **Access & security**.
- **AC4:** Linking requires an active portfolio session. A provider identity can belong to only one portfolio account, and each account can link one identity per provider.
- **AC5:** Successful provider sign-in starts the same application session as password login. Reload, refresh rotation, and logout follow the [login plan](../login/UC001_Login.md).
- **AC6:** An unavailable provider, cancellation, or invalid callback gives the user a clear message. A failed sign-in issues no new application session.

### 1.3. Inputs and outputs

| Endpoint | Input | Output |
|:---|:---|:---|
| `GET /api/oauth/:provider/start` | `google` or `github` | Redirects the browser to the configured provider and sets a short-lived OAuth transaction cookie. |
| `POST /api/oauth/:provider/link` | Provider, active refresh cookie, and matching application origin | Starts a provider flow tied to the current portfolio session. |
| `GET /api/oauth/:provider/callback` | Authorization code and state returned by the provider, plus the transaction cookie | On sign-in, sets the application refresh cookie and returns to the app. On linking, returns to **Access & security** with the result. |

### 1.4. Dependencies and decisions

- Reuse the accounts and session lifecycle from [registration](../registration/US001_Registration.md) and [password login](../login/UC001_Login.md).
- Configure a Google web OAuth client or GitHub OAuth App with the exact callback URL. Keep client secrets in the server environment. The [README](../../../README.md#google-and-github-sign-in) lists the settings and local URLs.
- Use the provider's stable user ID to find a linked portfolio account. Use email for new account creation and collision checks.
- An account created solely through a provider has no usable password. Password login remains available to accounts created through the registration form.

## 2. Analysis and Design

The [domain model](../../global_artifacts/domain-model.puml) links a `User Account` to one or more optional `Provider Identity` records. Each record stores the provider, its user ID, the local account ID, and the time it was linked.

| Component | Responsibility |
|:---|:---|
| `../../../src/config/env.js` | Load provider credentials and the configured application origin. |
| `../../../src/routes/oauth.routes.js` | Start sign-in or linking, validate the callback transaction, and handle account lookup or creation. |
| `../../../src/services/oauthService.js` | Build authorization requests with state and PKCE, exchange the code server-side, and retrieve the provider identity. |
| [Auth migration](../../../src/db/migrations/002_create_auth_tables.sql), [database.js](../../../src/db/database.js) | Persist provider links, enforce uniqueness, and create a new account and its link in one transaction. |
| `../../../src/services/authService.js` | Start an application session after successful provider sign-in. |
| `../../../public/js/auth.js`, `public/js/app.js`, `public/js/project.js` | Start provider sign-in, offer linking from **Access & security**, and display the result. |

The callback verifies the returned state against a short-lived, signed `HttpOnly` cookie. The server sends the PKCE verifier during the code exchange and uses the provider token to retrieve identity information. The application keeps its own refresh cookie. Provider tokens stay out of the browser and PostgreSQL.

### Sequence diagram

[Provider sign-in with a linked account](../uml/UC001_Provider_Login_Sequence.puml)

## 3. Test Plan

1. Exercise both provider callbacks with simulated responses and verify that their application sessions can access `GET /api/me`.
2. Reject a callback with incorrect state and verify that the authorization code exchange uses the matching PKCE verifier.
3. Verify that a matching email requires explicit linking. Link from an authenticated session and confirm that later provider sign-in returns the original account.
4. Reject a link request from a different origin. Check that an identity already linked elsewhere cannot be reassigned.
5. Check the provider entry points and error messages in the browser. Rerun password registration and login tests.
6. Once live credentials are configured, complete a real sign-in with each provider and verify linking, reload, and logout in the browser.

## 4. Implementation Order

1. Add provider configuration and PostgreSQL identity storage.
2. Connect authorization redirects, callbacks, and provider identity lookup.
3. Reuse application sessions for provider sign-in and require an active session for explicit linking.
4. Connect the browser controls and test the flow with simulated provider responses.
5. Configure both provider apps and verify live callbacks.
