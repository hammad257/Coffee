-- ProductCategory admin fields
ALTER TABLE "product_categories" ADD COLUMN     "description" TEXT,
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "product_categories_is_active_idx" ON "product_categories"("is_active");

-- Product admin / catalog fields
ALTER TABLE "products" ADD COLUMN     "sku" TEXT,
ADD COLUMN     "cost_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "auto_refill_alerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "is_draft" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "variants" JSONB,
ADD COLUMN     "addons" JSONB;

CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

CREATE INDEX "products_is_draft_idx" ON "products"("is_draft");
