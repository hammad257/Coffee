-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'SERVED';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'QR';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "amount_tendered" DECIMAL(12,2),
ADD COLUMN     "assigned_to_id" TEXT,
ADD COLUMN     "change_due" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "orders_assigned_to_id_idx" ON "orders"("assigned_to_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
