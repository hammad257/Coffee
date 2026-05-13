-- CreateEnum
CREATE TYPE "UserActivityType" AS ENUM ('LOGIN', 'PASSWORD_CHANGED', 'PROFILE_UPDATED', 'SETTINGS_UPDATED', 'STOCK_UPDATED', 'ORDER_ACTIVITY', 'OTHER');

-- CreateTable
CREATE TABLE "store_settings" (
    "id" TEXT NOT NULL,
    "store_name" VARCHAR(160) NOT NULL DEFAULT 'Élite de Paris',
    "address" TEXT,
    "contact_phone" VARCHAR(48),
    "contact_email" VARCHAR(254),
    "store_logo_url" VARCHAR(2048),
    "currency_code" VARCHAR(12) NOT NULL DEFAULT 'USD',
    "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
    "tax_enabled" BOOLEAN NOT NULL DEFAULT true,
    "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "tax_rate" DECIMAL(7,4) NOT NULL DEFAULT 0.08,
    "payment_cash_enabled" BOOLEAN NOT NULL DEFAULT true,
    "payment_card_enabled" BOOLEAN NOT NULL DEFAULT true,
    "payment_online_enabled" BOOLEAN NOT NULL DEFAULT true,
    "low_stock_alerts_enabled" BOOLEAN NOT NULL DEFAULT true,
    "order_sound_enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_print_receipts" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" TEXT,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "store_settings" ("id", "updated_at") VALUES ('default', CURRENT_TIMESTAMP);

-- CreateTable
CREATE TABLE "user_activities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "activity_type" "UserActivityType" NOT NULL,
    "title" VARCHAR(220) NOT NULL,
    "detail" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_activities_user_id_created_at_idx" ON "user_activities"("user_id", "created_at" DESC);

ALTER TABLE "user_activities" ADD CONSTRAINT "user_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users" ADD COLUMN     "phone" VARCHAR(48),
ADD COLUMN "bio" TEXT,
ADD COLUMN "job_title" VARCHAR(120),
ADD COLUMN "work_location" VARCHAR(160),
ADD COLUMN "notification_frequency" VARCHAR(32) NOT NULL DEFAULT 'daily_digest',
ADD COLUMN "system_language" VARCHAR(24) NOT NULL DEFAULT 'en-US';

