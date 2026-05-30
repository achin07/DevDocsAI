import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { chunkText } from './utils/chunk-text';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import 'multer';
import pdf = require('pdf-parse');

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  async uploadDocument(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const isMarkdownOrText =
      file.originalname.endsWith('.md') ||
      file.originalname.endsWith('.txt') ||
      file.mimetype === 'text/plain' ||
      file.mimetype === 'text/markdown';

    const isPdf =
      file.originalname.endsWith('.pdf') ||
      file.mimetype === 'application/pdf';

    const isAllowed = isMarkdownOrText || isPdf;

    if (!isAllowed) {
      throw new BadRequestException('Only .md, .txt, and .pdf files are allowed for now');
    }

    let text = '';

    if (isPdf) {
      const parsedPdf = await pdf(file.buffer);
      text = parsedPdf.text;
    } else {
      text = file.buffer.toString('utf-8');
    }

    if (!text.trim()) {
      throw new BadRequestException('Uploaded file is empty');
    }

    const document = await this.prisma.document.create({
      data: {
        title: file.originalname.replace(/\.(md|txt|pdf)$/i, ''),
        fileName: file.originalname,
        mimeType: file.mimetype || 'text/plain',
        sizeBytes: file.size,
        status: 'PROCESSING',
      },
    });

    try {
      const chunks = chunkText(text, {
        sourceName: file.originalname,
        maxChars: 1200,
        overlapChars: 150,

        // For the Gita PDF, keep v1 focused on useful English retrieval.
        // Change these later if you want Sanskrit/Synonyms indexed too.
        includeOriginalText: false,
        includeSynonyms: false,
      });

      if (chunks.length === 0) {
        await this.prisma.document.update({
          where: { id: document.id },
          data: { status: 'FAILED' },
        });

        throw new BadRequestException('Could not create chunks from document');
      }

      await this.prisma.documentChunk.createMany({
        data: chunks.map((chunk) => ({
          documentId: document.id,
          content: chunk.content,
          chunkIndex: chunk.chunkIndex,

          tokenEstimate: chunk.tokenEstimate,
          charCount: chunk.charCount,

          startChar: chunk.startChar,
          endChar: chunk.endChar,

          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,

          sectionTitle: chunk.sectionTitle,
          strategy: chunk.strategy,

          previousChunkIndex: chunk.previousChunkIndex,
          nextChunkIndex: chunk.nextChunkIndex,

          contextHeader: chunk.contextHeader,

          metadata: chunk.metadata,

          // These fields must exist in your Prisma schema.
          embeddingStatus: chunk.metadata?.includeInSemanticIndex === false ? 'SKIPPED' : 'PENDING',
        })),
      });

      /**
       * Important:
       * Embeddings must be generated AFTER createMany because the chunks need DB ids.
       * embedChunksForDocument(document.id) will:
       * 1. Load chunks from DB
       * 2. Send embeddingText/content to Python embedding service
       * 3. Store returned vectors in pgvector using raw SQL
       */
      await this.embeddingsService.embedChunksForDocument(document.id);

      const updatedDocument = await this.prisma.document.update({
        where: { id: document.id },
        data: { status: 'INDEXED' },
        include: {
          chunks: {
            orderBy: {
              chunkIndex: 'asc',
            },
          },
        },
      });

      return {
        documentId: updatedDocument.id,
        title: updatedDocument.title,
        fileName: updatedDocument.fileName,
        status: updatedDocument.status,
        chunkCount: updatedDocument.chunks.length,
        chunks: updatedDocument.chunks.map((chunk) => ({
          id: chunk.id,
          chunkIndex: chunk.chunkIndex,
          tokenEstimate: chunk.tokenEstimate,
          charCount: chunk.charCount,
          sectionTitle: chunk.sectionTitle,
          strategy: chunk.strategy,
          startChar: chunk.startChar,
          endChar: chunk.endChar,
          previousChunkIndex: chunk.previousChunkIndex,
          nextChunkIndex: chunk.nextChunkIndex,
          contextHeader: chunk.contextHeader,
          embeddingStatus: chunk.embeddingStatus,
          embeddingModel: chunk.embeddingModel,
          embeddingDimension: chunk.embeddingDimension,
          preview: chunk.content.slice(0, 200),
        })),
      };
    } catch (error) {
      await this.prisma.document.update({
        where: { id: document.id },
        data: { status: 'FAILED' },
      });

      if (error instanceof BadRequestException) {
        throw error;
      }

      console.error('Document upload/indexing failed:', error);

      throw new InternalServerErrorException(
        'Document was uploaded but indexing failed',
      );
    }
  }

  async findAllDocuments() {
    return this.prisma.document.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        _count: {
          select: {
            chunks: true,
          },
        },
      },
    });
  }

  async findDocumentById(id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
      include: {
        chunks: {
          orderBy: {
            chunkIndex: 'asc',
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }
}