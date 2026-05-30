/*
  Warnings:

  - You are about to drop the column `embeddedAt` on the `DocumentChunk` table. All the data in the column will be lost.
  - You are about to drop the column `embedding` on the `DocumentChunk` table. All the data in the column will be lost.
  - You are about to drop the column `embeddingDimension` on the `DocumentChunk` table. All the data in the column will be lost.
  - You are about to drop the column `embeddingModel` on the `DocumentChunk` table. All the data in the column will be lost.
  - You are about to drop the column `embeddingStatus` on the `DocumentChunk` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "DocumentChunk_embedding_hnsw_idx";

-- AlterTable
ALTER TABLE "DocumentChunk" DROP COLUMN "embeddedAt",
DROP COLUMN "embedding",
DROP COLUMN "embeddingDimension",
DROP COLUMN "embeddingModel",
DROP COLUMN "embeddingStatus";
