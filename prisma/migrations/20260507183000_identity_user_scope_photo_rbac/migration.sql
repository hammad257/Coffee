-- CreateEnum (replace UserStatus: remove SUSPENDED, add INACTIVE + PENDING)
CREATE TYPE "UserStatus_new" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING');

ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "users" ALTER COLUMN "status" TYPE "UserStatus_new" USING (
  CASE
    WHEN "status"::text = 'SUSPENDED' THEN 'INACTIVE'::"UserStatus_new"
    WHEN "status"::text = 'ACTIVE' THEN 'ACTIVE'::"UserStatus_new"
    ELSE 'INACTIVE'::"UserStatus_new"
  END
);

ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"UserStatus_new";

DROP TYPE "UserStatus";
ALTER TYPE "UserStatus_new" RENAME TO "UserStatus";

-- AlterTable
ALTER TABLE "users" ADD COLUMN "photo_url" TEXT;

-- CreateTable
CREATE TABLE "user_scopes" (
    "user_id" TEXT NOT NULL,
    "campus_ids" TEXT[] NOT NULL DEFAULT '{}',
    "department_ids" TEXT[] NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_scopes_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- AddForeignKey
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
