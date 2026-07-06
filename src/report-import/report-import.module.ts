import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Gst, GstSchema } from '../gsts/schemas/gst.schema';
import {
  Marketplace,
  MarketplaceSchema,
} from '../marketplaces/schemas/marketplace.schema';
import {
  PlatformMarketplace,
  PlatformMarketplaceSchema,
} from '../platform-marketplaces/schemas/platform-marketplace.schema';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
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
import { MeeshoImportService } from './services/meesho-import.service';
import { FlipkartImportService } from './services/flipkart-import.service';
import { AmazonImportService } from './services/amazon-import.service';
import { UploadService } from './services/upload.service';
import { MyntraImportService } from './services/myntra-import.service';
import { ValidationService } from './services/validation.service';
import {
  ImportSlotRecord,
  ImportSlotRecordSchema,
} from './schemas/import-slot-record.schema';
import { ImportWorkflowService } from './services/import-workflow.service';
import { ImportSessionService } from './services/import-session.service';
import { ImportJob, ImportJobSchema } from './schemas/import-job.schema';
import {
  ReconTransaction,
  ReconTransactionSchema,
} from './schemas/recon-transaction.schema';
import { ReconEvent, ReconEventSchema } from './schemas/recon-event.schema';
import {
  ReconAuditLog,
  ReconAuditLogSchema,
} from './schemas/recon-audit-log.schema';
import {
  ReconAdjustment,
  ReconAdjustmentSchema,
} from './schemas/recon-adjustment.schema';
import { ImportJobService } from './services/import-job.service';
import { ImportFileStoreService } from './services/import-file-store.service';
import { ImportQueueService } from './services/import-queue.service';
import { ImportJobOrchestratorService } from './services/import-job-orchestrator.service';
import { ImportProgressGateway } from './gateways/import-progress.gateway';
import { ReconciliationService } from './services/reconciliation.service';
import { StateWiseReportService } from './services/state-wise-report.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Gst.name, schema: GstSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: User.name, schema: UserSchema },
      { name: Marketplace.name, schema: MarketplaceSchema },
      { name: PlatformMarketplace.name, schema: PlatformMarketplaceSchema },
      { name: ImportUpload.name, schema: ImportUploadSchema },
      { name: ImportRow.name, schema: ImportRowSchema },
      { name: ImportRowError.name, schema: ImportRowErrorSchema },
      { name: ImportSlotRecord.name, schema: ImportSlotRecordSchema },
      { name: ImportJob.name, schema: ImportJobSchema },
      { name: ReconTransaction.name, schema: ReconTransactionSchema },
      { name: ReconEvent.name, schema: ReconEventSchema },
      { name: ReconAuditLog.name, schema: ReconAuditLogSchema },
      { name: ReconAdjustment.name, schema: ReconAdjustmentSchema },
    ]),
  ],
  controllers: [ReportImportController],
  providers: [
    ReportImportService,
    FileParserService,
    ValidationService,
    MappingService,
    MeeshoImportService,
    FlipkartImportService,
    AmazonImportService,
    MyntraImportService,
    UploadService,
    ImportSessionService,
    ImportWorkflowService,
    ImportJobService,
    ImportFileStoreService,
    ImportQueueService,
    ImportJobOrchestratorService,
    ImportProgressGateway,
    ReconciliationService,
    StateWiseReportService,
  ],
})
export class ReportImportModule {}
