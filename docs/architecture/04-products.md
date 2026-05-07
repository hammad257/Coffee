# Module 4 — Products

The menu. Powers both the **Listings** page and the **Add New Product** page from the screenshots. Each product belongs to one category, has 1+ size variants, optional add-ons, and one or more images. This is the largest domain module — pricing, SKUs, variants, and add-ons all live here.

## Scope

**Ships:**
- `Product`, `ProductVariant`, `ProductAddon`, `ProductImage` tables
- CRUD: `/products`, `/products/:id/variants`, `/products/:id/addons`, `/products/:id/images`
- SKU generation (auto, format `<CAT>-<NAME>-<SEQ>`, e.g. `CF-EY-001`)
- Image upload to S3 with auto-generated thumbnails
- Bulk export to CSV
- Search by name, SKU, category, price range, stock status
- Soft delete + reinstate

**Does NOT ship:**
- Recipe / ingredient breakdown (we track sellable SKUs only — see Module 0 "Out of scope")
- Stock numbers themselves — those live in Module 5 (Inventory). This module only **reads** stock for display.
- Time-based pricing (happy-hour discounts) — Module 8 owns pricing rules.
- Product reviews / ratings.

## UI screens this module powers

- **Product → Listings Products** (screenshot 1)
  - Table cols: Image · Product Name · SKU/ID · Category · Price · Stock Qty · Status · Last Updated · Actions
  - Filters: All Categories · Stock Status · Price Range
  - Status pill: In Stock · Low Stock · Out of Stock (computed from Inventory module)
  - Row actions: View · Edit · Delete
  - Header actions: Export · Add New Product

- **Product → Add New Product** (screenshot 2)
  - **Product Details** card: name, category, SKU/Barcode, selling price, cost price
  - **Product Visuals** card: drag-and-drop image upload (recommended 800×800)
  - **Advanced Options** card: variants (Small 8oz / Medium 12oz / Large 16oz checkboxes, plus "Add Custom"), frequent add-ons
  - **Stock Management** card: stock quantity, auto-refill alerts toggle

## Prisma schema

```prisma
model Product {
  id               String         @id @default(uuid())
  sku              String         @unique           // auto-generated, e.g. "CF-EY-001"
  barcode          String?        @unique           // optional EAN/UPC if scanned
  name             String
  description      String?
  categoryId       String
  category         Category       @relation(fields: [categoryId], references: [id])

  // Pricing — base / default. Variants can override.
  basePriceCents   BigInt                            // selling price in cents
  costPriceCents   BigInt?                           // cost — used for margin reports
  taxRateBps       Int            @default(0)        // basis points (e.g. 500 = 5%)

  status           ProductStatus  @default(ACTIVE)
  isFeatured       Boolean        @default(false)    // Top Products candidate

  variants         ProductVariant[]
  addons           ProductAddon[]
  images           ProductImage[]
  stockMovements   StockMovement[]
  orderItems       OrderItem[]

  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
  createdById      String
  updatedById      String?
  deletedAt        DateTime?

  @@index([categoryId, status])
  @@index([sku])
  @@index([name])
  @@map("products")
}

enum ProductStatus {
  ACTIVE
  INACTIVE
  ARCHIVED   // hidden everywhere, used for discontinued items
}

model ProductVariant {
  id             String     @id @default(uuid())
  productId      String
  product        Product    @relation(fields: [productId], references: [id], onDelete: Cascade)

  name           String                  // "Small", "Medium", "Large", or custom
  size           String?                 // "8oz", "12oz" — for display
  priceDeltaCents BigInt    @default(0)  // added to product.basePriceCents
  sku            String     @unique      // "CF-EY-001-S"
  isDefault      Boolean    @default(false)
  displayOrder   Int        @default(0)

  // Per-variant stock — Module 5 tracks movements against this row.
  stockOnHand    Int        @default(0)  // denormalised for fast reads
  stockReserved  Int        @default(0)
  lowStockThreshold Int     @default(10)

  orderItems     OrderItem[]

  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  deletedAt      DateTime?

  @@unique([productId, name])
  @@index([productId, displayOrder])
  @@map("product_variants")
}

model ProductAddon {
  id             String   @id @default(uuid())
  productId      String
  product        Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  name           String                       // "Extra shot", "Oat milk", "Vanilla syrup"
  priceCents     BigInt   @default(0)
  isDefault      Boolean  @default(false)     // pre-checked on POS
  displayOrder   Int      @default(0)

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  deletedAt      DateTime?

  @@index([productId, displayOrder])
  @@map("product_addons")
}

model ProductImage {
  id          String   @id @default(uuid())
  productId   String
  product     Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  url         String                  // full-size, S3
  thumbUrl    String                  // 200×200 thumbnail
  altText     String?
  isPrimary   Boolean  @default(false)
  displayOrder Int     @default(0)

  createdAt   DateTime @default(now())

  @@index([productId, displayOrder])
  @@map("product_images")
}
```

### Variant model — important rule

A product **always has at least one variant**, even if the menu only sells one size. When a product is created without explicit variants, the service auto-creates a single "Default" variant with `priceDeltaCents = 0`. This keeps the order/inventory logic uniform: order items always reference a `variantId`, never a `productId` directly.

## SKU generation

Format: `<CategoryPrefix>-<NamePrefix>-<Seq>`
- `CategoryPrefix`: first 2 letters of category slug, upper-cased (`coffee` → `CF`)
- `NamePrefix`: first 2 letters of product name with non-alpha stripped, upper-cased (`Ethiopia Yirgacheffe` → `EY`)
- `Seq`: zero-padded 3-digit incrementing counter scoped to the prefix combo, starting at `001`

Example: `CF-EY-001` (Coffee · Ethiopia Yirgacheffe · #1)

Variant SKUs append `-S`, `-M`, `-L` (or first letter of variant name if custom): `CF-EY-001-S`.

The user can override SKU in the create/edit form. If overridden, uniqueness is checked but no auto-format is applied.

## DTOs

```ts
export class CreateProductDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsString() @IsOptional() description?: string;
  @IsUUID('4') categoryId: string;
  @IsString() @IsOptional() sku?: string;     // overrides auto-gen
  @IsString() @IsOptional() barcode?: string;

  @IsInt() @Min(0) basePriceCents: number;
  @IsInt() @Min(0) @IsOptional() costPriceCents?: number;
  @IsInt() @Min(0) @Max(10000) @IsOptional() taxRateBps?: number;

  @ValidateNested({ each: true })
  @Type(() => CreateVariantInline)
  @IsArray() @IsOptional() variants?: CreateVariantInline[];

  @ValidateNested({ each: true })
  @Type(() => CreateAddonInline)
  @IsArray() @IsOptional() addons?: CreateAddonInline[];

  @IsInt() @Min(0) @IsOptional() initialStock?: number;        // applied to default variant
  @IsInt() @Min(0) @IsOptional() lowStockThreshold?: number;
  @IsBoolean() @IsOptional() isFeatured?: boolean;
}

class CreateVariantInline {
  @IsString() name: string;
  @IsString() @IsOptional() size?: string;
  @IsInt() priceDeltaCents: number;
  @IsBoolean() @IsOptional() isDefault?: boolean;
  @IsInt() @Min(0) @IsOptional() initialStock?: number;
}

class CreateAddonInline {
  @IsString() name: string;
  @IsInt() @Min(0) priceCents: number;
  @IsBoolean() @IsOptional() isDefault?: boolean;
}

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['variants', 'addons', 'initialStock'] as const),
) {
  @IsEnum(ProductStatus) @IsOptional() status?: ProductStatus;
}

export class ProductSearchDto {
  @IsString() @IsOptional() q?: string;                            // matches name OR sku
  @IsUUID('4') @IsOptional() categoryId?: string;
  @IsEnum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']) @IsOptional() stockStatus?: string;
  @IsInt() @IsOptional() priceMinCents?: number;
  @IsInt() @IsOptional() priceMaxCents?: number;
  @IsEnum(ProductStatus) @IsOptional() status?: ProductStatus;
  @IsInt() @Min(1) @IsOptional() page?: number = 1;
  @IsInt() @Min(1) @Max(100) @IsOptional() pageSize?: number = 20;
  @IsString() @IsOptional() sort?: string = '-updatedAt';          // "+name" | "-price" | "-updatedAt"
}
```

## Endpoints

### GET /products

**Query:** see `ProductSearchDto`.

**200 OK:**
```json
{
  "items": [
    {
      "id": "uuid",
      "sku": "CF-EY-001",
      "name": "Ethiopia Yirgacheffe",
      "category": { "id": "uuid", "name": "Coffee" },
      "basePriceCents": 2400,
      "displayPrice": "24.00",
      "stockOnHand": 45,
      "stockStatus": "IN_STOCK",
      "primaryImageUrl": "https://...",
      "thumbUrl": "https://...",
      "status": "ACTIVE",
      "updatedAt": "2026-10-24T..."
    }
  ],
  "page": 1, "pageSize": 20, "total": 48
}
```

**Stock status logic** (computed at read time, sums all variants):
- `OUT_OF_STOCK` if `Σ stockOnHand == 0`
- `LOW_STOCK` if `0 < Σ stockOnHand ≤ Σ lowStockThreshold`
- `IN_STOCK` otherwise

**Permissions:** `product.read`.

### GET /products/:id

Full product with all variants, add-ons, images, computed stock status. Used by the Edit form.

**Permissions:** `product.read`.

### POST /products

Creates a product **and** its variants/add-ons in a single transaction. If `variants` is empty, a "Default" variant is auto-created with the product's `basePriceCents` and `initialStock`.

**Logic:**
1. Validate `categoryId` exists and is `ACTIVE`.
2. If `sku` not provided, generate one (see SKU rules above).
3. Insert product + variants + addons in one transaction.
4. If `initialStock > 0`, emit a `StockMovement` of type `INITIAL` for the default variant (Module 5 owns the table).
5. Audit log: `product.create`.

**Permissions:** `product.write`.

### PATCH /products/:id

Partial update. Same rules as create. Cannot change `categoryId` if the new category is INACTIVE. Audit log captures before/after diff.

**Permissions:** `product.write`.

### DELETE /products/:id

Soft delete. Also soft-deletes all variants. Open orders referencing this product are unaffected (variants stay queryable for historical orders).

**Errors:**
- `404 PRODUCT_NOT_FOUND`
- `409 PRODUCT_HAS_OPEN_ORDERS` — if the product appears in any non-finalised order, refuse and ask the manager to settle the orders first

**Permissions:** `product.write`.

### POST /products/:id/variants

Adds a new variant. Body: same as `CreateVariantInline`. Auto-generates variant SKU.

### PATCH /products/:id/variants/:variantId

Update name, size, priceDelta, isDefault, displayOrder, lowStockThreshold. Stock changes go through Module 5, **not** here.

### DELETE /products/:id/variants/:variantId

- Refuse (`409 LAST_VARIANT_REQUIRED`) if it's the only variant remaining.
- Refuse if the variant has open order items.
- Otherwise soft delete.

### POST /products/:id/addons / PATCH / DELETE

Standard CRUD. No special rules.

### POST /products/:id/images

`multipart/form-data` with one or more `image` fields. Per-file constraints: JPEG/PNG/WebP, ≤5 MB, max 2000×2000.

**Logic:**
1. Validate file (mime, dimensions via `sharp`).
2. Upload original to S3.
3. Generate 200×200 thumbnail with `sharp`, upload as `<id>-thumb.webp`.
4. Insert `ProductImage` row with `url` and `thumbUrl`.
5. If this is the first image, set `isPrimary = true`.

**Response:** the image objects.

**Permissions:** `product.write`.

### PATCH /products/:id/images/:imageId/primary

Marks this image as primary, un-marks others in a single transaction.

### DELETE /products/:id/images/:imageId

Hard delete (also removes from S3 — best-effort, log on failure but don't block).

### GET /products/export.csv

Streaming CSV download. Columns: `sku,name,category,base_price,cost_price,stock,status,updated_at`.

Respects current search filters via query params.

**Permissions:** `product.read`. Powers the **Export** button on the Listings page.

## Caching

The active product catalogue (filtered by `status = ACTIVE`) is what the POS reads on every render. Cache:

- `products:active:list:<query-hash>` — full list response, 60s TTL.
- `products:active:byid:<id>` — single product detail, 5min TTL.

Bust both on any write to product / variant / addon / image.

## Acceptance tests

1. Create product without variants → default variant auto-created with `basePriceCents`
2. Create product with 3 variants (S/M/L) → all rows created, SKUs auto-generated `-S/-M/-L`
3. Duplicate SKU on create → 409
4. Search by `q=ethio` matches both name and SKU prefix
5. Search by `stockStatus=LOW_STOCK` returns only products with `0 < onHand ≤ threshold`
6. Search by `priceMinCents=2000&priceMaxCents=3000` returns products in range, inclusive
7. Delete product with open orders → 409
8. Delete last variant of a product → 409 `LAST_VARIANT_REQUIRED`
9. Image upload generates a thumbnail and stores both in S3
10. CSV export honours search filters and streams (doesn't buffer the whole list)
11. Updating a product busts both list and detail caches
12. Inline creation flow: 1 transaction creates product + 3 variants + 4 addons + 1 stock movement

## Done when

- Listings page (screenshot 1) renders against `GET /products` with all filters working
- Add New Product page (screenshot 2) submits a single payload and gets back the created product
- Edit product page can update any field, including replacing variant lists
- Image drag-and-drop works on the Visuals card
- Stock pill (In Stock / Low Stock / Out of Stock) matches Module 5 numbers in real time
- Export button downloads a CSV that opens cleanly in Excel/Sheets

## Out of scope (future tickets)

- Recipe-level inventory (track grams of beans, not whole drinks)
- Time-based pricing (happy hour, daily specials)
- Product bundles / combos
- Per-channel pricing (cheaper online vs in-store)
- Translations (English-only menu in v1)
- Customer reviews
