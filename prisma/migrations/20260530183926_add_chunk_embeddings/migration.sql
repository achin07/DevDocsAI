CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "DocumentChunk"
ADD COLUMN IF NOT EXISTS "embedding" vector(1024);

ALTER TABLE "DocumentChunk"
ADD COLUMN IF NOT EXISTS "embeddingModel" TEXT;

ALTER TABLE "DocumentChunk"
ADD COLUMN IF NOT EXISTS "embeddingDimension" INTEGER;

ALTER TABLE "DocumentChunk"
ADD COLUMN IF NOT EXISTS "embeddingStatus" TEXT NOT NULL DEFAULT 'PENDING';

ALTER TABLE "DocumentChunk"
ADD COLUMN IF NOT EXISTS "embeddedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
ON "DocumentChunk"
USING hnsw ("embedding" vector_cosine_ops);