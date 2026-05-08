/*
  Warnings:

  - You are about to drop the `user_scopes` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "user_scopes" DROP CONSTRAINT "user_scopes_user_id_fkey";

-- DropTable
DROP TABLE "user_scopes";
