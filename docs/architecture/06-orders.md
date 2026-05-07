# Module 6 — Orders

The heart of the POS. Powers the **Onsite**, **Take away**, **Online Ordering**, and **Point of Sale** sidebar items in the Manager Dashboard, plus the live "Active Orders" tile on the dashboard. An order has 1+ line items, optional add-ons per item, a status lifecycle, and one or more payments (Module 8).

## Scope

**Ships:**
- `Order`, `OrderItem`, `OrderItemAddon`, `OrderStatusHistory` tables
- CRUD: `/orders`, `/orders/:id`, item-level mutations
- Status state machine: `OPEN → SUBMITTED → PREPARING → READY → COMPLETED`, plus `CANCELLED`, `REFUNDED`
- Four channels: `ONSITE`, `TAKEAWAY`, `ONLINE`, `POS`
- WebSocket events: `order.created`, `order.updated`, `order.status_changed`, `order.cancelled`
- Auto-numbering: `ORD-YYMMDD-####` (e.g. `ORD-261007-0142`)
- Tax calculation, discount application, total computation
- Integration with Modules 5 (Inventory reserve/consume) and 7 (Tables for ONSITE)

**Does NOT ship:**
- Payment processing — Module 8 owns that. This module only marks `paymentStatus`.
- Receipt printing / email — Module 8.
- Customer accounts / loyalty — out of scope for v1.
- Tipping flow — captured as a discount-style line for v1; first-class tip column in v1.1.
- Coupon codes / promo engine — flat manual discounts only in v1.

## UI screens this module powers

- **Orders list** — filterable by channel and status (sidebar items: Orders, Onsite, Take away, Online Ordering, Point of Sale)
- **Active Orders** dashboard tile (screenshot 3, "ACTIVE ORDERS · 18")
- **Create Order** button on dashboard → POS-style flow
- **POS terminal** — mobile/tablet-friendly variant of order creation
- **Kitchen display** — list of `SUBMITTED` and `PREPARING` orders, sortable by `submittedAt` ASC

## Order channels

| Channel    | Where created          | Table required? | Default behaviour                    |
|------------|------------------------|-----------------|---------------------------------------|
| `ONSITE`   | POS, by waiter/cashier | Yes — TableSession (Module 7) | Bill split possible; pay later   |
| `TAKEAWAY` | POS, by cashier        | No              | Pay immediately at counter            |
| `ONLINE`   | Customer web (public)  | No              | Pay during checkout (Stripe / cash-on-pickup option) |
| `POS`      | POS, by cashier        | No              | Single-payment counter sale (same as TAKEAWAY but tagged for analytics) |

`TAKEAWAY` and `POS` are functionally identical at the data layer; the distinction exists so analytics can split "ordered for takeout" from "ate at counter / coffee-to-go". The dashboard's "Tables Occupied 22/26" tile only counts ONSITE orders.

## Status state machine

```
                    ┌──────────────┐
                    │   DRAFT      │  (POS cart, not yet sent to kitchen — optional)
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
   submit ────────► │  SUBMITTED   │ ──── cancel ───► CANCELLED
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │  PREPARING   │ ──── cancel ───► CANCELLED  (manager only,
                    └──────┬───────┘                              releases stock)
                           ▼
                    ┌──────────────┐
                    │    READY     │ ──── cancel ───► CANCELLED  (manager only)
                    └──────┬───────┘
                           ▼ (handed to customer / waiter delivers)
                    ┌──────────────┐
                    │  COMPLETED   │ ──── refund ───► REFUNDED
                    └──────────────┘
```

- `DRAFT`: optional starting state for ONSITE/POS where the cashier is still adding items. Can transition to `SUBMITTED` only.
- `SUBMITTED`: kitchen receives the ticket. Stock is reserved at this point.
- `PREPARING`: barista starts working. Manager can edit items only by cancelling the line and re-adding.
- `READY`: drink/dish is on the pass. Awaiting handoff.
- `COMPLETED`: handed over. Triggers stock `CONSUMED` movement and (if not pre-paid) prompts payment in the manager view.
- `CANCELLED`: stock released, no payment expected. Allowed only from `OPEN/SUBMITTED` by anyone with `order.update_status`; from `PREPARING/READY` only by `order.void` permission.
- `REFUNDED`: monetary reversal handled by Module 8; this status reflects the result.

Every transition writes one `OrderStatusHistory` row and emits a WebSocket `order.status_changed` event.

## Prisma schema

```prisma
model Order {
  id              String          @id @default(uuid())
  orderNumber     String          @unique          // "ORD-261007-0142"

  channel         OrderChannel
  status          OrderStatus     @default(DRAFT)
  paymentStatus   PaymentStatus   @default(UNPAID)

  // Foreign-key links — see related modules
  cashierId       String                                 // user who opened the order
  cashier         User            @relation("CashierOrders", fields: [cashierId], references: [id])
  tableSessionId  String?                                // Module 7 — only for ONSITE
  tableSession    TableSession?   @relation(fields: [tableSessionId], references: [id])
  customerName    String?                                // free-text for ONLINE / TAKEAWAY (no customer accounts in v1)
  customerPhone   String?
  customerEmail   String?
  pickupAt        DateTime?                              // ONLINE-only, requested pickup time

  items           OrderItem[]
  payments        Payment[]                              // Module 8
  statusHistory   OrderStatusHistory[]

  // Money — all in store currency, integer cents
  subtotalCents   BigInt          @default(0)            // Σ items × qty
  discountCents   BigInt          @default(0)            // manual flat discount
  taxCents        BigInt          @default(0)
  totalCents      BigInt          @default(0)
  paidCents       BigInt          @default(0)            // sum of completed payments

  notes           String?                                // kitchen note, e.g. "no foam"
  cancelReason    String?

  submittedAt     DateTime?                              // SUBMITTED transition timestamp
  preparedAt      DateTime?
  readyAt         DateTime?
  completedAt     DateTime?
  cancelledAt     DateTime?

  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  deletedAt       DateTime?                              // hidden, never hard-deleted

  @@index([status, createdAt])
  @@index([channel, createdAt])
  @@index([cashierId, createdAt])
  @@index([tableSessionId])
  @@index([paymentStatus])
  @@map("orders")
}

enum OrderChannel { ONSITE TAKEAWAY ONLINE POS }
enum OrderStatus  { DRAFT SUBMITTED PREPARING READY COMPLETED CANCELLED REFUNDED }
enum PaymentStatus { UNPAID PARTIALLY_PAID PAID REFUNDED }

model OrderItem {
  id             String        @id @default(uuid())
  orderId        String
  order          Order         @relation(fields: [orderId], references: [id], onDelete: Cascade)

  productId      String
  product        Product       @relation(fields: [productId], references: [id])
  variantId      String
  variant        ProductVariant @relation(fields: [variantId], references: [id])

  // Snapshotted at time of order — so historical orders are immutable
  productNameSnapshot string
  variantNameSnapshot string
  unitPriceCents Int                              // base + variant delta at time of order
  qty            Int           @default(1)
  lineTotalCents Int                              // qty × (unitPrice + Σ addonPrice)
  notes          String?                          // "extra hot", "decaf"

  addons         OrderItemAddon[]

  createdAt      DateTime      @default(now())
  voidedAt       DateTime?                         // soft-remove; releases stock

  @@index([orderId])
  @@index([variantId])
  @@map("order_items")
}

model OrderItemAddon {
  id             String     @id @default(uuid())
  orderItemId    String
  orderItem      OrderItem  @relation(fields: [orderItemId], references: [id], onDelete: Cascade)

  addonId        String                       // ProductAddon, may be null/deleted later
  nameSnapshot   String
  priceCents     Int
  qty            Int        @default(1)

  @@map("order_item_addons")
}

model OrderStatusHistory {
  id          String      @id @default(uuid())
  orderId     String
  order       Order       @relation(fields: [orderId], references: [id], onDelete: Cascade)

  fromStatus  OrderStatus?
  toStatus    OrderStatus
  reason      String?
  actorId     String                          // user who triggered
  createdAt   DateTime    @default(now())

  @@index([orderId, createdAt])
  @@map("order_status_history")
}
```

**Snapshot-on-line-item rule:** when an order item is created, we snapshot `productName`, `variantName`, `unitPriceCents`, and `addonPrice/name` so future product price/name edits never retroactively change historical orders. The order is the source of truth for "what was sold and at what price".

## Order numbering

Format: `ORD-YYMMDD-####`. The `####` part is a per-day counter starting at 0001. Stored daily counters live in Redis (`order_seq:2026-05-07`), with a daily fallback to a Postgres advisory lock + `MAX(orderNumber)` query if Redis is cold. Counter is incremented atomically.

## DTOs

```ts
export class CreateOrderDto {
  @IsEnum(OrderChannel) channel: OrderChannel;

  @ValidateIf(o => o.channel === 'ONSITE')
  @IsUUID('4') tableSessionId?: string;

  @IsString() @IsOptional() customerName?: string;
  @IsPhoneNumber() @IsOptional() customerPhone?: string;
  @IsEmail() @IsOptional() customerEmail?: string;

  @IsArray() @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @IsString() @IsOptional() notes?: string;
  @IsBoolean() @IsOptional() submitImmediately?: boolean = true; // false = stays in DRAFT
}

class CreateOrderItemDto {
  @IsUUID('4') variantId: string;        // product is derived
  @IsInt() @Min(1) qty: number;
  @IsString() @IsOptional() notes?: string;

  @IsArray() @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemAddonDto)
  addons?: CreateOrderItemAddonDto[];
}

class CreateOrderItemAddonDto {
  @IsUUID('4') addonId: string;
  @IsInt() @Min(1) qty: number;
}

export class AddOrderItemDto extends CreateOrderItemDto {}

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus) status: OrderStatus;
  @IsString() @IsOptional() reason?: string;
}

export class ApplyDiscountDto {
  @IsInt() @Min(0) discountCents: number;
  @IsString() @MinLength(3) @MaxLength(120) reason: string;
}

export class OrderSearchDto {
  @IsEnum(OrderChannel) @IsOptional() channel?: OrderChannel;
  @IsEnum(OrderStatus, { each: true }) @IsOptional() statuses?: OrderStatus[];
  @IsEnum(PaymentStatus) @IsOptional() paymentStatus?: PaymentStatus;
  @IsUUID('4') @IsOptional() cashierId?: string;
  @IsDateString() @IsOptional() from?: string;
  @IsDateString() @IsOptional() to?: string;
  @IsString() @IsOptional() q?: string;          // matches order number, customer name/phone
  @IsInt() @Min(1) @IsOptional() page?: number = 1;
  @IsInt() @Min(1) @Max(100) @IsOptional() pageSize?: number = 20;
  @IsString() @IsOptional() sort?: string = '-createdAt';
}
```

## Endpoints

### POST /orders

Creates an order. If `submitImmediately = true` (default), goes straight to `SUBMITTED`; otherwise stays `DRAFT`.

**Logic (single transaction):**
1. Validate channel-specific requirements (ONSITE needs `tableSessionId` that is `OPEN`).
2. For each item:
   a. Load variant + product (must be `ACTIVE`, not soft-deleted).
   b. Snapshot name + price.
   c. Validate add-ons belong to this product.
   d. Reserve stock (Module 5 `inventoryService.reserve(variantId, qty)`).
3. Compute `subtotalCents`, `taxCents` (per item: `priceCents × qty × taxRateBps / 10000`), `totalCents`.
4. Generate `orderNumber`.
5. Insert `Order` + `OrderItem` + `OrderItemAddon` rows.
6. If `submitImmediately`, insert `OrderStatusHistory` (DRAFT → SUBMITTED), set `submittedAt = now()`.
7. Emit `order.created` WebSocket event to room `staff` (and `kitchen` if SUBMITTED).

**201 Created:** the full order with computed totals.

**Errors:**
- `400 INVALID_CHANNEL_TABLE_MISMATCH`
- `404 VARIANT_NOT_FOUND`
- `409 INSUFFICIENT_STOCK` — body lists which variant(s) failed
- `409 TABLE_SESSION_NOT_OPEN`

**Permissions:** `order.create`. Online channel: public, but rate-limited (30/min/IP).

### GET /orders

Paginated list. See `OrderSearchDto`. Default sort newest-first.

**Permissions:** `order.read`.

### GET /orders/active

Convenience: returns counts grouped by status for the dashboard tile (`{ submitted: 4, preparing: 8, ready: 6 }`).

**Permissions:** `order.read`.

### GET /orders/:id

Full order with items, addons, status history, payments. Supports `?include=items,payments,statusHistory`.

**Permissions:** `order.read`.

### PATCH /orders/:id/status

State-machine transition. Validates allowed transition; rejects illegal moves with `409 INVALID_STATUS_TRANSITION`.

**Side effects per target status:**

| Target       | Side effects |
|--------------|--------------|
| `SUBMITTED`  | sets `submittedAt`; emits `order.status_changed` to `kitchen` room |
| `PREPARING`  | sets `preparedAt` |
| `READY`      | sets `readyAt`; emits to POS for pickup notification |
| `COMPLETED`  | sets `completedAt`; for each item, calls `inventoryService.consume()`; closes table session if last open order on that table |
| `CANCELLED`  | sets `cancelledAt`, requires `reason`; releases all reservations via `inventoryService.release()` |
| `REFUNDED`   | only via Module 8 (Payments) — direct PATCH is rejected |

**Permissions:**
- `order.update_status` for SUBMITTED → PREPARING → READY → COMPLETED
- `order.void` for cancelling an order in PREPARING or READY

### POST /orders/:id/items

Add an item to a `DRAFT` or `SUBMITTED` order. Reserves stock. Emits `order.updated`.

**Errors:**
- `409 ORDER_LOCKED` — order is in PREPARING or later

### DELETE /orders/:id/items/:itemId

Voids an item. Sets `voidedAt`, releases stock, recomputes totals.

**Permissions:** `order.update_status` if order is DRAFT/SUBMITTED; `order.void` otherwise.

### PATCH /orders/:id/items/:itemId

Update qty or notes. Qty changes adjust stock reservation atomically. Cannot change `variantId` (delete + add instead).

### POST /orders/:id/discount

Apply a flat discount. Captures `reason`. Recomputes `totalCents`.

**Permissions:** `order.update_status` (cashier-level OK).

### POST /orders/:id/clone

Re-create a new DRAFT order from this one's items. Useful for "same as last time" workflow at the POS.

**Permissions:** `order.create`.

### GET /orders/by-number/:orderNumber

Lookup by human-readable number (used by receipt scanning, support tickets).

## WebSocket events

The `OrdersGateway` exposes a single `/ws` endpoint with namespaced rooms:

| Room name      | Audience                       | Events                              |
|----------------|--------------------------------|-------------------------------------|
| `staff`        | All authenticated staff        | every order event                   |
| `kitchen`      | BARISTA / MANAGER              | `order.submitted`, `order.cancelled`, item edits |
| `pos`          | CASHIER / MANAGER              | `order.ready`, `order.completed`    |
| `dashboard`    | MANAGER / ADMIN                | KPI deltas (Module 9 owns the math) |
| `customer:<orderId>` | Customer (ONLINE only)   | own order's status changes          |

Event payload shape:

```ts
{
  event: 'order.status_changed',
  data: {
    orderId: 'uuid',
    orderNumber: 'ORD-261007-0142',
    fromStatus: 'SUBMITTED',
    toStatus: 'PREPARING',
    actorId: 'uuid',
    occurredAt: '2026-05-07T12:32:14Z',
  }
}
```

## Money math

```ts
// per-item line total
lineTotalCents = unitPriceCents * qty + Σ(addon.priceCents * addon.qty);

// per-item tax — applied AFTER line total, BEFORE order discount
itemTaxCents = floor(lineTotalCents * variant.product.taxRateBps / 10000);

// per-order
subtotalCents = Σ items.lineTotalCents;
taxCents      = Σ items.itemTaxCents;
totalCents    = subtotalCents + taxCents - discountCents;
```

Discounts apply against subtotal, never against tax (tax is on the post-discount taxable amount in many jurisdictions; we keep it simple: tax is computed pre-discount on each item, discount reduces the final total). Out of scope to model split tax-jurisdictions for v1.

## Acceptance tests

1. Create POS order with 2 items → 201, status SUBMITTED, stock reserved
2. Create ONSITE order without table session → 400
3. Create order with insufficient stock → 409, body lists failing variants
4. Add item to DRAFT order → totals recomputed, stock reserved
5. Add item to PREPARING order → 409 ORDER_LOCKED
6. Cancel SUBMITTED order → all reservations released
7. Complete order → CONSUMED movements created, table session closes if last
8. Illegal transition (READY → SUBMITTED) → 409
9. Order number format matches `ORD-YYMMDD-####`, increments per day
10. Two orders created at the same millisecond get different numbers (Redis atomic counter)
11. Discount of 5.00 on a $20 order → totalCents = 1500 + tax - 500
12. Snapshotted product name survives later product rename
13. WebSocket `order.created` fires within 100ms of POST /orders
14. Online-channel rate limit: 31st request from same IP in 60s → 429

## Done when

- All four channels can create orders end-to-end
- Status transitions reflected in real time on Kitchen Display
- Active Orders dashboard tile updates live
- POS terminal can: open table → add items → submit → mark ready → take payment → close
- Online customer can place an order and see status updates without refreshing
- Stock numbers reconcile after a bunch of cancels/adds (no leakage)

## Out of scope (future tickets)

- Split bill across multiple payments / patrons
- Tipping as a first-class column
- Coupons / promo code engine
- Customer accounts, addresses, order history per user
- Delivery fees / delivery routing
- Tax jurisdictions (multi-rate per item)
- Voiding completed orders without refund (use REFUND instead)
- Loyalty points
