# Module 9 — Dashboard

The Manager's home screen. A read-only aggregation layer over Orders (06), Tables (07), Inventory (05), Products (04), and Payments (08). **This module owns no tables.** It composes data from other modules, caches the results, and pushes deltas over WebSocket.

## Scope

**Ships:**
- 6 read-only endpoints: `/dashboard/summary`, `/dashboard/sales`, `/dashboard/top-products`, `/dashboard/stock-alerts`, `/dashboard/recent-orders`, `/dashboard/search`
- Redis caching layer with explicit cache-bust events from upstream modules
- WebSocket events on the `dashboard` room (defined in Module 06) that push deltas
- Today-vs-yesterday delta math (the `+12.5%` badge)
- Trend classification (`UP / STEADY / DOWN`) and urgency classification (`HIGH / MEDIUM / LOW`)

**Does NOT ship:**
- New tables (no schema changes)
- Custom date ranges — only `today`, `week`, `month` presets in v1
- PDF / Excel / CSV export — deferred to v1.1
- Forecasting, predictions, comparison overlays
- Drilldown analytics (the "View Detailed Analytics →" link goes to a future Reports module)
- Cost / margin numbers in v1 (data exists in Module 04 but exposed in v1.1)

## UI screens this module powers

The **Dashboard Overview** screen (screenshot 3). Element-by-element mapping:

| UI element | Endpoint |
|------------|----------|
| "Good Morning, Elias" greeting | `GET /auth/me` (Module 01) |
| Top-bar search ("orders, stock...") | `GET /dashboard/search?q=...` |
| Notification bell badge | `GET /notifications` (Module 10) |
| **TODAY'S REVENUE** tile + sparkline + delta % | `GET /dashboard/summary` |
| **ORDERS TODAY** tile + trend badge + avg order | `GET /dashboard/summary` |
| **ACTIVE ORDERS** tile + urgency badge + avatars | `GET /dashboard/summary` |
| **TABLES OCCUPIED** tile + capacity bar | `GET /dashboard/summary` |
| **Sales Performance** bar chart + Daily/Weekly/Monthly toggle | `GET /dashboard/sales?range=...` |
| **Top Products** card | `GET /dashboard/top-products` |
| **Stock Alerts** card | `GET /dashboard/stock-alerts` |
| **Recent Orders** table | `GET /dashboard/recent-orders` |
| "Add Product" button | links to `/products/new` (Module 04) |
| "Create Order" button | links to `/orders/new` (Module 06) |
| "View Detailed Analytics →" link | deferred — Reports module |
| "View all" on Recent Orders | links to `/orders` list (Module 06) |

## Endpoints

### GET /dashboard/summary

Single round-trip for all 4 KPI tiles. Frontend renders the tiles from this one response.

**200 OK:**
```json
{
  "todaysRevenue": {
    "amountCents": 342850,
    "deltaPercent": 12.5,
    "sparkline": [180, 210, 240, 195, 320, 410, 380, 420]
  },
  "ordersToday": {
    "count": 142,
    "trend": "STEADY",
    "avgOrderCents": 2414
  },
  "activeOrders": {
    "count": 18,
    "urgency": "HIGH",
    "byStatus": { "submitted": 4, "preparing": 8, "ready": 6 },
    "recentCashierAvatars": ["url1", "url2", "url3", "url4", "url5", "+15"]
  },
  "tablesOccupied": {
    "occupied": 22,
    "total": 26,
    "percent": 85
  }
}
```

**Logic:**
- `todaysRevenue.amountCents` = sum of `Payment.amountCents` where `status=COMPLETED` and `createdAt` ≥ today 00:00 store-time
- `deltaPercent` = `(today − yesterday) / yesterday × 100`, rounded to 1 decimal. Returns `null` if yesterday's revenue was 0.
- `sparkline` = 8 hourly buckets (current 8 hours), revenue in cents. Used for the mini bar inside the tile.
- `ordersToday.count` = count of `Order` rows where `createdAt` ≥ today and `status != CANCELLED`
- `ordersToday.trend` — see "Trend & urgency rules" below
- `ordersToday.avgOrderCents` = `Σ Order.totalCents / count` for completed orders today
- `activeOrders.count` = orders with status in `(SUBMITTED, PREPARING, READY)`
- `activeOrders.byStatus` reuses `GET /orders/active` from Module 06
- `activeOrders.urgency` — see rules below
- `tablesOccupied` reuses the `summary` block of `GET /tables` from Module 07

**Permissions:** `dashboard.read`.

### GET /dashboard/sales

Bar chart data for the **Sales Performance** card.

**Query:** `?range=daily | weekly | monthly`

| Range     | Bucket size | Bucket count | Range start                      |
|-----------|-------------|--------------|----------------------------------|
| `daily`   | 1 hour      | 13           | today 08:00 → 20:00 store-time   |
| `weekly`  | 1 day       | 7            | last 7 days incl. today          |
| `monthly` | 1 day       | 30           | last 30 days incl. today         |

**200 OK:**
```json
{
  "range": "daily",
  "currency": "USD",
  "buckets": [
    { "label": "08:00 AM", "revenueCents": 12500, "orderCount": 8 },
    { "label": "10:00 AM", "revenueCents": 24300, "orderCount": 14 },
    { "label": "12:00 PM", "revenueCents": 38900, "orderCount": 22 }
  ],
  "totalRevenueCents": 342850,
  "totalOrders": 142
}
```

**Logic:** SQL aggregation grouped by `date_trunc('hour' | 'day', payment.createdAt)`. Only `COMPLETED` payments. Empty buckets included with zeros so the chart has flat bars.

**Permissions:** `dashboard.read`.

### GET /dashboard/top-products

**Query:** `?limit=3&range=today | week | month`

**200 OK:**
```json
{
  "range": "today",
  "items": [
    { "productId": "uuid", "name": "Oat Milk Latte",  "thumbUrl": "https://...", "orderCount": 42, "revenueCents": 23100 },
    { "productId": "uuid", "name": "Espresso Doppio", "thumbUrl": "https://...", "orderCount": 38, "revenueCents": 15200 },
    { "productId": "uuid", "name": "Ethiopian V60",   "thumbUrl": "https://...", "orderCount": 26, "revenueCents": 17500 }
  ]
}
```

**Logic:** Group `OrderItem` rows joined to non-cancelled, non-refunded orders within range. Sort by `Σ qty` desc, take `limit`. `revenueCents = Σ lineTotalCents` per product.

**Permissions:** `dashboard.read`.

### GET /dashboard/stock-alerts

**Query:** `?limit=5`

**200 OK:**
```json
{
  "items": [
    { "variantId": "uuid", "productId": "uuid", "name": "Paper Straws", "remaining": 20, "threshold": 30, "severity": "LOW" },
    { "variantId": "uuid", "productId": "uuid", "name": "Whole Milk",   "remaining": 0,  "threshold": 10, "severity": "OUT" }
  ]
}
```

**Logic:** thin pass-through to `inventoryService.getLowStock()` (Module 05). Severity:
- `OUT` if `remaining = 0`
- `LOW` if `0 < remaining ≤ threshold`

Sort: `OUT` first, then `LOW` ordered by smallest `remaining / threshold` ratio.

**Permissions:** `dashboard.read`.

### GET /dashboard/recent-orders

**Query:** `?limit=10`

**200 OK:**
```json
{
  "items": [
    {
      "id": "uuid",
      "orderNumber": "ORD-261007-0142",
      "primaryItemName": "Ethiopia Yirgacheffe",
      "channel": "ONSITE",
      "channelLabel": "Dine-in (Table 12)",
      "category": "Coffee",
      "totalCents": 2400,
      "stockBadge": "IN_STOCK",
      "updatedAt": "2026-10-24T11:14:00Z"
    }
  ]
}
```

**Logic:** Calls `ordersService.findRecent(limit)` and decorates each row with the **primary item** display name (first `OrderItem` of the order) so the table shows "Ethiopia Yirgacheffe / Coffee" rather than the bare order number. The `stockBadge` reflects the primary item's variant stock status at read time.

**Permissions:** `dashboard.read`.

### GET /dashboard/search

The top-bar search box ("Search orders, stock..."). Federated search across orders and products in one response.

**Query:** `?q=ethio&limit=10`

**200 OK:**
```json
{
  "orders": [
    { "id": "uuid", "orderNumber": "ORD-261007-0142", "customerName": "Khan party", "totalCents": 2400, "createdAt": "..." }
  ],
  "products": [
    { "id": "uuid", "sku": "CF-EY-001", "name": "Ethiopia Yirgacheffe", "stockOnHand": 45, "thumbUrl": "..." }
  ]
}
```

**Logic:**
- Trim `q`, reject if `< 2` chars (`400 SEARCH_QUERY_TOO_SHORT`)
- Fan out to `ordersService.search(q, limit/2)` and `productsService.search(q, limit/2)` in parallel
- Order match: `orderNumber LIKE q%` OR `customerName ILIKE %q%` OR `customerPhone LIKE q%`
- Product match: `sku LIKE q%` OR `name ILIKE %q%` OR `barcode = q`

**Permissions:** `dashboard.read`.

## Trend & urgency rules

These classifications are computed in the dashboard service, not stored.

**`ordersToday.trend`** — compare `count` to the trailing-4-weeks same-weekday average:
- `UP` if `today / avg ≥ 1.10`
- `DOWN` if `today / avg ≤ 0.90`
- `STEADY` otherwise

**`activeOrders.urgency`** — pure state-based:
- `HIGH` if `byStatus.ready > 5` (drinks sitting on the pass) OR `byStatus.submitted + preparing > 12`
- `MEDIUM` if total active > 6
- `LOW` otherwise

Thresholds are env-tunable:

```env
DASHBOARD_URGENCY_READY_HIGH=5
DASHBOARD_URGENCY_BACKLOG_HIGH=12
DASHBOARD_URGENCY_TOTAL_MEDIUM=6
```

## Caching

All endpoints cached in Redis. Bust by event, not by TTL alone.

| Endpoint                              | Key                                | TTL  | Bust events                                                                 |
|---------------------------------------|------------------------------------|------|-----------------------------------------------------------------------------|
| `/dashboard/summary`                  | `dash:summary`                     | 30s  | `payment.completed`, `order.*`, `table.session.opened`, `table.session.closed` |
| `/dashboard/sales?range=daily`        | `dash:sales:daily:<YYYY-MM-DD>`    | 60s  | `payment.completed`                                                         |
| `/dashboard/sales?range=weekly`       | `dash:sales:weekly:<YYYY-Www>`     | 5m   | `payment.completed` (only current-week key)                                 |
| `/dashboard/sales?range=monthly`      | `dash:sales:monthly:<YYYY-MM>`     | 15m  | `payment.completed` (only current-month key)                                |
| `/dashboard/top-products`             | `dash:top:<range>:<limit>`         | 60s  | `order.completed`                                                           |
| `/dashboard/stock-alerts`             | `dash:stock-alerts:<limit>`        | 30s  | `inventory.low_stock`, `inventory.restocked`                                |
| `/dashboard/recent-orders`            | `dash:recent:<limit>`              | 15s  | `order.created`, `order.updated`, `order.completed`                         |
| `/dashboard/search`                   | `dash:search:<hash(q)>:<limit>`    | 30s  | n/a (TTL-only is fine)                                                      |

The cache layer is implemented as a single `DashboardCacheService` that subscribes to a Redis pub/sub channel `cache.bust`. Upstream modules publish to this channel inside their service methods (e.g. `payment.complete()` publishes `{ event: 'payment.completed' }`). The cache service maps event names to key patterns and `DEL`s them.

## Realtime push (WebSocket)

Module 06 already defines a `dashboard` WebSocket room. This module subscribes to upstream domain events and re-emits **dashboard-shaped** payloads:

| Event re-emitted              | Triggered by                    | Payload (delta-only)                                            |
|-------------------------------|---------------------------------|------------------------------------------------------------------|
| `dashboard.summary.updated`   | any cache-bust on `dash:summary`| the new `summary` object (debounced 2s to avoid storms)          |
| `dashboard.recent_order`      | `order.created`                 | one row from `/dashboard/recent-orders` shape                    |
| `dashboard.stock_alert`       | `inventory.low_stock`           | one row from `/dashboard/stock-alerts` shape                     |

Frontend subscribes once on dashboard mount, merges deltas into local state. No polling needed once the page is open.

## Error responses

- `400 SEARCH_QUERY_TOO_SHORT` — `q` < 2 chars
- `403 FORBIDDEN` — missing `dashboard.read`
- `503 DASHBOARD_UNAVAILABLE` — upstream module timeout (graceful degradation: return zeros for failed sections rather than 5xx)

For graceful degradation: `/dashboard/summary` is a composite query. If `tablesOccupied` fails, return that block as `null` and still serve the rest with `200 OK`. Frontend shows "—" for the failed tile. The 503 is reserved for total Redis/DB outage.

## Acceptance tests

1. `/dashboard/summary` returns 4 tile blocks; each renders without errors
2. With no payments today, `todaysRevenue.deltaPercent` is `null`, not `0` or `Infinity`
3. With yesterday's revenue = 0, delta is `null`
4. `/dashboard/sales?range=daily` returns exactly 13 hourly buckets, empty hours have zeros
5. `/dashboard/sales?range=weekly` returns 7 day buckets including today
6. `/dashboard/top-products` excludes `CANCELLED` and `REFUNDED` orders
7. `/dashboard/stock-alerts` returns `OUT` items before `LOW` items
8. `/dashboard/recent-orders` decorates each row with primary item name
9. `/dashboard/search?q=e` → 400 (too short)
10. `/dashboard/search?q=eth` returns matches across both orders and products
11. CASHIER hits `/dashboard/summary` → 403
12. After a payment is completed, `dash:summary` cache key is deleted within 100ms
13. After cache bust, the next request rebuilds and serves fresh data
14. WebSocket `dashboard.summary.updated` is debounced — 5 rapid order events produce ≤ 1 emission per 2s window
15. With Redis down, summary still serves (DB fallback) but logs a warning
16. With Tables module unavailable, `summary.tablesOccupied = null`, other tiles still populated, status is 200

## Done when

- All 6 endpoints return correct shapes against seeded data
- Manager Dashboard renders all sections from real API responses (no mocks)
- Daily/Weekly/Monthly toggle on Sales Performance switches data live
- KPI tiles update in real time as orders flow through (without F5)
- Search box returns results within 200ms for typical queries
- Cache hit ratio visible in Redis (`INFO stats`) — should be > 90% under normal traffic
- Killing Redis does not break the dashboard (DB fallback works)

## Out of scope (future tickets)

- Custom date range picker
- Compare-to-previous overlay on the chart
- Cost / margin / profit columns
- Drilldown reports (Reports module v1.1)
- CSV / PDF / Excel export
- Per-cashier KPI breakdown
- Forecasting / re-order suggestions
- Multi-store roll-up dashboard
