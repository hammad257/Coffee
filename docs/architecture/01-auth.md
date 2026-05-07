# Module 1 — Auth & Login

The first module. Establishes the user model, password storage, and the JWT issuance/refresh flow. Every subsequent module assumes an authenticated request.

## Scope

**Ships:**
- `User` table (minimal — expanded in Module 2 Users & Roles)
- `RefreshToken` table
- `/auth/login`, `/auth/me`, `/auth/refresh`, `/auth/logout`
- Password hashing (argon2id)
- JWT signing / verification
- `JwtAuthGuard`, `RolesGuard`, `PermissionsGuard`, `@Public()`, `@Roles()`, `@CurrentUser()` decorators (re-used by every later module)
- Seed: 1 ADMIN user for first login

**Does NOT ship:**
- User CRUD (Module 2 — Users & Roles)
- Permissions matrix and runtime checks (Module 2)
- Self-service password reset (deferred — separate ticket)
- 2FA / SSO

## UI screens this module powers

- **Login screen** ("Welcome back. Please enter your credentials to access the manager dashboard.")
  - Email + password
  - "Remember this device for 30 days" checkbox → extends refresh-token TTL to 30d
  - "Forgot Password?" link → out of scope, ships as a `mailto:` for v1

## Prisma schema

```prisma
model User {
  id           String     @id @default(uuid())
  email        String     @unique
  passwordHash String
  name         String
  role         UserRole   @default(CASHIER)
  status       UserStatus @default(ACTIVE)
  lastLoginAt  DateTime?

  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  createdById  String?
  updatedById  String?
  deletedAt    DateTime?

  refreshTokens RefreshToken[]

  @@index([email])
  @@map("users")
}

enum UserRole {
  ADMIN       // full access, can manage staff
  MANAGER     // dashboard + product/inventory/orders, no staff CRUD
  CASHIER     // POS terminal, take orders, process payments
  BARISTA     // kitchen display, mark orders preparing/ready
  WAITER      // onsite-only, table service
}

enum UserStatus {
  ACTIVE
  SUSPENDED
}

model RefreshToken {
  id         String    @id @default(uuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique  // SHA-256 hex of the raw token
  issuedAt   DateTime  @default(now())
  expiresAt  DateTime
  revokedAt  DateTime?
  replacedBy String?   // id of the new token issued via rotation
  userAgent  String?
  ipAddress  String?
  rememberMe Boolean   @default(false)

  @@index([userId])
  @@index([tokenHash])
  @@map("refresh_tokens")
}
```

Note: `User.role` is a single enum on this table for Module 1. Module 2 (Users & Roles) keeps this column as the **primary role** for fast checks but adds a `Permission` table for granular grants.

## Seed data

```ts
// One root admin to bootstrap the system.
// Password should be changed on first login (separate ticket — out of scope here).
{
  email: "admin@elitedeparis.com",
  password: "ChangeMe!2026",   // hashed via argon2id at seed time
  role: "ADMIN",
  name: "Elias Karim",
}
```

## DTOs

```ts
// src/modules/auth/dto/login.dto.ts
export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsBoolean()
  @IsOptional()
  rememberMe?: boolean = false;
}

// src/modules/auth/dto/refresh.dto.ts
export class RefreshDto {
  @IsString()
  refreshToken: string;
}
```

## Endpoints

### POST /auth/login

**Request:**
```json
{ "email": "admin@elitedeparis.com", "password": "ChangeMe!2026", "rememberMe": true }
```

**200 OK:**
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "9f8a...",
  "user": {
    "id": "uuid",
    "email": "admin@elitedeparis.com",
    "name": "Elias Karim",
    "role": "ADMIN",
    "permissions": []
  }
}
```

**Errors:**
- `400 VALIDATION_FAILED` — missing or malformed email/password
- `401 UNAUTHORIZED` — bad credentials (don't leak which one is wrong)
- `403 FORBIDDEN` — account suspended (`status !== ACTIVE`)
- `429 RATE_LIMITED` — too many failed attempts

**Logic:**
1. Find user by email (case-insensitive). If not found → 401 with generic message.
2. Verify password with `argon2.verify(user.passwordHash, password)`. If false → 401 same generic message.
3. If `user.status !== ACTIVE` → 403.
4. Update `lastLoginAt = now()`.
5. Sign access token (JWT, 15 min): `{ sub: user.id, role: user.role, permissions: [], iat, exp }`.
6. Generate refresh token: 32 random bytes, base64url-encoded. Hash (SHA-256) → store row in `refresh_tokens`.
   - `expiresAt = now() + 7d` (default) or `now() + 30d` if `rememberMe = true`.
7. Return raw refreshToken to client (DB only stores the hash).

**Permissions:** Public (no auth required). Mark with `@Public()` decorator.

### GET /auth/me

**Header:** `Authorization: Bearer <accessToken>`

**200 OK:**
```json
{
  "user": {
    "id": "uuid",
    "email": "elias@elitedeparis.com",
    "name": "Elias Karim",
    "role": "MANAGER",
    "permissions": ["product.write", "order.refund"]
  }
}
```

**Errors:**
- `401 UNAUTHORIZED` — token missing, invalid, or expired

**Logic:** read `sub` from validated JWT, fetch user. If user is missing, soft-deleted, or suspended → 401.

**Permissions:** authenticated user.

### POST /auth/refresh

**Request:**
```json
{ "refreshToken": "9f8a..." }
```

**200 OK:**
```json
{ "accessToken": "...", "refreshToken": "..." }
```

**Errors:**
- `401 UNAUTHORIZED` — token missing, invalid, expired, revoked, or already-rotated

**Logic (rotation, single-use):**
1. Hash incoming token (SHA-256).
2. Look up row by `tokenHash`. If not found → 401.
3. If `revokedAt` is set → **token reuse detected**. Revoke ALL refresh tokens for that user (potential theft). Return 401.
4. If `expiresAt < now()` → 401.
5. Mark current token revoked: `revokedAt = now()`, `replacedBy = newTokenId`.
6. Issue new access + refresh token (preserving `rememberMe` flag's expiry window). Return both.

**Permissions:** Public (the refresh token itself is the credential). `@Public()`.

### POST /auth/logout

**Header:** `Authorization: Bearer <accessToken>`
**Body (optional):** `{ "refreshToken": "..." }`

**204 No Content**

**Logic:**
- If a `refreshToken` is provided, revoke just that one (sign-out from this device).
- Otherwise, revoke ALL of the user's refresh tokens (sign-out everywhere).
- The access token itself remains valid until its 15-min expiry — that's acceptable for stateless JWT. Frontend simply discards it.

**Permissions:** authenticated user.

## Password hashing

```ts
import * as argon2 from 'argon2';

await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19456,  // 19 MiB — OWASP-recommended
  timeCost: 2,
  parallelism: 1,
});
```

Cost parameters configurable via env vars so they can be tuned per deployment.

## JWT setup

```ts
JwtModule.registerAsync({
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => ({
    secret: cfg.get<string>('JWT_ACCESS_SECRET'),
    signOptions: { expiresIn: '15m', algorithm: 'HS256' },
  }),
});
```

- Algorithm: **HS256**, secret in `JWT_ACCESS_SECRET` env var (256-bit minimum).
- Refresh tokens are NOT JWTs — they're opaque random strings, only the hash stored server-side.

## Guards & decorators

```ts
// jwt-auth.guard.ts — attaches req.user from validated JWT
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

// public.decorator.ts — opt-out for /auth/login etc.
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// roles.decorator.ts
export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);

// roles.guard.ts — checks @Roles(...) against req.user.role
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean { /* ... */ }
}

// current-user.decorator.ts — injects req.user into handler params
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user,
);
```

`JwtAuthGuard` is registered globally; `@Public()` opts an endpoint out. `RolesGuard` runs after.

## Rate limiting

```ts
@Throttle({ default: { limit: 5, ttl: 60_000 } })  // 5/min/IP
@Public()
@Post('login')
async login(@Body() dto: LoginDto) { ... }
```

Plus per-email tracking (Redis incr): 10 failed attempts / hour locks the account for 15 min, regardless of IP.

## Frontend integration

The login page (screenshot 1) hits `POST /auth/login` and stores tokens. Every dashboard / POS page is wrapped in an `<AuthGuard>` that:

1. On mount, calls `GET /auth/me` with the stored access token.
2. On 401, calls `POST /auth/refresh` once, retries the request, otherwise redirects to `/login`.
3. Displays the user's name + role in the header (e.g. "Good Morning, Elias" on the dashboard).

```ts
// New behavior — sketch:
async function signIn({ email, password, rememberMe }) {
  const res = await api('/auth/login', { method: 'POST', body: { email, password, rememberMe } });
  storeTokens(res.accessToken, res.refreshToken);
  setUser(res.user);
}
```

**Token storage — Phase 1 (MVP):** `localStorage["pos.access"]` and `localStorage["pos.refresh"]`. Simple, but vulnerable to XSS. Acceptable for the MVP given the small attack surface and internal user base.

**Token storage — Phase 2 (recommended before prod):** refresh token in HTTP-only secure cookie (auto-sent on `/auth/refresh`); access token in JS memory only (recovered via refresh-token cookie on page reload).

## Acceptance tests (backend)

Minimum tests this module ships with:

1. Login with correct credentials → 200 + tokens + user payload
2. Login with wrong password → 401, generic message ("Invalid credentials")
3. Login with unknown email → 401, **same** generic message (don't leak whether the email exists)
4. Login with suspended account → 403
5. Login rate limit kicks in after 5 attempts → 429
6. Login with `rememberMe: true` → refresh-token row's `expiresAt` is 30 days out
7. `/auth/me` with valid token → 200 + user
8. `/auth/me` with expired token → 401
9. `/auth/me` with token of soft-deleted user → 401
10. Refresh with valid token → 200 + new pair, old token marked `revokedAt`
11. Refresh with already-revoked token → 401 + ALL user's refresh tokens revoked (theft response)
12. Logout with refreshToken in body → 204, that refresh token revoked
13. Logout without body → 204, all user's refresh tokens revoked

## Done when

- Backend: endpoints + tests pass; admin user seeded; `/docs` OpenAPI shows the routes
- Frontend: login flow works end-to-end against the real API
- Manager Dashboard loads while authenticated; signing out + back in works
- 7-day (or 30-day with rememberMe) session-stickiness via refresh works
- A 429 returned for hammered logins, surfaced in the UI as "Too many attempts — try again later"

## Out of scope (future tickets)

- Forgot password / password reset email flow
- Email verification on signup
- 2FA / TOTP
- SSO (Google / Microsoft / SAML)
- Forced password change on first login
- Account lockout admin UI
