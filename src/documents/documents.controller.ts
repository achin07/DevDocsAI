import {
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(@UploadedFile() file: Express.Multer.File) {
    return this.documentsService.uploadDocument(file);
  }

  @Get()
  async findAllDocuments() {
    return this.documentsService.findAllDocuments();
  }

  @Get(':id')
  async findDocumentById(@Param('id') id: string) {
    return this.documentsService.findDocumentById(id);
  }
}
