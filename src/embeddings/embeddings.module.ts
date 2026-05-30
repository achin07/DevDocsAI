import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EmbeddingsService } from './embeddings.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [HttpModule],
  providers: [EmbeddingsService, PrismaService],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}