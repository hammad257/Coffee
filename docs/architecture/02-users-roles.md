# Module 2 — Users & Roles

Staff CRUD, role-based access control, and the permissions matrix that every later module checks against. Module 1 issues tokens; this module decides what the holder of a token is allowed to do.

## Scope

**Ships:**
- User CRUD (`/users`)
- `Permission` table + `UserPermission` join (additive grants on top of role)
- `PermissionsGuard` and `@RequirePermissions(...)` decorator
- Role → default-permissions matrix (seeded)
- Password change for self (`/users/me/password`)
- Admin password reset for any user (`/users/:id/reset-password`)
- Soft delete + reinstate

**Does NOT ship:**
- Self-service forgot-password email flow
- Multi-store / scope filtering (single-tenant in v1)
- Activity feed UI (audit log table exists from Module 0; surfacing it is its own ticket)

## UI screens this module powers

- **Settings → Staff** (not in screenshots but implied by Manager Dashboard sidebar)
  - Table of users: name, email, role, status, last login
  - "Add Staff" button → form
  - Row actions: Edit, Reset Password, Suspend / Reactivate, Delete

## Roles & permissions matrix

Roles come from `UserRole` enum in Module 1. Each role has a **default permission set** that is automatically granted when a user is created with that role. Permissions are strings of the form `"<resource>.<action>"`.

| Permission              | ADMIN | MANAGER | CASHIER | BARISTA | WAITER |
|-------------------------|:-----:|:-------:|:-------:|:-------:|:------:|
| `user.read`             |   ✓   |    ✓    |         |         |        |
| `user.write`            |   ✓   |         |         |         |        |
| `user.delete`           |   ✓   |         |         |         |        |
| `category.read`         |   ✓   |    ✓    |    ✓    |    ✓    |   ✓    |
| `category.write`        |   ✓   |    ✓    |         |         |        |
| `product.read`          |   ✓   |    ✓    |    ✓    |    ✓    |   ✓    |
| `product.write`         |   ✓   |    ✓    |         |         |        |
| `inventory.read`        |   ✓   |    ✓    |    ✓    |    ✓    |        |
| `inventory.adjust`      |   ✓   |    ✓    |         |         |        |
| `order.read`            |   ✓   |    ✓    |    ✓    |    ✓    |   ✓    |
| `order.create`          |   ✓   |    ✓    |    ✓    |         |   ✓    |
| `order.update_status`   |   ✓   |    ✓    |    ✓    |    ✓    |   ✓    |
| `order.refund`          |   ✓   |    ✓    |         |         |        |
| `order.void`            |   ✓   |    ✓    |         |         |        |
| `payment.process`       |   ✓   |    ✓    |    ✓    |         |        |
| `payment.refund`        |   ✓   |    ✓    |         |         |        |
| `table.read`            |   ✓   |    ✓    |    ✓    |         |   ✓    |
| `table.write`           |   ✓   |    ✓    |         |         |        |
| `dashboard.read`        |   ✓   |    ✓    |         |         |        |
| `dashboard.export`      |   ✓   |    ✓    |         |         |        |
| `audit.read`            |   ✓   |         |         |         |        |

Admins can grant any individual permission to any user via `UserPermission` rows — the runtime check is `roleDefaults[role] ∪ explicitGrants`.

## Prisma schema

```prisma
// extends User from Module 1
model User {
  // ... fields from Module 1 ...
  permissions UserPermission[]
  // orders, payments, etc. relations get added by later modules
}

model Permission {
  id          String           @id @default(uuid())
  key         String           @unique  // "product.write"
  description String
  users       UserPermission[]

  @@map("permissions")
}

model UserPermission {
  userId       String
  permissionId String
  user         User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  grantedAt    DateTime   @default(now())
  grantedById  String

  @@id([userId, permissionId])
  @@index([userId])
  @@map("user_permissions")
}
```

## Seed data

Beyond the 1 admin from Module 1, seed:

- The full `Permission` row set (every key from the matrix above).
- A demo `MANAGER` and one `CASHIER` for local development:

```ts
[
  { email: "manager@elitedeparis.com", name: "Sara Lin",  role: "MANAGER", password: "ChangeMe!2026" },
  { email: "cashier@elitedeparis.com", name: "Omar Reza", role: "CASHIER", password: "ChangeMe!2026" },
]
```

## DTOs

```ts
// src/modules/users/dto/create-user.dto.ts
export class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(2) name: string;
  @IsEnum(UserRole) role: UserRole;
  @IsString() @MinLength(8) password: string;
  @IsArray() @IsOptional() extraPermissions?: string[]; // permission keys
}

// src/modules/users/dto/update-user.dto.ts
export class UpdateUserDto {
  @IsString() @IsOptional() name?: string;
  @IsEnum(UserRole) @IsOptional() role?: UserRole;
  @IsArray() @IsOptional() extraPermissions?: string[];
}

// src/modules/users/dto/change-password.dto.ts
export class ChangePasswordDto {
  @IsString() @MinLength(8) currentPassword: string;
  @IsString() @MinLength(8) newPassword: string;
}

// src/modules/users/dto/reset-password.dto.ts (admin)
export class ResetPasswordDto {
  @IsString() @MinLength(8) newPassword: string;
}
```

## Endpoints

### GET /users

**Query:** `?role=MANAGER&status=ACTIVE&search=elias&page=1&pageSize=20`

**200 OK:**
```json
{
  "items": [
    { "id": "uuid", "email": "...", "name": "...", "role": "MANAGER", "status": "ACTIVE", "lastLoginAt": "2026-05-07T11:30:00Z" }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 4
}
```

**Permissions:** `user.read`.

### POST /users

**Request:**
```json
{
  "email": "barista1@elitedeparis.com",
  "name": "Maya Patel",
  "role": "BARISTA",
  "password": "TempPass!2026",
  "extraPermissions": ["inventory.adjust"]
}
```

**201 Created:** the user object.

**Errors:**
- `409 EMAIL_TAKEN`
- `400 INVALID_PERMISSION_KEY`

**Logic:**
1. Validate email uniqueness.
2. Hash password (argon2id from Module 1).
3. Create user row.
4. Create `UserPermission` rows for any `extraPermissions` (validate each key exists in `Permission` table).
5. Audit log: `user.create`.

**Permissions:** `user.write`.

### GET /users/:id

**200 OK:** user with `permissions: [...effective-permission-keys]` (role defaults ∪ extras).

**Permissions:** `user.read`.

### PATCH /users/:id

**Request:** any subset of `name`, `role`, `extraPermissions`.

**Logic:**
- If `extraPermissions` is provided, replace the user's `UserPermission` rows wholesale (set semantics, not append).
- If `role` changes, no automatic permission migration — the new role's defaults apply, plus whatever extras were explicitly kept.
- Cannot change own role (prevents accidental self-lockout).

**Permissions:** `user.write`.

### DELETE /users/:id

**Response:** `204 No Content`

**Logic:** soft delete (`deletedAt = now()`) + revoke all that user's refresh tokens (force sign-out everywhere).

**Errors:**
- `403 CANNOT_DELETE_SELF`
- `403 CANNOT_DELETE_LAST_ADMIN` — guard against locking everyone out

**Permissions:** `user.delete`.

### POST /users/:id/reinstate

Restore a soft-deleted user (`deletedAt = null`).

**Permissions:** `user.write`.

### POST /users/:id/suspend & /reactivate

Toggle `status` between `ACTIVE` and `SUSPENDED`. Suspending also revokes all refresh tokens.

**Permissions:** `user.write`.

### POST /users/:id/reset-password (admin)

**Request:** `{ "newPassword": "..." }`

**Logic:** hash + replace `passwordHash`, revoke all the user's refresh tokens, audit log `user.reset_password`.

**Permissions:** `user.write` AND `role === ADMIN` (extra check — managers can't reset admin passwords).

### POST /users/me/password (self)

**Request:** `{ "currentPassword": "...", "newPassword": "..." }`

**Logic:** verify `currentPassword`, then replace. Do **not** revoke refresh tokens for self-change (user is sitting at the device).

**Permissions:** authenticated.

## PermissionsGuard

```ts
// src/common/guards/permissions.guard.ts
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector,
              private readonly users: UsersService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      'permissions', [ctx.getHandler(), ctx.getClass()],
    );
    if (!required?.length) return true;

    const req = ctx.switchToHttp().getRequest();
    const userPerms = await this.users.getEffectivePermissions(req.user.sub);
    return required.every((p) => userPerms.includes(p));
  }
}

// src/common/decorators/require-permissions.decorator.ts
export const RequirePermissions = (...keys: string[]) =>
  SetMetadata('permissions', keys);
```

Every later module's controllers use `@RequirePermissions('product.write')` etc.

The effective set is cached in Redis per `userId` for 60 seconds; cache is invalidated on user update / role change / permission grant.

## Acceptance tests

1. Manager creates a CASHIER → 201, cashier can call `POST /orders`, cannot call `DELETE /products/:id`
2. Cashier hits `/users` → 403
3. Admin grants `inventory.adjust` to a CASHIER → cashier can now adjust stock
4. Admin tries to delete themselves → 403 `CANNOT_DELETE_SELF`
5. Admin tries to delete the last remaining ADMIN → 403 `CANNOT_DELETE_LAST_ADMIN`
6. Suspended user attempts to use existing access token → 401 (Module 1 `/auth/me` rejects)
7. Suspending a user revokes their refresh tokens
8. Admin resets a user's password → user's old refresh tokens are revoked
9. Self-change password works without revoking own refresh tokens
10. Effective-permissions endpoint returns role defaults ∪ extras

## Done when

- All endpoints pass tests
- Frontend Settings → Staff page wired and working
- Permissions cache invalidates correctly on grant/role-change
- The matrix above is checked into `docs/architecture/02-users-roles.md` (this file) and the `Permission` seed mirrors it exactly

## Out of scope (future tickets)

- Activity feed UI
- Bulk import (CSV)
- Per-store scope filtering (only one store in v1)
- Forgot-password email flow
