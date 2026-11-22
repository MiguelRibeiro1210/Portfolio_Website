# Glossary

**Terms, Expressions and Acronyms (TEA)**

This glossary accompanies the [portfolio domain model](./domain-model.puml).

| **TEA (EN)** | **Description (EN)** |
|:---|:---|
| **Access Token** | A short-lived credential presented to the API when requesting a protected resource. In the planned sign-in design, it is a signed JWT with its own expiration. |
| **Account Creation Time** | The time an account was registered, represented by `UserAccount.createdAt`. |
| **Account Email** | The email address used for email/password sign-in. Registration trims surrounding whitespace and lowercases the address before enforcing uniqueness. |
| **Account ID** | The unique identifier assigned by the application to a user account. A sign-in session references its account through `userId`. |
| **Account Name** | The name supplied during registration and stored on the user account. |
| **Authentication** | Verification of a user's identity through an account password or a linked sign-in provider. |
| **Authorization** | The decision about whether a user can perform an action, such as editing a project or downloading a build. |
| **bcrypt** | The password-hashing algorithm used to store and verify passwords for email/password accounts. |
| **Build File** | The uploaded artifact associated with a downloadable build, such as an archive containing a compiled demo. |
| **Compatibility** | The platforms, versions, or runtime requirements that a visitor needs to know to use the project or its build. |
| **CV File** | The optional curriculum vitae document attached to a portfolio profile, currently designed as a PDF. |
| **Download Permissions** | The rules that determine who can download a build and whether access requires approval. |
| **Downloadable Build** | A project artifact offered for download subject to its download permissions. The current model allows one optional build per project. |
| **Media Gallery** | The collection of images or videos used to showcase a project. |
| **Password Hash** | The bcrypt result stored for a password-based account and used to check a submitted password. |
| **Portfolio Profile** | The optional profile owned by an account. It holds the public-facing name, role, location, biography, contact email, experience, education, skills, and professional links, plus an optional CV file. |
| **Profile Email** | The contact address displayed on a portfolio profile. The account email serves as the login identifier. |
| **Project** | A piece of work owned and showcased by an account. It includes a title, showcase type, description, tech stack, and media gallery, and can include notes and a downloadable build. |
| **Project Notes** | Optional supporting details for a project, represented as `Notes` in the model. They cover the idea behind the project, compatibility, the source repository, and release notes. |
| **Provider** | An external identity service, such as Google or GitHub, that verifies a user's identity for sign-in. |
| **Provider Identity** | A link between a user account and an external identity. It records the provider, the provider's user ID, and the time the link was created (`linkedAt`). An account can link multiple provider identities. |
| **Provider User ID** | The stable identifier assigned by a sign-in provider to one of its users. The provider and this ID together identify a linked external account. |
| **Refresh Token** | A secret used to obtain a new token pair for an active sign-in session. |
| **Refresh Token Hash** | The stored digest of the current refresh token, used to verify the token when a client requests a new pair. |
| **Release Notes** | A description of changes, fixes, or known issues in a version of a project. |
| **Session Creation Time** | When a user signed in and the session began, represented by `SignInSession.createdAt`. |
| **Session Expiration** | The deadline for refreshing the session, represented by `expiresAt`. The access token has its own expiration. |
| **Session ID** | The unique identifier for one sign-in session. One user account can have multiple sessions. |
| **Session Last Refreshed Time** | When the session last issued a new token pair, represented by `lastRefreshedAt`. It is empty until the first refresh. |
| **Session Revocation Time** | When the session was revoked, represented by `revokedAt`. Once set, the session can no longer be refreshed. |
| **Showcase Type** | The category that describes how a project is presented, such as an open-source project with a repository link or a closed-source project with a downloadable demo. |
| **Sign-in Session** | The server-side record created when a user signs in. It ties the application's token pair to the account and tracks refresh, expiration, and revocation. |
| **Source Repository** | The repository that contains a project's source code. A project can link to it from its notes. |
| **Tech Stack** | The languages, frameworks, libraries, and tools used to build a project. |
| **User Account** | The application identity that owns projects and can own a portfolio profile. It also associates sign-in sessions and linked provider identities with the same user. |
