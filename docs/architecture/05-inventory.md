# Module 5 — Inventory

The single source of truth for **how much of each variant is on hand**. Module 4 stores variants and their denormalised `stockOnHand`; this module owns the **movement ledger** that explains every change to that number, and the alerting that fires when stock crosses thresholds.

## Scope

**Ships:**
- `StockMovement` table (append-only ledger)
- `/inventory/movements` (read-only audit trail)
- `/inventory/adjust` (manual +/- adjustments by managers)
- `/inventory/restock` (bulk restock workflow with PO reference)
- Reservation / commit / release semantics used by the Orders module
- Low-stock alert background job (BullMQ, every 5 minutes)
- Auto-refill alert flag per variant — emits notification when stock drops below threshold

**Does NOT ship:**
- Purchase order management (just an optional `purchaseOrderRef` string on restock movements)
- Supplier management
- Multi-warehouse / location tracking — single store, single location in v1
- Ingredient-level breakdown (no recipe explosion)
- Stock counts / cycle counts UI (the data model supports it via `STOCK_COUNT` movement type, but the UI is deferred)

## UI surfaces

- Stock badge on Listings page (powered by `ProductVariant.stockOnHand` from Module 4 — this module just keeps that number accurate)
- Stock Management card on Add/Edit Product (screenshot 2) — qty input + auto-refill alert toggle
- Inventory page (Manager Dashboard, not in screenshots but implied):
  - Movements table (timestamp, product, variant, type, qty, reason, actor)
  - "Adjust Stock" modal
  - "Restock" bulk modal
- Notifications dropdown — pings when a variant hits low/out of stock (Module 10 actually delivers them; this module emits the events)

## Mental model

Stock is an **append-only ledger**. The `stockOnHand` and `stockReserved` columns on `ProductVariant` are *cached aggregates*. The truth is the sum of `StockMovement.qty` for that variant. Every change goes through one of these movement types:

| Movement type        | Effect on `stockOnHand`        | Effect on `stockReserved`     | Triggered by                |
|----------------------|-------------------------------|--------------------------------|------------------------------|
| `INITIAL`            | +qty                          | 0                              | Product/variant creation     |
| `RESTOCK`            | +qty                          | 0                              | Manager restock action       |
| `ADJUSTMENT`         | ±qty                          | 0                              | Manual correction            |
| `STOCK_COUNT`        | sets to abs(qty) (delta logged)| 0                             | Cycle count                  |
| `RESERVED`           | 0                             | +qty                           | Order created                |
| `RELEASED`           | 0                             | -qty                           | Order cancelled / item removed |
| `CONSUMED`           | -qty                          | -qty                           | Order paid / completed       |
| `RETURN`             | +qty                          | 0                              | Refund with restock          |
| `WASTE`              | -qty                          | 0                              | Spillage, breakage, expired  |

Reads of `stockOnHand` go through the cached column for performance. The cache is rebuilt by a Prisma transaction whenever a movement is inserted (within the same transaction — atomic).

`availableForSale = stockOnHand - stockReserved`

Stock badge thresholds:
- `OUT_OF_STOCK` if `availableForSale ≤ 0`
- `LOW_STOCK` if `0 < availableForSale ≤ lowStockThreshold`
- `IN_STOCK` otherwise

## Prisma schema

```prisma
model StockMovement {
  id              String                @id @default(uuid())
  variantId       String
  variant         ProductVariant        @relation(fields: [variantId], references: [id])
  productId       String                                    // denormalised for fast queries
  product         Product               @relation(fields: [productId], references: [id])

  type            StockMovementType
  qty             Int                                       // signed; sign rules per type table above
  reason          String?                                   // free-text by manager
  purchaseOrderRef String?                                  // optional restock reference

  // Source linking — if this movement was triggered by an order
  orderId         String?
  orderItemId     String?

  beforeOnHand    Int                                       // snapshot for audit
  afterOnHand     Int
  beforeReserved  Int
  afterReserved   Int

  createdAt       DateTime              @default(now())
  createdById     String                                    // staff member, or 'system' for jobs

  @@index([variantId, createdAt])
  @@index([productId, createdAt])
  @@index([orderId])
  @@index([type, createdAt])
  @@map("stock_movements")
}

enum StockMovementType {
  INITIAL
  RESTOCK
  ADJUSTMENT
  STOCK_COUNT
  RESERVED
  RELEASED
  CONSUMED
  RETURN
  WASTE
}
```

The `ProductVariant` model (defined in Module 4) already has these denormalised columns:

```prisma
stockOnHand        Int @default(0)
stockReserved      Int @default(0)
lowStockThreshold  Int @default(10)
```

Plus this module adds:

```prisma
// Module 5 adds to ProductVariant:
autoRefillAlert    Boolean @default(true)
lastLowStockAlertAt DateTime?  // throttle so we don't spam every 5 min
```

## Service API (used by Orders module)

```ts
// src/modules/inventory/inventory.service.ts
class InventoryService {
  /** Atomic. Throws InsufficientStockException if not enough available. */
  async reserve(variantId: string, qty: number, ctx: { orderId: string, orderItemId: string, actorId: string }): Promise<void>;

  /** Atomic. Reverses a reservation. */
  async release(variantId: string, qty: number, ctx: { orderId: string, orderItemId?: string, actorId: string }): Promise<void>;

  /** Atomic. Reservation → Consumed (called on payment success). */
  async consume(variantId: string, qty: number, ctx: { orderId: string, orderItemId: string, actorId: string }): Promise<void>;

  /** Manager-driven. */
  async adjust(variantId: string, deltaQty: number, reason: string, actorId: string): Promise<StockMovement>;
  async restock(variantId: string, qty: number, purchaseOrderRef: string | undefined, actorId: string): Promise<StockMovement>;
  async waste(variantId: string, qty: number, reason: string, actorId: string): Promise<StockMovement>;
  async returnStock(variantId: string, qty: number, ctx: { orderId: string, actorId: string }): Promise<StockMovement>;

  async getMovements(filter: MovementFilter): Promise<Paginated<StockMovement>>;
}
```

Every mutating method runs inside a Prisma transaction:

```ts
return prisma.$transaction(async (tx) => {
  const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } });

  // Compute new aggregates
  const newOnHand   = variant.stockOnHand + onHandDelta;
  const newReserved = variant.stockReserved + reservedDelta;

  if (newOnHand < 0) throw new InsufficientStockException(...);
  if (newReserved < 0) throw new InvalidReservationException(...);
  if (type === 'RESERVED' && newOnHand - newReserved < 0) throw new InsufficientStockException(...);

  // Update cache + insert movement in same transaction
  await tx.productVariant.update({
    where: { id: variantId },
    data: { stockOnHand: newOnHand, stockReserved: newReserved },
  });
  return tx.stockMovement.create({
    data: { /* with before/after snapshots */ },
  });
});
```

The transaction uses **`SELECT ... FOR UPDATE`** semantics (Prisma `$transaction` with `Serializable` isolation level) to prevent oversell race conditions when two cashiers reserve the last unit at once.

## DTOs

```ts
export class AdjustStockDto {
  @IsUUID('4') variantId: string;
  @IsInt() deltaQty: number;       // signed (+5 or -3)
  @IsString() @MinLength(3) @MaxLength(200) reason: string;
}

export class RestockDto {
  @IsUUID('4') variantId: string;
  @IsInt() @Min(1) qty: number;
  @IsString() @IsOptional() purchaseOrderRef?: string;
}

export class BulkRestockDto {
  @IsArray() @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RestockDto)
  items: RestockDto[];

  @IsString() @IsOptional() purchaseOrderRef?: string;   // applies to all if items don't override
}

export class WasteDto {
  @IsUUID('4') variantId: string;
  @IsInt() @Min(1) qty: number;
  @IsString() @MinLength(3) @MaxLength(200) reason: string;
}

export class MovementFilterDto {
  @IsUUID('4') @IsOptional() productId?: string;
  @IsUUID('4') @IsOptional() variantId?: string;
  @IsEnum(StockMovementType, { each: true }) @IsOptional() types?: StockMovementType[];
  @IsDateString() @IsOptional() from?: string;
  @IsDateString() @IsOptional() to?: string;
  @IsInt() @Min(1) @IsOptional() page?: number = 1;
  @IsInt() @Min(1) @Max(100) @IsOptional() pageSize?: number = 50;
}
```

## Endpoints

### GET /inventory/movements

**Query:** `MovementFilterDto`. Returns the ledger.

**Permissions:** `inventory.read`.

### POST /inventory/adjust

Manual delta. Use case: manager realises 3 units were spilled. Send `{ variantId, deltaQty: -3, reason: "spill" }`.

**Permissions:** `inventory.adjust`.

### POST /inventory/restock

Single-variant restock.

**Permissions:** `inventory.adjust`.

### POST /inventory/restock/bulk

Bulk restock (e.g. coffee beans delivery → restock 12 SKUs at once). Single transaction, all-or-nothing.

**Permissions:** `inventory.adjust`.

### POST /inventory/waste

Recording spillage / breakage / expired stock.

**Permissions:** `inventory.adjust`.

### GET /inventory/low-stock

Returns variants currently at or below `lowStockThreshold`. Used by the dashboard's "Active Orders / Stock Alerts" widget and the Notifications page.

**200 OK:**
```json
{
  "items": [
    {
      "variantId": "uuid",
      "productName": "Vanilla Syrup",
      "variantName": "Default",
      "sku": "SY-VS-108",
      "stockOnHand": 0,
      "lowStockThreshold": 10,
      "status": "OUT_OF_STOCK"
    }
  ]
}
```

**Permissions:** `inventory.read`.

## Background jobs (BullMQ)

### `low-stock-checker` — every 5 minutes

```ts
// jobs/low-stock-checker.ts
@Processor('low-stock')
class LowStockChecker {
  @Process()
  async handle() {
    const candidates = await prisma.productVariant.findMany({
      where: {
        deletedAt: null,
        autoRefillAlert: true,
        stockOnHand: { lte: prisma.productVariant.fields.lowStockThreshold },
        OR: [
          { lastLowStockAlertAt: null },
          { lastLowStockAlertAt: { lt: subHours(new Date(), 4) } }, // throttle: at most 1 alert per variant per 4h
        ],
      },
      include: { product: true },
    });

    for (const v of candidates) {
      await notifications.emit('inventory.low_stock', {
        variantId: v.id, productId: v.product.id,
        sku: v.sku, productName: v.product.name,
        stockOnHand: v.stockOnHand, threshold: v.lowStockThreshold,
      });
      await prisma.productVariant.update({
        where: { id: v.id },
        data: { lastLowStockAlertAt: new Date() },
      });
    }
  }
}
```

Module 10 receives the `inventory.low_stock` event and decides delivery channel (in-app, email, both).

### `daily-inventory-snapshot` — 02:00 store time

Writes one `STOCK_COUNT` per variant for the day's start; lets us reconstruct historical inventory without scanning the full ledger.

## Reservation lifecycle (interaction with Module 6)

```
Order Created          →  inventoryService.reserve(variantId, qty)
                          ├─ stockReserved += qty   (cap: must not exceed onHand)
                          └─ Movement: RESERVED

Order Item Removed     →  inventoryService.release(variantId, qty)
                          ├─ stockReserved -= qty
                          └─ Movement: RELEASED

Order Cancelled        →  release for every order item

Payment COMPLETED      →  inventoryService.consume(variantId, qty)
                          ├─ stockOnHand   -= qty
                          ├─ stockReserved -= qty
                          └─ Movement: CONSUMED

Refund w/ Restock      →  inventoryService.returnStock(variantId, qty)
                          ├─ stockOnHand += qty
                          └─ Movement: RETURN
```

**Why reserve up-front?** Two cashiers might add the last unit of Oat Milk Latte at the same time. Without reservation, both orders are placed and one fails at payment. Reservation makes the conflict visible the instant the order item is added.

**Stale reservations:** an order in `OPEN` status with no activity for 30 minutes triggers an `inventory.stale_reservation` warning (handled in Module 10). Manager can manually cancel-and-release. We do **not** auto-cancel — abandoning an open POS tab is a real workflow.

## Acceptance tests

1. Create product with `initialStock=50` → `INITIAL` movement of qty 50, `stockOnHand=50`
2. Reserve 5 units → `RESERVED` movement, `stockReserved=5`, `stockOnHand=50`
3. Reserve when `stockOnHand - stockReserved < qty` → 409 `INSUFFICIENT_STOCK`
4. Two concurrent reserves each for the last unit → exactly one succeeds, the other 409 (proves serialisation)
5. Release a reservation → `RELEASED` movement, `stockReserved` decremented
6. Consume after payment → `CONSUMED` movement, both columns decremented
7. Adjust with `deltaQty: -3, reason: "spill"` → `ADJUSTMENT` movement
8. Adjust to negative → 409 `INSUFFICIENT_STOCK`
9. Restock with `purchaseOrderRef` is recorded on the movement row
10. Low-stock job emits exactly one notification per variant per 4-hour window
11. Variant with `autoRefillAlert: false` is skipped by the job
12. Movement ledger sum for a variant always equals current `stockOnHand` (invariant test, run at end of every test)

## Done when

- Stock pill on the Listings page (screenshot 1) reflects real numbers
- Stock Management card on Add Product (screenshot 2) writes an `INITIAL` movement
- Manager can adjust / restock / waste from the Inventory page
- Low-stock notifications appear in the bell dropdown within 5 minutes of crossing threshold
- Concurrent-reserve test passes (this is the most important correctness test)
- Movement ledger renders in a table with filters: variant, type, date range

## Out of scope (future tickets)

- Multi-location warehouses
- Purchase orders with status workflow (draft → sent → received)
- Supplier database
- Recipe / ingredient explosion (every latte consumes 18g beans + 200ml milk)
- Forecasting / re-order points based on historical sales
- Stock count / cycle count UI (data model is ready, UI deferred)
- Barcode-scan-to-restock workflow on a handheld scanner
