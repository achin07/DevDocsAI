import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

type EmbedResponse = {
  model: string;
  dimension: number;
  embeddings: number[][];
};

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);

  private readonly embeddingServiceUrl =
    process.env.EMBEDDING_SERVICE_URL ?? 'http://localhost:8001';

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
  ) {}

  async embedTexts(texts: string[]): Promise<EmbedResponse> {
    if (texts.length === 0) {
      return {
        model: process.env.EMBEDDING_MODEL ?? 'BAAI/bge-m3',
        dimension: Number(process.env.EMBEDDING_DIMENSION ?? 1024),
        embeddings: [],
      };
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<EmbedResponse>(`${this.embeddingServiceUrl}/embed`, {
          texts,
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error('Embedding service failed', error);
      throw new InternalServerErrorException('Failed to generate embeddings');
    }
  }

  async embedChunksForDocument(documentId: string): Promise<void> {
    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        documentId,
      },
      orderBy: {
        chunkIndex: 'asc',
      },
    });

    const semanticChunks = chunks.filter((chunk) => {
      const metadata = chunk.metadata as any;

      return metadata?.includeInSemanticIndex !== false;
    });

    const batchSize = 8;

    for (let i = 0; i < semanticChunks.length; i += batchSize) {
      const batch = semanticChunks.slice(i, i + batchSize);

      const texts = batch.map((chunk) => {
        const metadata = chunk.metadata as any;

        return (
          metadata?.embeddingText ??
          `${chunk.sectionTitle ?? ''}\n\n${chunk.contextHeader ?? ''}\n\n${chunk.content}`
        );
      });

      const result = await this.embedTexts(texts);

      if (result.embeddings.length !== batch.length) {
        throw new InternalServerErrorException(
          'Embedding service returned incorrect number of vectors',
        );
      }

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const embedding = result.embeddings[j];

        await this.saveChunkEmbedding({
          chunkId: chunk.id,
          embedding,
          model: result.model,
          dimension: result.dimension,
        });
      }
    }
  }

  private async saveChunkEmbedding(params: {
    chunkId: string;
    embedding: number[];
    model: string;
    dimension: number;
  }): Promise<void> {
    const vectorLiteral = `[${params.embedding.join(',')}]`;

    await this.prisma.$executeRaw`
      UPDATE "DocumentChunk"
      SET
        "embedding" = ${vectorLiteral}::vector,
        "embeddingModel" = ${params.model},
        "embeddingDimension" = ${params.dimension},
        "embeddingStatus" = 'EMBEDDED',
        "embeddedAt" = NOW()
      WHERE "id" = ${params.chunkId}
    `;
  }
}