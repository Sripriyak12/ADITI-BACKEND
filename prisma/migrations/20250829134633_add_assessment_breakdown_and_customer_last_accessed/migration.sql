/*
  Warnings:

  - Added the required column `breakdown` to the `Assessment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."Assessment" ADD COLUMN     "breakdown" JSONB NOT NULL;

-- AlterTable
ALTER TABLE "public"."Customer" ADD COLUMN     "lastAccessed" TIMESTAMP(3);
