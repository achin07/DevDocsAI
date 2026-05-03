import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { chunkText } from './utils/chunk-text';
import 'multer';
import pdf = require('pdf-parse');

@Injectable()
export class DocumentsService {
    constructor(private readonly prisma: PrismaService) { }

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

        const chunks = chunkText(text);

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
                metadata: chunk.metadata,
            })),
        });

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
                preview: chunk.content.slice(0, 200),
            })),
        };
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
