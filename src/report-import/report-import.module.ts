import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Gst, GstSchema } from '../gsts/schemas/gst.schema';
import {
  Marketplace,
  MarketplaceSchema,
} from '../marketplaces/schemas/marketplace.schema';
import { ReportImportController } from './report-import.controller';
import { ReportImportService } from './report-import.service';
import {
  ImportUpload,
  ImportUploadSchema,
} from './schemas/import-upload.schema';
import { ImportRow, ImportRowSchema } from './schemas/import-row.schema';
import {
  ImportRowError,
  ImportRowErrorSchema,
} from './schemas/import-row-error.schema';
import { FileParserService } from './services/file-parser.service';
import { MappingService } from './services/mapping.service';
import { UploadService } from './services/upload.service';
import { ValidationService } from './services/validation.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Gst.name, schema: GstSchema },
      { name: Marketplace.name, schema: MarketplaceSchema },
      { name: ImportUpload.name, schema: ImportUploadSchema },
      { name: ImportRow.name, schema: ImportRowSchema },
      { name: ImportRowError.name, schema: ImportRowErrorSchema },
    ]),
  ],
  controllers: [ReportImportController],
  providers: [
    ReportImportService,
    FileParserService,
    ValidationService,
    MappingService,
    UploadService,
  ],
})
export class ReportImportModule {}
