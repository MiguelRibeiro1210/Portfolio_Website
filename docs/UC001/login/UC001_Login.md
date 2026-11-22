# UC001 — Sign In with Email and Password

## 1. Requirements Engineering

### 1.1. User story

As a registered user, I want to sign in with my email and password so I can access my private portfolio workspace, stay signed in while my session is active, and sign out when I am done.

This milestone covers the Express API and PostgreSQL persistence for password login and the dual-token session. The browser sign-in form uses these endpoints. Google and GitHub use the same application session.

### 1.2. Acceptance criteria

- **AC1:** Valid credentials create a session for the account. The API returns a signed access token valid for 15 minutes and sets a refresh token in an `HttpOnly` cookie.
- **AC2:** Invalid request bodies return `400`. An unknown email and an incorrect password both return the same `401` response.
- **AC3:** A valid access token for an active session grants access to the signed-in user's account details. Missing, invalid, or expired tokens and tokens for revoked or expired sessions return `401`.
- **AC4:** A valid refresh token issues a new access token and replaces the refresh token. The old token stops working, including when two requests try to rotate it concurrently.
- **AC5:** A session ends seven days after sign-in. Refreshing tokens does not extend that deadline.
- **AC6:** Logout revokes the session and clears the refresh cookie. Its refresh token and any unexpired access tokens for that session are rejected afterward.

### 1.3. Inputs and outputs

| Endpoint | Input | Success output | Failure |
|:---|:---|:---|:---|
| `POST /api/login` | JSON with `email` and `password` | `200 OK` with an access token and the refresh cookie | `400` for invalid input, `401` for invalid credentials |
| `GET /api/me` | `Authorization: Bearer <accessToken>` | `200 OK` with the account's ID, name, and email | `401` when authentication fails |
| `POST /api/refresh` | Refresh cookie | `200 OK` with a new access token and replacement refresh cookie | `401` for missing, invalid, expired, or revoked credentials |
| `POST /api/logout` | Refresh cookie identifying the session | `204 No Content` and a cleared cookie | An absent or stale cookie can be cleared without revoking another session |

### 1.4. Dependencies and decisions

- Reuse the account records and bcrypt hashes from [registration](../registration/US001_Registration.md). Normalize email the same way and compare the password as submitted.
- Use a server-side signing secret and a JWT library to issue and verify access tokens. Carry the account ID, session ID, and expiration in the JWT.
- Generate refresh tokens with cryptographically secure randomness. Store only the current refresh token's hash in PostgreSQL.
- Set the refresh cookie as `HttpOnly` and `SameSite=Strict`, with `Secure` over production HTTPS. Scope it so it reaches both refresh and logout. Clear it using the same path.
- A future browser integration can keep the access token in memory and use the refresh cookie to restore an active session after reload.

## 2. Analysis and Design

The [domain model](../../global_artifacts/domain-model.puml) associates a user account with zero or more sign-in sessions. A login starts a new session. Refresh rotates that session's tokens, and logout revokes that session.

| Session field | Purpose |
|:---|:---|
| `id`, `userId` | Identify the session and its owning account. |
| `refreshTokenHash` | Verify the current refresh credential. Replace the hash on rotation. |
| `createdAt` | Record when the user signed in. |
| `lastRefreshedAt` | Record the last successful rotation. Start with an empty value. |
| `expiresAt` | Set the fixed seven-day deadline at login. |
| `revokedAt` | Record logout or revocation. An active session has no revocation timestamp. |

| File | Responsibility |
|:---|:---|
| [Auth migration](../../../src/db/migrations/002_create_auth_tables.sql), [database.js](../../../src/db/database.js) | Add the session table, account lookup, and session operations. Rotate the refresh hash in one conditional update that checks the current hash, expiration, and revocation state. |
| `../../../src/services/authService.js` | Verify credentials and coordinate session creation, refresh, and logout. |
| `../../../src/services/tokenService.js` | Sign and verify JWTs, generate refresh tokens, and hash refresh tokens for storage. |
| `../../../src/routes/auth.routes.js` | Handle login, refresh, logout, and account retrieval over HTTP. Set and clear the refresh cookie. |
| `../../../src/middleware/requireAuth.js` | Verify the bearer token and check the session in PostgreSQL before allowing protected requests. This makes logout effective even while an issued JWT is still within its lifetime. |
| `../../../src/config/env.js` | Load and validate the signing configuration and cookie settings. |

### Sequence diagram

[Email and password sign-in](../uml/UC001_Login_Sequence.puml)

## 3. Test Plan

1. Register a user, sign in with valid credentials, and verify the JWT response and refresh cookie. Check that PostgreSQL stores the refresh token hash.
2. Check malformed login requests and verify that unknown email and wrong password produce identical `401` responses.
3. Call `GET /api/me` with a valid token, then with missing, invalid, and expired tokens.
4. Refresh a session and check that the new token pair works. Verify that replaying the old refresh token fails and that two simultaneous refresh requests yield one successful rotation.
5. Verify that the fixed session expiry blocks refresh and protected requests. Verify that logout clears the cookie and blocks both refresh and protected access immediately.
6. Run the registration regression test against an isolated PostgreSQL database.

## 4. Implementation Order

1. Add the session schema and credential lookup, then implement password verification.
2. Add token generation and create the session on successful login.
3. Add the authentication middleware and `GET /api/me`.
4. Add refresh rotation and logout.
5. Run backend integration tests and document how to exercise the endpoints before wiring the frontend.
