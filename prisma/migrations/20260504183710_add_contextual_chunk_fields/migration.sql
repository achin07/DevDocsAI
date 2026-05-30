-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentStatus" ADD VALUE 'CHUNKED';
ALTER TYPE "DocumentStatus" ADD VALUE 'EMBEDDING';

-- AlterTable
ALTER TABLE "DocumentChunk" ADD COLUMN     "charCount" INTEGER,
ADD COLUMN     "contextHeader" TEXT,
ADD COLUMN     "endChar" INTEGER,
ADD COLUMN     "nextChunkIndex" INTEGER,
ADD COLUMN     "pageEnd" INTEGER,
ADD COLUMN     "pageStart" INTEGER,
ADD COLUMN     "previousChunkIndex" INTEGER,
ADD COLUMN     "sectionTitle" TEXT,
ADD COLUMN     "startChar" INTEGER,
ADD COLUMN     "strategy" TEXT;

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_chunkIndex_idx" ON "DocumentChunk"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_pageStart_idx" ON "DocumentChunk"("documentId", "pageStart");
