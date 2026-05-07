# Module 3 — Categories

Top-level groupings for menu items: **Coffee · Tea · Equipment · Syrups · Pastries · Cold Drinks**, etc. The Manager Dashboard's **Manage Categories** screen is powered entirely by this module.

## Scope

**Ships:**
- `Category` table
- CRUD: `/categories`
- Soft delete with **product-count guard** (cannot delete a category that still owns products)
- Activate / deactivate (hides from POS without deleting)
- Display ordering (drag-and-drop sort on the frontend → `displayOrder` int)
- Bulk activate / deactivate / delete
- Slug + icon + colour for menu rendering

**Does NOT ship:**
- Sub-categories / nested trees (flat list in v1)
- Per-channel visibility (e.g. "show on Online but hide from POS") — deferred to v1.1
- Category-level discounts (Module 8 owns pricing rules)

## UI screens this module powers

- **Product → Manage Categories** screen (screenshot 4)
  - Search by name
  - Multi-select with bulk Activate / Deactivate / Delete
  - Action-required banner: *"Cannot delete category 'Signature Espresso' because it contains 24 products. Please move products to another category first."*
  - Status pill: Active / Inactive

## Prisma schema

```prisma
model Category {
  id           String     @id @default(uuid())
  name         String
  slug         String     @unique  // url-safe, auto-generated from name
  description  String?
  iconUrl      String?    // optional icon stored on S3
  colorHex     String?    @default("#2F6E4E") // for UI accents
  status       CategoryStatus @default(ACTIVE)
  displayOrder Int        @default(0)

  products     Product[]

  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  createdById  String
  updatedById  String?
  deletedAt    DateTime?

  @@index([status, displayOrder])
  @@index([slug])
  @@map("categories")
}

enum CategoryStatus {
  ACTIVE
  INACTIVE
}
```

## Seed data

```ts
[
  { name: "Coffee",     slug: "coffee",     displayOrder: 1, colorHex: "#3F2E22" },
  { name: "Tea",        slug: "tea",        displayOrder: 2, colorHex: "#5B7A3F" },
  { name: "Cold Drinks",slug: "cold-drinks",displayOrder: 3, colorHex: "#3A6EA5" },
  { name: "Pastries",   slug: "pastries",   displayOrder: 4, colorHex: "#A56A3A" },
  { name: "Syrups",     slug: "syrups",     displayOrder: 5, colorHex: "#8E3A6E" },
  { name: "Equipment",  slug: "equipment",  displayOrder: 6, colorHex: "#555555" },
]
```

## DTOs

```ts
export class CreateCategoryDto {
  @IsString() @MinLength(2) @MaxLength(60) name: string;
  @IsString() @IsOptional() description?: string;
  @IsHexColor() @IsOptional() colorHex?: string;
  @IsUrl() @IsOptional() iconUrl?: string;
  @IsInt() @Min(0) @IsOptional() displayOrder?: number;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {
  @IsEnum(CategoryStatus) @IsOptional() status?: CategoryStatus;
}

export class BulkCategoryActionDto {
  @IsArray() @ArrayNotEmpty() @IsUUID('4', { each: true }) ids: string[];
  @IsEnum(['ACTIVATE', 'DEACTIVATE', 'DELETE']) action: string;
}

export class ReorderDto {
  @IsArray() @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReorderItem)
  items: ReorderItem[];
}

class ReorderItem {
  @IsUUID('4') id: string;
  @IsInt() @Min(0) displayOrder: number;
}
```

## Endpoints

### GET /categories

**Query:** `?status=ACTIVE&search=coff&page=1&pageSize=50&include=productCount`

**200 OK:**
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Coffee",
      "slug": "coffee",
      "status": "ACTIVE",
      "displayOrder": 1,
      "colorHex": "#3F2E22",
      "productCount": 24
    }
  ],
  "page": 1, "pageSize": 50, "total": 6
}
```

`productCount` is computed via Prisma `_count.products` and only returned when `?include=productCount`.

**Permissions:** `category.read`.

### POST /categories

**Request:**
```json
{ "name": "Signature Espresso", "colorHex": "#3F2E22", "displayOrder": 7 }
```

**Logic:**
- Auto-generate slug from `name`. If collision, append `-2`, `-3`, …
- Default status `ACTIVE`.

**201 Created:** the category.

**Errors:**
- `409 CATEGORY_NAME_TAKEN`

**Permissions:** `category.write`.

### PATCH /categories/:id

Partial update. If `name` changes, slug stays the same (avoids breaking URLs).

**Permissions:** `category.write`.

### DELETE /categories/:id

**Logic:**
1. Count non-deleted products where `categoryId = :id`.
2. If `count > 0` → `409 CATEGORY_HAS_PRODUCTS`, with body:
   ```json
   {
     "errorCode": "CATEGORY_HAS_PRODUCTS",
     "message": "Cannot delete category 'Signature Espresso' because it contains 24 products.",
     "details": { "categoryId": "uuid", "productCount": 24 }
   }
   ```
3. Otherwise soft delete (`deletedAt = now()`).

**Errors:**
- `404 CATEGORY_NOT_FOUND`
- `409 CATEGORY_HAS_PRODUCTS`

**Permissions:** `category.write`.

### POST /categories/bulk

**Request:**
```json
{ "ids": ["uuid1", "uuid2"], "action": "DELETE" }
```

**Logic per action:**
- `ACTIVATE` / `DEACTIVATE` — flip status, no product check.
- `DELETE` — partial success: any category with products is skipped, response lists which succeeded vs which failed.

**Response:**
```json
{
  "succeeded": ["uuid1"],
  "failed": [
    { "id": "uuid2", "reason": "CATEGORY_HAS_PRODUCTS", "productCount": 8 }
  ]
}
```

**Permissions:** `category.write`.

### POST /categories/reorder

**Request:**
```json
{
  "items": [
    { "id": "uuid1", "displayOrder": 1 },
    { "id": "uuid2", "displayOrder": 2 }
  ]
}
```

**Logic:** single transaction, update `displayOrder` for each. Returns `204 No Content`.

**Permissions:** `category.write`.

### POST /categories/:id/icon

Upload an icon image (PNG/SVG, ≤200 KB, ≤256×256). Multipart `image` field. Stores to S3, sets `iconUrl`.

**Permissions:** `category.write`.

## Caching

The category list is read on **every POS render** and the menu is small (typically <30 categories). Cache the active list in Redis under key `categories:active` for 5 minutes. Bust on any write (create/update/delete/reorder/bulk).

## Product-count denormalisation (later)

If product counts become a hot query (top of every dashboard render), denormalise: add `productCount Int @default(0)` to `Category`, increment/decrement in the `products` module's create/delete service. Out of scope for v1 — `_count.products` via Prisma is fine for now.

## Acceptance tests

1. Create category → 201, slug auto-generated
2. Create with duplicate name → 409
3. Delete empty category → 204
4. Delete category with 24 products → 409 with `productCount: 24`
5. Bulk delete: 1 succeeds, 1 fails → 200 with succeeded/failed arrays
6. Reorder updates `displayOrder` for all items in a single transaction (rollback if any fails)
7. GET with `?include=productCount` returns counts; without flag, omits the field
8. Soft-deleted categories are excluded from default GET (re-included with `?includeDeleted=true` for admins)
9. Reading after a write busts the Redis cache

## Done when

- Manage Categories page (screenshot 4) works end-to-end against the API
- Drag-and-drop reorder persists and reflects on POS
- Banner copy matches the `409 CATEGORY_HAS_PRODUCTS` body
- Cache hit/miss visible in Redis MONITOR during dev

## Out of scope (future tickets)

- Sub-categories
- Per-channel visibility
- Category-level promotions / discounts
- Bulk move products between categories (Module 4 ships that)
