# Module 0 — Architecture Overview

The blueprint for **Élite de Paris — Tea & Coffee** POS backend. This document is the entry point for every other module file in this folder. Read this first, then drill into individual modules in order.

## Product summary

A multi-channel POS + back-office for a single coffee roastery (architecture is multi-tenant ready, but ships as single-tenant for v1). Staff sign in to a **Manager Dashboard** (web) and a **POS terminal** (web/tablet) to:

- Manage the menu (products, variants, categories, add-ons)
- Track inventory in real time, with low-stock alerts
- Take orders from four channels: **Onsite (dine-in)**, **Take-away**, **Online ordering**, **Point-of-Sale (counter)**
- Process payments (cash / card / online gateway)
- Watch live KPIs on the dashboard (today's revenue, active orders, top products, table occupancy)

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Node.js 20 LTS | Long-term support |
| Framework | NestJS 11 | Modular, opinionated, good for layered domains |
| ORM | Prisma 7 | Type-safe DB access, migrations, schema-as-code |
| Database | PostgreSQL 16 | Strong relational model, JSONB for flexible fields |
| Cache / queues | Redis 7 | Rate limiting, session blacklist, BullMQ jobs |
| Auth | JWT (HS256) + refresh-token rotation | Stateless API, secure refresh flow |
| File storage | S3-compatible (MinIO local, R2/S3 prod) | Product images |
| Realtime | WebSocket gateway (`@nestjs/websockets`) | Live KPIs, new-order push to kitchen / POS |
| Validation | `class-validator` + `class-transformer` | DTO-driven |
| Docs | OpenAPI via `@nestjs/swagger` at `/docs` | Frontend contract |
| Tests | Jest (unit) + Supertest (e2e) | Standard Nest stack |
| Background jobs | BullMQ (Redis-backed) | Low-stock alerts, daily report generation, auto-refill checks |

## Module map

Modules ship in this order. Each later module assumes the earlier ones exist.

```
00 Overview            ← you are here
01 Auth & Login        ← sign-in, JWT, refresh
02 Users & Roles       ← staff CRUD, RBAC, permissions
03 Categories          ← Coffee / Equipment / Syrups / …
04 Products            ← items + variants (Small/Medium/Large) + add-ons
05 Inventory           ← stock, movements, low-stock alerts
06 Orders              ← Onsite / Take-away / Online / POS
07 Tables              ← floor plan, sessions, occupancy
08 Payments            ← cash / card / online, refunds, receipts
09 Dashboard           ← KPIs, sales analytics, top products
10 Notifications       ← low-stock, new-order push, audit log
```

## High-level system flow

```
                  ┌──────────────────────────────────────────────┐
                  │           Manager Web Dashboard              │
                  │     (Next.js · React · TanStack Query)       │
                  └──────────────────────┬───────────────────────┘
                                         │ HTTPS / WSS
   ┌──────────────────┐                  │                  ┌──────────────────┐
   │   POS Terminal   │──────────────────┤                  │  Customer-facing │
   │   (web tablet)   │                  │                  │  Online Ordering │
   └──────────────────┘                  │                  └────────┬─────────┘
                                         ▼                           │
                          ┌───────────────────────────┐               │
                          │   NestJS API Gateway      │◄──────────────┘
                          │  (Auth · RBAC · Rate-lim) │
                          └─────────┬─────────────────┘
                                    │
        ┌──────────┬──────────┬─────┴──────┬──────────┬──────────┐
        ▼          ▼          ▼            ▼          ▼          ▼
    ┌───────┐ ┌────────┐ ┌─────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐
    │ Auth  │ │ Users  │ │Products │ │ Orders   │ │Payment │ │Dashboard │
    │ Mod   │ │  Mod   │ │  Mod    │ │  Mod     │ │  Mod   │ │  Mod     │
    └───┬───┘ └───┬────┘ └────┬────┘ └────┬─────┘ └───┬────┘ └────┬─────┘
        │         │           │           │           │           │
        ▼         ▼           ▼           ▼           ▼           ▼
    ┌───────────────────────────────────────────────────────────────┐
    │                  PostgreSQL  ·  Prisma  ·  Migrations         │
    └───────────────────────────────────────────────────────────────┘
                │                      │                      │
                ▼                      ▼                      ▼
          ┌──────────┐           ┌──────────┐          ┌────────────┐
          │  Redis   │           │  BullMQ  │          │  S3/MinIO  │
          │  cache   │           │  jobs    │          │  images    │
          └──────────┘           └──────────┘          └────────────┘
```

## End-to-end order flow (the happy path)

This is the canonical journey. Every module exists to support a step in this flow.

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. Cashier signs in on POS terminal                                │
│     → POST /auth/login (Module 01)                                  │
│     → JWT access + refresh tokens issued                            │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. Cashier picks "Onsite", selects Table 7                         │
│     → POST /tables/7/sessions  (Module 07)                          │
│     → Returns session_id, status=OPEN                               │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. Cashier adds items: 1× Oat Milk Latte (Medium) + 1× Croissant   │
│     → POST /orders                                                  │
│       { channel: "ONSITE", tableSessionId, items: [...] }           │
│     → Server validates: variant exists, stock available             │
│     → Reserves stock (Module 05 — INVENTORY_RESERVED movement)      │
│     → Creates Order + OrderItem rows (Module 06)                    │
│     → Emits "order.created" → WebSocket push to kitchen display     │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. Barista marks order PREPARING → READY                           │
│     → PATCH /orders/:id/status                                      │
│     → "order.status_changed" WebSocket event                        │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  5. Customer pays at the counter — cash $14.50                      │
│     → POST /payments                                                │
│       { orderId, method: "CASH", amount: 14.50, tendered: 20.00 }   │
│     → Payment row created, status=COMPLETED                         │
│     → Order.paymentStatus = PAID                                    │
│     → Stock movements settle (RESERVED → CONSUMED)                  │
│     → Receipt printed / emailed (Module 08)                         │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  6. Order marked COMPLETED · Table session closed                   │
│     → PATCH /orders/:id/status { status: "COMPLETED" }              │
│     → Table 7 freed → "table.freed" event                           │
│     → Dashboard KPIs update live (Module 09)                        │
│     → If any product hit low-stock threshold → notification         │
│       (Module 10) to manager + email                                │
└─────────────────────────────────────────────────────────────────────┘
```

## Entity relationship diagram (high level)

```
   User ──< RefreshToken
   User ──< Permission (via UserRole join)
   User ──< Order (cashierId)
   User ──< StockMovement (createdById)

   Category ──< Product
   Product  ──< ProductVariant
   Product  ──< ProductAddon
   Product  ──< ProductImage
   Product  ──< StockMovement

   Table ──< TableSession ──< Order (1:1 for ONSITE)
   Order ──< OrderItem ──< OrderItemAddon
   Order ──< Payment
   Order ──< OrderStatusHistory

   AuditLog (polymorphic — every write logs here)
```

Detailed Prisma schemas live inside each module file. The full assembled schema is the union of every module's `## Prisma schema` block.

## Folder layout

```
src/
├── main.ts
├── app.module.ts
├── common/
│   ├── decorators/        # @Public, @Roles, @CurrentUser
│   ├── guards/            # JwtAuthGuard, RolesGuard, PermissionsGuard
│   ├── filters/           # AllExceptionsFilter
│   ├── interceptors/      # AuditLogInterceptor, TransformInterceptor
│   ├── pipes/             # ValidationPipe (global)
│   └── prisma/            # PrismaModule, PrismaService
├── modules/
│   ├── auth/              # Module 01
│   ├── users/             # Module 02
│   ├── categories/        # Module 03
│   ├── products/          # Module 04
│   ├── inventory/         # Module 05
│   ├── orders/            # Module 06
│   ├── tables/            # Module 07
│   ├── payments/          # Module 08
│   ├── dashboard/         # Module 09
│   └── notifications/     # Module 10
└── jobs/                  # BullMQ processors (low-stock checker, daily report, …)

prisma/
├── schema.prisma          # Assembled from every module
├── migrations/
└── seed.ts                # Bootstraps: 1 ADMIN, 1 store, sample categories

docs/
└── architecture/          # ← this folder (00–10)
```

## Cross-cutting concerns

These are implemented once in `src/common/` and reused by every module. They are NOT documented in any single module file — they live here.

### 1. Global exception shape

Every error response has the same envelope:

```json
{
  "statusCode": 404,
  "errorCode": "PRODUCT_NOT_FOUND",
  "message": "Product cf-ey-001 not found",
  "details": { "productId": "cf-ey-001" },
  "timestamp": "2026-05-07T12:30:00Z",
  "path": "/products/cf-ey-001"
}
```

Implemented in `common/filters/all-exceptions.filter.ts`. Domain modules throw typed exceptions (`ProductNotFoundException`, `InsufficientStockException`, …); the filter maps them to HTTP codes + envelope.

### 2. Global validation pipe

```ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
}));
```

### 3. Audit log

Every state-changing endpoint is wrapped with `@AuditLog()` interceptor. The interceptor writes to an `audit_logs` table:

```prisma
model AuditLog {
  id          String   @id @default(uuid())
  actorId     String?
  action      String   // "product.update", "order.refund", "user.suspend"
  entityType  String   // "Product", "Order", "User"
  entityId    String
  diff        Json     // { before: {...}, after: {...} }
  ipAddress   String?
  userAgent   String?
  createdAt   DateTime @default(now())

  @@index([entityType, entityId])
  @@index([actorId, createdAt])
  @@map("audit_logs")
}
```

### 4. Global rate limiting

`@nestjs/throttler` with Redis store. Defaults:

- 100 req/min per IP for authenticated routes
- 5 req/min per IP for `POST /auth/login`
- 30 req/min per IP for `POST /orders` (anti-spam for online channel)

### 5. Money handling

- Stored as **integer cents** in DB (`BigInt`) — never `Float`.
- Serialised at API boundary as decimal string: `"14.50"`.
- A `Money` value object in `common/money/` handles arithmetic.
- All currency is implicitly the store's `defaultCurrency` (set in env). Multi-currency is out of scope for v1.

### 6. Soft delete

User-facing entities (`Product`, `Category`, `User`, `Table`) use `deletedAt: DateTime?`. A Prisma middleware filters them out of every read by default. Hard delete is an admin-only operation that requires `?hardDelete=true` query flag plus an audit log entry.

## Configuration & env vars

```env
# App
NODE_ENV=development
PORT=3000
CORS_ORIGINS=http://localhost:3001,http://localhost:3002

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/coffee

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_ACCESS_SECRET=<32+ bytes>
JWT_REFRESH_SECRET=<32+ bytes>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

# Argon2
ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2

# Storage
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=coffee-uploads
S3_REGION=us-east-1
S3_ACCESS_KEY=...
S3_SECRET_KEY=...

# Store defaults
STORE_NAME=Élite de Paris — Tea & Coffee
STORE_CURRENCY=USD
STORE_TIMEZONE=Asia/Karachi
STORE_LOW_STOCK_THRESHOLD=10

# Notifications
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
ALERT_EMAIL=manager@elitedeparis.com
```

## Build order & dependencies

```
01 Auth ──────────► everything else (provides @CurrentUser, guards)

02 Users ─────────► 03 Categories
                    04 Products       (creator/updater audit fields)
                    06 Orders         (cashier identity)
                    08 Payments

03 Categories ────► 04 Products

04 Products ──────► 05 Inventory      (stock movements reference products)
                    06 Orders         (order items reference variants)

05 Inventory ─────► 06 Orders         (orders reserve/consume stock)
                    10 Notifications  (low-stock alerts)

07 Tables  ───────► 06 Orders         (Onsite orders link to a table session)

06 Orders ────────► 08 Payments
                    09 Dashboard      (revenue & order KPIs)
                    10 Notifications  (new-order push)
```

## Done when (Module 0)

- This document committed to `docs/architecture/00-overview.md`
- All 10 module files committed and cross-linked
- Folder skeleton created in `src/modules/<each>` with empty `*.module.ts`
- `common/` folder scaffolded (Prisma, guards, filters, money)
- `.env.example` checked in matching the keys above
- `README.md` linked to `docs/architecture/00-overview.md`

## Out of scope (v1)

- Multi-tenant (multiple coffee shops on one DB)
- Multi-currency
- Loyalty program / customer accounts
- Kitchen display system as a separate app (we push events, the Manager Dashboard renders them)
- Inventory: ingredient-level tracking (we track sellable SKUs, not grams of beans)
- Self-checkout / customer-facing kiosk
- Hardware integrations beyond receipt printer (no scale, no cash drawer firmware)
- Accounting export (QuickBooks, Xero) — deferred to v1.1
- Mobile-native apps — web responsive only for v1
