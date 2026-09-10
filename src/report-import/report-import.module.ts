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
import { StateSkuWiseReportService } from './services/state-sku-wise-report.service';
import { Gstr1B2csReportService } from './services/gstr1-b2cs-report.service';
import {
  SkuMasterMapping,
  SkuMasterMappingSchema,
} from '../sku-master/schemas/sku-master-mapping.schema';
import { SkuMasterModule } from '../sku-master/sku-master.module';
import {
  FlipkartPaymentReport,
  FlipkartPaymentReportSchema,
} from './payments/flipkart/schemas/flipkart-payment-report.schema';
import {
  SellerPayoutRecord,
  SellerPayoutRecordSchema,
} from './payments/schemas/seller-payout-record.schema';
import { FlipkartPaymentParser } from './payments/flipkart/flipkart-payment.parser';
import { FlipkartPaymentRepository } from './payments/flipkart/flipkart-payment.repository';
import { FlipkartPaymentService } from './payments/flipkart/flipkart-payment.service';
import { AnalyticsPaymentsService } from './payments/analytics-payments.service';
import { AnalyticsPayoutsService } from './payments/analytics-payouts.service';
import {
  FlipkartPaymentMpFeeRebate,
  FlipkartPaymentMpFeeRebateSchema,
} from './payments/flipkart/sheets/schemas/mp-fee-rebate.schema';
import {
  FlipkartPaymentNonOrderSpf,
  FlipkartPaymentNonOrderSpfSchema,
} from './payments/flipkart/sheets/schemas/non-order-spf.schema';
import {
  FlipkartPaymentStorageRecall,
  FlipkartPaymentStorageRecallSchema,
} from './payments/flipkart/sheets/schemas/storage-recall.schema';
import {
  FlipkartPaymentValueAddedServices,
  FlipkartPaymentValueAddedServicesSchema,
} from './payments/flipkart/sheets/schemas/value-added-services.schema';
import {
  FlipkartPaymentGoogleAdsServices,
  FlipkartPaymentGoogleAdsServicesSchema,
} from './payments/flipkart/sheets/schemas/google-ads-services.schema';
import {
  FlipkartPaymentAds,
  FlipkartPaymentAdsSchema,
} from './payments/flipkart/sheets/schemas/ads.schema';
import {
  FlipkartPaymentTcsRecovery,
  FlipkartPaymentTcsRecoverySchema,
} from './payments/flipkart/sheets/schemas/tcs-recovery.schema';
import {
  FlipkartPaymentTds,
  FlipkartPaymentTdsSchema,
} from './payments/flipkart/sheets/schemas/tds.schema';
import { FlipkartPaymentSecondaryRepository } from './payments/flipkart/sheets/flipkart-payment-secondary.repository';
import { FlipkartPaymentSecondaryService } from './payments/flipkart/sheets/flipkart-payment-secondary.service';
import {
  MeeshoOrderPayments,
  MeeshoOrderPaymentsSchema,
} from './payments/meesho/schemas/order-payments.schema';
import {
  MeeshoAdsCost,
  MeeshoAdsCostSchema,
} from './payments/meesho/schemas/ads-cost.schema';
import {
  MeeshoReferralPayments,
  MeeshoReferralPaymentsSchema,
} from './payments/meesho/schemas/referral-payments.schema';
import {
  MeeshoCompensationRecovery,
  MeeshoCompensationRecoverySchema,
} from './payments/meesho/schemas/compensation-recovery.schema';
import { MeeshoPaymentParser } from './payments/meesho/meesho-payment.parser';
import { MeeshoPaymentRepository } from './payments/meesho/meesho-payment.repository';
import { MeeshoPaymentService } from './payments/meesho/meesho-payment.service';
import {
  AmazonPaymentTransaction,
  AmazonPaymentTransactionSchema,
} from './payments/amazon/schemas/amazon-payment-transaction.schema';
import { AmazonPaymentParser } from './payments/amazon/amazon-payment.parser';
import { AmazonPaymentRepository } from './payments/amazon/amazon-payment.repository';
import { AmazonPaymentService } from './payments/amazon/amazon-payment.service';
import {
  MyntraPgSettlementRow,
  MyntraPgSettlementRowSchema,
} from './payments/myntra/schemas/myntra-pg-settlement.schema';
import { MyntraPgParser } from './payments/myntra/myntra-pg.parser';
import { MyntraPgRepository } from './payments/myntra/myntra-pg.repository';
import { MyntraPaymentService } from './payments/myntra/myntra-payment.service';
import { SettlementModule } from '../settlement/settlement.module';
import { SettlementBackfillService } from './services/settlement-backfill.service';
import { GeographyAnalyticsService } from './services/geography-analytics.service';
import { TrialModule } from '../trial/trial.module';

@Module({
  imports: [
    SkuMasterModule,
    SettlementModule,
    TrialModule,
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
      { name: SkuMasterMapping.name, schema: SkuMasterMappingSchema },
      { name: FlipkartPaymentReport.name, schema: FlipkartPaymentReportSchema },
      { name: SellerPayoutRecord.name, schema: SellerPayoutRecordSchema },
      {
        name: FlipkartPaymentMpFeeRebate.name,
        schema: FlipkartPaymentMpFeeRebateSchema,
      },
      {
        name: FlipkartPaymentNonOrderSpf.name,
        schema: FlipkartPaymentNonOrderSpfSchema,
      },
      {
        name: FlipkartPaymentStorageRecall.name,
        schema: FlipkartPaymentStorageRecallSchema,
      },
      {
        name: FlipkartPaymentValueAddedServices.name,
        schema: FlipkartPaymentValueAddedServicesSchema,
      },
      {
        name: FlipkartPaymentGoogleAdsServices.name,
        schema: FlipkartPaymentGoogleAdsServicesSchema,
      },
      { name: FlipkartPaymentAds.name, schema: FlipkartPaymentAdsSchema },
      {
        name: FlipkartPaymentTcsRecovery.name,
        schema: FlipkartPaymentTcsRecoverySchema,
      },
      { name: FlipkartPaymentTds.name, schema: FlipkartPaymentTdsSchema },
      { name: MeeshoOrderPayments.name, schema: MeeshoOrderPaymentsSchema },
      { name: MeeshoAdsCost.name, schema: MeeshoAdsCostSchema },
      {
        name: MeeshoReferralPayments.name,
        schema: MeeshoReferralPaymentsSchema,
      },
      {
        name: MeeshoCompensationRecovery.name,
        schema: MeeshoCompensationRecoverySchema,
      },
      {
        name: AmazonPaymentTransaction.name,
        schema: AmazonPaymentTransactionSchema,
      },
      { name: MyntraPgSettlementRow.name, schema: MyntraPgSettlementRowSchema },
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
    StateSkuWiseReportService,
    Gstr1B2csReportService,
    FlipkartPaymentParser,
    FlipkartPaymentRepository,
    FlipkartPaymentService,
    AnalyticsPaymentsService,
    AnalyticsPayoutsService,
    FlipkartPaymentSecondaryRepository,
    FlipkartPaymentSecondaryService,
    MeeshoPaymentParser,
    MeeshoPaymentRepository,
    MeeshoPaymentService,
    AmazonPaymentParser,
    AmazonPaymentRepository,
    AmazonPaymentService,
    MyntraPgParser,
    MyntraPgRepository,
    MyntraPaymentService,
    SettlementBackfillService,
    GeographyAnalyticsService,
  ],
})
export class ReportImportModule {}
