# Module 7 — Tables

The dine-in floor plan. Tracks each physical table, its capacity, status, and the **session** that links a seated party to one or more orders. The dashboard's "TABLES OCCUPIED · 22 / 26" tile and the Onsite order flow are powered by this module.

## Scope

**Ships:**
- `Table` table — the physical seating unit
- `TableSession` table — the seating event (open until the party leaves)
- CRUD: `/tables` (manager-only setup) and `/tables/:id/sessions`
- Status state machine: table is `AVAILABLE | OCCUPIED | RESERVED | DIRTY | OUT_OF_SERVICE`
- Session state machine: `OPEN → CLOSED` (or `CANCELLED`)
- Bill split / merge tables (merge two sessions into one for combined parties)
- Real-time floor plan WebSocket events
- Reservation booking (lightweight) — name + party size + time, blocks the table

**Does NOT ship:**
- Online customer-facing reservation booking page (waiter/manager creates them in-store)
- Per-seat ordering (one ticket per chair) — table-level only in v1
- QR-code-at-table self-ordering — deferred to v1.1
- Floor-plan visual editor — manager defines tables via list, not a drag-drop SVG editor in v1

## UI screens this module powers

- **Onsite** sidebar item — grid of tables, colour-coded by status
- **Dashboard** — "TABLES OCCUPIED · 22/26" tile (screenshot 3) at "85% Capacity"
- **POS create-order flow** — when channel = `ONSITE`, picker shows available tables
- **Reservations** view — list of upcoming bookings

## Status lifecycle

### Table status

```
        ┌─────────────┐
        │  AVAILABLE  │ ◄─────────────────────┐
        └──────┬──────┘                       │
               │ session opened               │
               ▼                              │
        ┌─────────────┐                       │
        │  OCCUPIED   │                       │
        └──────┬──────┘                       │
               │ session closed               │
               ▼                              │
        ┌─────────────┐  marked clean         │
        │    DIRTY    │ ──────────────────────┘
        └─────────────┘

   RESERVED       — booking exists for the upcoming hour
   OUT_OF_SERVICE — manually disabled (broken chair, repaint)
```

A `DIRTY` step is optional; manager can toggle whether tables auto-flip to `DIRTY` on session close (config flag `TABLES_REQUIRE_BUSSING`). In v1 default is **off** — tables go straight `OCCUPIED → AVAILABLE`.

### Session status

```
   OPEN ─────────► CLOSED        (party paid, left)
        ─────────► CANCELLED     (party walked out before ordering / wrong seating)
```

A session can have multiple orders attached (a party can split bills, or order rounds). The session closes when:
- All linked orders are `COMPLETED` or `CANCELLED`
- Cashier explicitly clicks "Close table" (which validates the above)

## Prisma schema

```prisma
model Table {
  id          String       @id @default(uuid())
  number      String       @unique           // "T-01", "T-12", "Bar-3"
  label       String?                        // "Window seat", "Patio left"
  capacity    Int          @default(2)
  zone        String?                        // "Indoor", "Patio", "Bar", "Mezzanine"
  status      TableStatus  @default(AVAILABLE)
  posX        Int?                           // optional floor-plan coordinates (for future visual editor)
  posY        Int?
  isActive    Boolean      @default(true)    // false = OUT_OF_SERVICE without losing the row

  sessions    TableSession[]
  reservations Reservation[]

  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  deletedAt   DateTime?

  @@index([status, isActive])
  @@map("tables")
}

enum TableStatus {
  AVAILABLE
  OCCUPIED
  RESERVED
  DIRTY
  OUT_OF_SERVICE
}

model TableSession {
  id           String          @id @default(uuid())
  tableId      String
  table        Table           @relation(fields: [tableId], references: [id])

  status       SessionStatus   @default(OPEN)
  partySize    Int             @default(1)
  customerName String?                          // free-text
  notes        String?

  openedById   String                            // user (waiter/cashier)
  closedById   String?
  openedAt     DateTime        @default(now())
  closedAt     DateTime?

  // For "merged tables" workflow: a session may bring siblings under one roof
  mergedIntoId String?                           // points to the umbrella session
  mergedFrom   TableSession[]  @relation("Merged")
  parent       TableSession?   @relation("Merged", fields: [mergedIntoId], references: [id])

  orders       Order[]                           // Module 6

  @@index([tableId, status])
  @@index([status, openedAt])
  @@map("table_sessions")
}

enum SessionStatus {
  OPEN
  CLOSED
  CANCELLED
}

model Reservation {
  id            String    @id @default(uuid())
  tableId       String
  table         Table     @relation(fields: [tableId], references: [id])

  customerName  String
  customerPhone String?
  partySize     Int
  reservedFor   DateTime                         // start time
  durationMin   Int       @default(90)
  notes         String?
  status        ReservationStatus @default(BOOKED)

  createdById   String
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([tableId, reservedFor])
  @@index([status, reservedFor])
  @@map("reservations")
}

enum ReservationStatus { BOOKED SEATED NO_SHOW CANCELLED }
```

### Why a session entity?

A session decouples "the table" from "the bill". Two scenarios this enables:

1. **Multiple bills, one table.** A group of 4 wants to split — one session, two orders, each with its own payment.
2. **Multiple tables, one bill.** Couple sat at T-3, friends arrive, push two tables together — merge T-3 and T-4 into one umbrella session, all orders go on one ticket.

Without a session, both scenarios force ad-hoc workarounds. With a session, the `Order → TableSession → Table` chain stays clean.

## DTOs

```ts
export class CreateTableDto {
  @IsString() @MinLength(1) @MaxLength(20) number: string;
  @IsString() @IsOptional() label?: string;
  @IsInt() @Min(1) @Max(40) capacity: number;
  @IsString() @IsOptional() zone?: string;
}

export class UpdateTableDto extends PartialType(CreateTableDto) {
  @IsBoolean() @IsOptional() isActive?: boolean;
}

export class OpenSessionDto {
  @IsInt() @Min(1) partySize: number;
  @IsString() @IsOptional() customerName?: string;
  @IsString() @IsOptional() notes?: string;
}

export class CloseSessionDto {
  @IsBoolean() @IsOptional() force?: boolean;     // manager override even if orders unpaid
}

export class MergeSessionsDto {
  @IsArray() @ArrayMinSize(2) @IsUUID('4', { each: true }) sessionIds: string[];
  // The first id in the array becomes the umbrella session.
}

export class CreateReservationDto {
  @IsUUID('4') tableId: string;
  @IsString() customerName: string;
  @IsPhoneNumber() @IsOptional() customerPhone?: string;
  @IsInt() @Min(1) partySize: number;
  @IsDateString() reservedFor: string;
  @IsInt() @Min(15) @Max(360) @IsOptional() durationMin?: number;
  @IsString() @IsOptional() notes?: string;
}
```

## Endpoints

### GET /tables

**Query:** `?zone=Patio&status=AVAILABLE&minCapacity=4`

**200 OK:**
```json
{
  "items": [
    {
      "id": "uuid",
      "number": "T-12",
      "capacity": 4,
      "zone": "Patio",
      "status": "OCCUPIED",
      "currentSessionId": "uuid",
      "currentSession": {
        "openedAt": "2026-05-07T11:42:00Z",
        "partySize": 3,
        "customerName": "Khan party"
      }
    }
  ],
  "summary": { "total": 26, "available": 4, "occupied": 22, "reserved": 0, "dirty": 0, "outOfService": 0 }
}
```

`summary` powers the dashboard tile.

**Permissions:** `table.read`.

### POST /tables

Manager seeds tables (one-time per launch + future expansions).

**Permissions:** `table.write`.

### PATCH /tables/:id

Update label, capacity, zone, isActive.

**Errors:**
- `409 TABLE_HAS_OPEN_SESSION` — cannot toggle `isActive=false` while occupied

**Permissions:** `table.write`.

### DELETE /tables/:id

Soft delete. Refused if the table has any historical sessions in the last 30 days (audit window).

**Permissions:** `table.write`.

### POST /tables/:id/sessions

Open a session — "seat this party".

**Logic:**
1. Verify table is `AVAILABLE`. (`RESERVED` → check if reservation is for this party; `DIRTY/OUT_OF_SERVICE` → 409.)
2. Insert `TableSession` row, status `OPEN`.
3. Update `Table.status = OCCUPIED`.
4. Emit `table.status_changed` and `session.opened` WebSocket events.

**201 Created:** the session.

**Errors:**
- `409 TABLE_NOT_AVAILABLE` (with current status in body)

**Permissions:** `order.create` (waiters open sessions when seating; cashiers do too).

### GET /tables/:id/sessions/current

Returns the OPEN session, or 404 if none. Used by POS when picking a table.

### POST /sessions/:id/close

Close a session.

**Logic:**
1. All orders attached must be `COMPLETED`, `CANCELLED`, or `REFUNDED`. Otherwise `409 SESSION_HAS_OPEN_ORDERS` (unless `force: true` and actor has `order.void`).
2. Set `status = CLOSED`, `closedAt = now()`, `closedById = actor`.
3. Update parent table's status: `AVAILABLE` (or `DIRTY` if config flag set).
4. Emit `session.closed`.

**Permissions:** `order.update_status` (waiter / cashier).

### POST /sessions/:id/cancel

Cancel a session (party left without ordering, mis-seated). Refused if any order has been submitted — must cancel orders first.

### POST /sessions/merge

Merge two or more open sessions into one umbrella. Tables remain `OCCUPIED`. Existing orders re-link to the umbrella session.

**Logic (single transaction):**
1. Validate all input sessions are `OPEN`.
2. Pick first as the umbrella; for each other, set `mergedIntoId = umbrella.id` and re-point its `Order.tableSessionId` to the umbrella.
3. Update umbrella's `partySize = Σ partySize`.
4. Emit `sessions.merged`.

### POST /sessions/:id/split

Inverse of merge: send children back to their own table sessions. Orders that were placed under the umbrella stay with the umbrella (cannot retroactively reassign which order belonged to which sub-party — that's a manual decision the cashier makes by **moving order items** before splitting).

### POST /sessions/:id/move

Move a session from one table to another (e.g. switch the noisy patio table to indoor). The original table becomes `AVAILABLE`, the new table becomes `OCCUPIED`. Refused if target table is not `AVAILABLE`.

### Reservations: GET / POST / PATCH / DELETE /reservations

Standard CRUD. A scheduled job (`reservation-status-updater`) runs every minute:

- Reservations within the next 60 minutes → mark their table `RESERVED`
- 30 minutes past `reservedFor` with no SEATED transition → set `status = NO_SHOW`, free the table

Marking a reservation `SEATED` opens a session against the table.

## WebSocket events

| Event                    | Payload                                                  |
|--------------------------|----------------------------------------------------------|
| `table.status_changed`   | `{ tableId, fromStatus, toStatus }`                      |
| `session.opened`         | `{ sessionId, tableId, partySize }`                      |
| `session.closed`         | `{ sessionId, tableId, durationMinutes, totalCents }`    |
| `sessions.merged`        | `{ umbrellaId, mergedSessionIds }`                       |
| `reservation.upcoming`   | fired 60 min before `reservedFor`                        |

Rooms: `staff`, `dashboard`, `pos`.

## Capacity tile math

The dashboard's "TABLES OCCUPIED · 22/26 · 85% Capacity" reads from the `summary` block of `GET /tables`:

```
occupancy = (occupied + reserved) / (total - outOfService)
```

The percent shown ("85% Capacity") rounds to the nearest integer.

## Acceptance tests

1. Open session on AVAILABLE table → table status flips to OCCUPIED
2. Open session on OCCUPIED table → 409
3. Close session with open orders → 409 unless `force: true` + manager
4. Close session → table flips to AVAILABLE (or DIRTY if config)
5. Merge two sessions → umbrella session lists both `mergedFrom`; orders re-linked
6. Move session to non-empty target table → 409
7. Reservation 50 min ahead → table marked RESERVED by job
8. Reservation 35 min past with no seat → NO_SHOW + table freed
9. Soft-delete table with historical sessions in last 30 days → 409
10. Summary endpoint returns correct counts after a series of opens/closes
11. WebSocket `table.status_changed` reaches dashboard within 100 ms
12. Per-zone filtering works on the floor-plan view

## Done when

- Manager seeds 26 tables matching the actual floor
- Onsite create-order flow picks a table and the table flips status live
- Dashboard "Tables Occupied" tile updates in real time
- Reservations basic flow works: book → table marked RESERVED → seat → session opens
- Merge and split work for at least the 2-table case (the most common)

## Out of scope (future tickets)

- Customer-facing online reservation site
- Visual floor-plan editor (drag tables on a canvas)
- Per-seat ordering
- QR-at-table customer self-ordering
- Waitlist management with SMS notifications
- Table-availability heatmap analytics (peak hours)
