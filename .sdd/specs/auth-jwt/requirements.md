# Requirements Document

## Project Description (Input)
JWT authentication for PayPilot: user registration and login, JWT issuance and validation (auth guards), and the per-user data-isolation baseline so every financial record belongs to and is queried by the authenticated user. Builds on the platform-foundation (NestJS API, validated config, canonical errors, Prisma 7). Uses JWT initially per steering; secrets via validated env, never committed.

## Introduction

This specification adds authentication and authorization to PayPilot on top of the platform-foundation. It introduces user accounts (registration/login), JWT-based session authentication with a route guard, and the **per-user data-isolation baseline** that every later financial feature relies on (a record always belongs to a user and is only accessible by that user). It reuses foundation primitives: validated environment config (fail-fast), the canonical error envelope, request-id correlation, and Prisma access via `PrismaService`.

Alignment with steering: authentication and authorization are separated and centralized (`security.md`); secrets come from validated env and are never committed (`security.md`, financial-rules R8); auth-critical paths must have automated tests (`testing.md`). Requirements describe **what** the system must do; concrete libraries and token shapes are decided in the design phase.

**Out of scope (deliberately excluded from this spec):**
- Server-side logout
- Token revocation
- Token blacklist
- Refresh-token rotation
- Email verification
- Password reset
- OAuth/social login
- Multi-factor authentication (MFA)
- Business feature endpoints

_Reason:_ the MVP uses short-lived, **stateless** access tokens only. Client-side logout is handled by discarding the token; server-side revocation/refresh flows may be introduced in a future spec.

## Requirements

### Requirement 1: User Registration
**Objective:** As a new user, I want to register with an email and password, so that I can use PayPilot.

#### Acceptance Criteria
1. When a registration request is submitted with a valid email and password, the Auth module shall create a user with a securely hashed password and return a success response that excludes the password.
2. The Auth module shall normalize the email before persistence and lookup; normalization is **limited to** trimming surrounding whitespace and converting to lowercase, and shall **not** apply provider-specific rules such as removing dots or stripping `+` aliases.
3. The persistence layer shall enforce email uniqueness with a database-level unique constraint/index.
4. If the (normalized) email is already registered, then the Auth module shall reject the request with a 409 conflict using the canonical error envelope.
5. If duplicate registrations race concurrently, then the system shall still guarantee a single user per email (the database constraint is the source of truth, surfaced as 409) without creating duplicates.
6. If the email or password fails validation rules, then the API service shall reject the request with a 400 validation error.
7. The Auth module shall never store or return a user's password in plaintext.

> **Note:** For the MVP, returning 409 on duplicate registration is an accepted product/security tradeoff (it reveals that an email is registered). This may be revisited when email verification or password reset flows are introduced.

### Requirement 2: Login and Token Issuance
**Objective:** As a registered user, I want to log in and receive a JWT, so that I can authenticate subsequent requests.

#### Acceptance Criteria
1. When valid credentials are submitted, the Auth module shall issue a signed JWT access token.
2. The JWT payload shall include `sub` as the authenticated user's identifier and `exp` as the expiration claim.
3. The JWT payload shall not include sensitive data such as the password hash, tokens, secrets, or personal financial data.
4. If the credentials are invalid, then the Auth module shall respond with 401 and shall not reveal whether the email or the password was incorrect.
5. The Auth module shall sign tokens using a secret sourced from validated environment configuration.
6. The issued access token shall be short-lived (bounded expiration).
7. The design shall explicitly define: the JWT signing algorithm; the token TTL; whether to include `iat`, `iss`, and `aud`; and how unexpected/forged algorithms are rejected (e.g. pinning the allowed algorithm).

### Requirement 3: Authentication Guard
**Objective:** As the system, I want to protect endpoints, so that only authenticated requests reach business logic.

#### Acceptance Criteria
1. While a request targets a protected endpoint, the API service shall require a valid JWT presented as an `Authorization: Bearer` token.
2. If the token is missing, malformed, or expired, then the API service shall reject the request with 401 before executing business logic.
3. When a valid token is presented, the API service shall make the authenticated user's identity available to request handlers.
4. Where an endpoint is explicitly marked public (e.g. registration, login, health checks), the API service shall allow unauthenticated access.
5. If a token belongs to a disabled or deleted user, then the API service shall reject the request, prevent access to protected resources, and respond using the canonical error envelope without revealing unnecessary account-state details. (The design decides whether this is 401 or 403.)

> **Design must address:** since the MVP uses stateless access tokens, explain how the guard verifies that the token `sub` still refers to an **active** user (e.g. a per-request user lookup / active-status check), and the latency/consistency tradeoff of that choice.

### Requirement 4: Per-User Data Isolation
**Objective:** As a user, I want my data isolated, so that no other user can read or modify it.

#### Acceptance Criteria
1. The system shall associate every user-owned record with the owning user's identifier.
2. While handling an authenticated request, the system shall scope data queries to the authenticated user.
3. If a user attempts to read or modify a record owned by another user, then the system shall deny the operation and shall not reveal whether the record exists.
4. The system shall derive the owning user from the authenticated token, never from client-supplied input.
5. The Auth module shall provide reusable authorization primitives/helpers so future services and repositories can enforce user ownership consistently.
6. The per-user isolation baseline shall be tested **without** introducing production business endpoints; a test-only owned resource/module may be declared inside the test suite to validate it. No transactions, recurring bills, cards, invoices, dashboard, or other financial business features are added in this spec.

> **Design must decide:** whether cross-user resource access returns `403` or a generic `404`-like response — while preserving AC3 (the API must not reveal whether the record exists).

### Requirement 5: Password Security
**Objective:** As a security-conscious system, I want strong password handling, so that credentials are protected.

#### Acceptance Criteria
1. The Auth module shall require passwords to be at least 12 characters long.
2. The Auth module shall accept long passphrases of at least 64 characters and shall not silently truncate passwords.
3. If a password exceeds the maximum allowed length (256 characters), then the Auth module shall reject it with a 400 validation error rather than truncating it.
4. The Auth module shall allow spaces and common printable characters in passwords.
5. The Auth module shall not require composition rules (uppercase/lowercase/number/special character) unless the design provides a strong, documented reason.
6. The Auth module shall hash passwords with a strong, salted, adaptive password-hashing algorithm before persistence; the exact library/algorithm and cost parameters are decided in the design phase.
7. The system shall never log passwords, password hashes, or tokens.

### Requirement 6: Token and Secret Configuration
**Objective:** As an operator, I want auth secrets managed via validated config, so that the app is secure and fails fast.

#### Acceptance Criteria
1. The system shall load the JWT signing secret and token expiration from validated environment configuration.
2. The JWT signing secret shall meet a minimum length/entropy policy defined in the design.
3. If the JWT signing secret is missing, too short, malformed, or otherwise invalid at startup, then the application shall fail to start.
4. Startup configuration errors shall report the offending variable name without exposing its value.
5. The system shall not commit JWT secrets or credentials to the repository.

### Requirement 7: Authentication Error Handling
**Objective:** As an API consumer, I want consistent auth errors, so that clients can handle them predictably.

#### Acceptance Criteria
1. The API service shall represent authentication and authorization failures using the canonical error envelope established by the foundation.
2. When authentication fails the API service shall respond with 401; when authorization fails, with 403; and when a uniqueness conflict occurs, with 409.
3. The API service shall include the request id in authentication error responses.

### Requirement 8: Security Logging and Test Coverage
**Objective:** As a maintainer, I want auth-critical paths observable and tested, so that regressions are caught early.

#### Acceptance Criteria
1. The system shall not log raw JWTs.
2. The system shall not log `Authorization` headers.
3. The system shall not log passwords.
4. The system shall not log password hashes.
5. The system shall not log credential-validation inputs.
6. The system shall not log full, unmasked email addresses.
7. Auth logs MAY include the event type, request id, result (success/failure), and the user id when it is safely known.
8. The system shall log authentication attempts and authorization denials with request-id correlation and without sensitive data.
9. The system shall cover registration, login, token validation, and per-user isolation with automated tests.

### Requirement 9: Safe Authenticated User Profile
**Objective:** As an authenticated user, I want to retrieve my safe user profile, so that the frontend can identify the current session without exposing sensitive data.

#### Acceptance Criteria
1. When an authenticated request is made to the current-user endpoint, the API service shall return the authenticated user's safe profile.
2. The safe profile shall exclude the password hash, tokens, secrets, and internal auth fields.
3. If the token is invalid, expired, or belongs to a disabled/deleted user, then the endpoint shall return an authentication error using the canonical error envelope.
4. The endpoint shall be protected by the authentication guard.

> Endpoint shape is decided in the design phase; the likely route is `GET /api/v1/auth/me`.

### Requirement 10: Authentication Abuse Protection
**Objective:** As the system, I want to limit repeated authentication attempts, so that login and registration endpoints are protected against brute-force and abuse.

#### Acceptance Criteria
1. The API service shall apply rate limiting to login attempts.
2. The API service shall apply rate limiting to registration attempts.
3. If a client exceeds the configured rate limit, then the API service shall respond with `429 Too Many Requests` using the canonical error envelope.
4. Rate-limit responses shall not reveal whether an account exists.
5. Rate-limit events shall be logged with request-id correlation and without sensitive data.
6. The concrete rate-limit storage and configuration shall be decided in the design phase.
7. The design shall not introduce Redis or jobs infrastructure unless explicitly justified; an in-memory/local limiter is acceptable for the MVP if documented as non-production-grade.
