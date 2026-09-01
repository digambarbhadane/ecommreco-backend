import {
  BadRequestException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { parseObjectId } from '../../common/mongo-id.util';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UploadReportDto } from '../dto/upload-report.dto';
import {
  collectUploadedSlotsFromFiles,
  inferUploadedSlotsFromFileHash,
} from '../import-slot.constants';
import {
  ImportUpload,
  ImportUploadDocument,
} from '../schemas/import-upload.schema';
import { ImportRow, ImportRowDocument } from '../schemas/import-row.schema';
import {
  ImportRowError,
  ImportRowErrorDocument,
} from '../schemas/import-row-error.schema';
import { FileParserService } from './file-parser.service';
import { MeeshoImportService } from './meesho-import.service';
import { FlipkartImportService } from './flipkart-import.service';
import { AmazonImportService } from './amazon-import.service';
import { applyFlipkartInvoiceAmount } from '../utils/flipkart-invoice.util';
import { MyntraImportService } from './myntra-import.service';
import {
  MappingService,
  MEESHO_ORDER_ID_ALIASES,
  NormalizedImportRow,
  ParsedSheetRow,
  getRowCell,
} from './mapping.service';
import { amazonImportMapping } from '../config/importMappings/amazon.mapping';
import { AMAZON_B2B_EXTRA_HEADER_GROUPS } from '../config/importMappings/amazon-b2b.constants';
import { flipkartImportMapping } from '../config/importMappings/flipkart.mapping';
import { meeshoImportMapping } from '../config/importMappings/meesho.mapping';
import { MEESHO_PAYMENT_REQUIRED_HEADER_GROUPS } from '../config/importMappings/meesho-payment.mapping';
import { FLIPKART_PAYMENT_REQUIRED_HEADER_GROUPS } from '../config/importMappings/flipkart-payment.mapping';
import { FLIPKART_RETURN_REQUIRED_HEADER_GROUPS } from '../config/importMappings/flipkart-return.mapping';
import { AMAZON_RETURN_REQUIRED_HEADER_GROUPS } from '../config/importMappings/amazon-return.mapping';
import { SettlementService } from '../../settlement/settlement.service';
import type { NormalizedTransaction } from '../../settlement/schemas/normalized-transaction.schema';
import { classifyFlipkartSettlementRow } from '../../settlement/utils/flipkart-settlement-classifier.util';
import {
  applyFlipkartReturnDetailsToRow,
  isFlipkartReturnVoucherType,
  lookupFlipkartReturnDetails,
  type FlipkartReturnDetails,
} from '../utils/flipkart-return.util';
import {
  applyAmazonReturnDetailsToRow,
  applyAmazonReturnTransactionDefaults,
  lookupAmazonReturnDetails,
  type AmazonReturnDetails,
} from '../utils/amazon-return.util';
import {
  isAmazonCancellationTransaction,
  isAmazonCountableReturnTransaction,
  buildAmazonImportDebugReport,
  shouldSkipAmazonMtrImportRow,
} from '../utils/amazon-analytics.util';
import { ValidationService } from './validation.service';
import {
  correctMyntraReturnFileAssignment,
  formatMyntraEmptyImport,
  formatMyntraJoinIssues,
  MYNTRA_GSTR_PACKED_HEADERS,
  MYNTRA_GSTR_RTO_HEADERS,
  MYNTRA_GSTR_RT_HEADERS,
  MYNTRA_MDIRECT_ORDERS_HEADERS,
  MYNTRA_MDIRECT_RETURNS_HEADERS,
  MYNTRA_SALES_REVENUE_HEADERS,
} from '../utils/myntra-import.validation';
import { insertImportRowsInBatches } from './upload-row.util';
import { ImportWorkflowService } from './import-workflow.service';
import { ImportFileStoreService } from './import-file-store.service';
import { ImportJobService } from './import-job.service';
import {
  ImportPerformanceTimer,
  yieldToEventLoop,
} from '../utils/import-performance.util';
import type { ImportJobPhase } from '../schemas/import-job.schema';
import { ImportJobOrchestratorService } from './import-job-orchestrator.service';
import {
  buildPaymentOnlySlotDetail,
  buildSlotUploadDetails,
} from '../utils/slot-upload-details';
import { ReconciliationService } from './reconciliation.service';
import { SkuMasterSyncService } from '../../sku-master/sku-master-sync.service';
import { FlipkartPaymentService } from '../payments/flipkart/flipkart-payment.service';
import { MeeshoPaymentService } from '../payments/meesho/meesho-payment.service';
import { AmazonPaymentService } from '../payments/amazon/amazon-payment.service';
import { AnalyticsPayoutsService } from '../payments/analytics-payouts.service';
import {
  AMAZON_MAX_PAYMENT_FILES,
  buildAmazonPaymentFileHash,
  buildAmazonPaymentSlotKey,
  isAmazonPaymentSlot,
} from '../utils/amazon-payment-upload.util';
import { MyntraPaymentService } from '../payments/myntra/myntra-payment.service';
import {
  buildMyntraPaymentFileHash,
  hasMyntraPaymentFiles,
  isMyntraPaymentSlot,
  MYNTRA_PAYMENT_SLOTS,
} from '../utils/myntra-payment-upload.util';

type UploadContext = Awaited<
  ReturnType<ValidationService['validateOwnership']>
>;

type UploadedFileInput = { buffer: Buffer; originalname: string };

type MarketplaceFilesInput = {
  file?: UploadedFileInput;
  mtrB2bFile?: UploadedFileInput;
  mtrB2cFile?: UploadedFileInput;
  tcsSalesFile?: UploadedFileInput;
  tcsSalesReturnFile?: UploadedFileInput;
  orderReportFile?: UploadedFileInput;
  returnInTransitReportFile?: UploadedFileInput;
  returnOutForDeliveryReportFile?: UploadedFileInput;
  returnDeliveryCompleteReportFile?: UploadedFileInput;
  paymentReportFile?: UploadedFileInput;
  paymentReportFiles?: UploadedFileInput[];
  returnReportFile?: UploadedFileInput;
  amazonReturnReportFile?: UploadedFileInput;
  gstrReportPackedFile?: UploadedFileInput;
  mDirectOrdersReportFile?: UploadedFileInput;
  salesRevenuePackedB2cFile?: UploadedFileInput;
  gstrReportRtoFile?: UploadedFileInput;
  gstrReportRtFile?: UploadedFileInput;
  mDirectReturnsReportFile?: UploadedFileInput;
  pgForwardSettledFile?: UploadedFileInput;
  pgReverseSettledFile?: UploadedFileInput;
};

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly parser: FileParserService,
    private readonly meeshoImport: MeeshoImportService,
    private readonly flipkartImport: FlipkartImportService,
    private readonly amazonImport: AmazonImportService,
    private readonly myntraImport: MyntraImportService,
    private readonly validation: ValidationService,
    private readonly mapping: MappingService,
    @InjectModel(ImportUpload.name)
    private readonly uploadModel: Model<ImportUploadDocument>,
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRowDocument>,
    @InjectModel(ImportRowError.name)
    private readonly rowErrorModel: Model<ImportRowErrorDocument>,
    private readonly importWorkflow: ImportWorkflowService,
    private readonly fileStore: ImportFileStoreService,
    private readonly importJobService: ImportJobService,
    private readonly reconciliationService: ReconciliationService,
    private readonly skuMasterSyncService: SkuMasterSyncService,
    private readonly flipkartPaymentService: FlipkartPaymentService,
    private readonly meeshoPaymentService: MeeshoPaymentService,
    private readonly amazonPaymentService: AmazonPaymentService,
    private readonly myntraPaymentService: MyntraPaymentService,
    private readonly analyticsPayoutsService: AnalyticsPayoutsService,
    private readonly settlementService: SettlementService,
    @Inject(forwardRef(() => ImportJobOrchestratorService))
    private readonly importOrchestrator: ImportJobOrchestratorService,
  ) {}

  async getUploadStatus(uploadId: string, sellerId: string) {
    const upload = await this.uploadModel
      .findById(parseObjectId(uploadId, 'upload id'))
      .lean()
      .exec();
    if (
      !upload ||
      !(await this.validation.sellerOwnsRecord(
        String(upload.sellerId),
        sellerId,
      ))
    ) {
      throw new NotFoundException('Import upload not found');
    }
    const totalExpected = upload.totalRecords ?? 0;
    const savedSoFar =
      upload.status === 'completed'
        ? totalExpected
        : Number(upload.processedRecords ?? 0);
    const fileLabel = String(upload.fileName ?? '').toLowerCase();
    const isPaymentOnly =
      String(upload.fileHash ?? '').includes('-payment|') ||
      (Array.isArray(upload.uploadedSlots) &&
        upload.uploadedSlots.length >= 1 &&
        upload.uploadedSlots.every(
          (slot) => slot === 'paymentReportFile' || isMyntraPaymentSlot(slot),
        ));
    const processingHint = isPaymentOnly
      ? 'Parsing payment report and saving settlement rows — large files may take 1–2 minutes.'
      : fileLabel.includes('myntra')
        ? 'Parsing and matching Myntra reports — large files may take a few minutes.'
        : fileLabel.includes('amazon')
          ? 'Parsing Amazon MTR reports — this may take a few minutes.'
          : 'Parsing report files and saving rows…';
    return {
      success: upload.status !== 'failed',
      uploadId,
      status: upload.status,
      count: savedSoFar,
      totalRecords: totalExpected,
      fileName: upload.fileName,
      errorMessage: upload.errorMessage,
      message:
        upload.status === 'processing'
          ? savedSoFar > 0
            ? `Import in progress… ${savedSoFar} row(s) saved so far.`
            : processingHint
          : upload.status === 'failed'
            ? (upload.errorMessage ?? 'Import failed')
            : `Import completed with ${savedSoFar} record(s).`,
    };
  }

  async uploadMarketplaceReport(
    expectedMarketplace: 'flipkart' | 'amazon' | 'meesho' | 'myntra',
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    options?: { reportType?: string; createdBy?: string },
  ) {
    if (!dto.reportMonth) {
      throw new BadRequestException(
        'reportMonth is required for marketplace imports',
      );
    }
    await this.validation.assertTrialImportAllowed(
      dto.sellerId,
      dto.reportMonth,
    );

    const hasPaymentFile =
      Boolean(files.paymentReportFile) ||
      Boolean(files.paymentReportFiles?.length) ||
      Boolean(files.pgForwardSettledFile) ||
      Boolean(files.pgReverseSettledFile);
    if (hasPaymentFile) {
      await this.validation.assertMainGstForPaymentUpload(
        dto.gstId,
        dto.sellerId,
      );
    }

    return this.importOrchestrator.enqueueMarketplaceImport(
      expectedMarketplace,
      files,
      dto,
      options,
    );
  }

  async assertRequiredFilesPublic(
    flags: { isAmazon: boolean; isMeesho: boolean; isMyntra: boolean },
    files: MarketplaceFilesInput,
    ownership?: {
      sellerId: string;
      gstId: string;
      marketplaceId: string;
      reportMonth: string;
    },
  ) {
    await this.assertRequiredFiles(flags, files, ownership);
  }

  buildFileHashBundlePublic(
    files: MarketplaceFilesInput,
    isAmazon: boolean,
    isMeesho: boolean,
    isMyntra: boolean,
  ) {
    return this.buildFileHashBundle(files, isAmazon, isMeesho, isMyntra);
  }

  async createProcessingUpload(input: {
    sellerId: string;
    dto: UploadReportDto;
    ctx: UploadContext;
    marketplaceId: string;
    fileName: string;
    uploadedSlots: string[];
    reportMonth: string;
  }) {
    const upload = await this.uploadModel.create({
      sellerId: input.sellerId,
      gstId: input.dto.gstId,
      gstin: input.ctx.gst.gstNumber,
      marketplace: input.marketplaceId,
      reportMonth: input.reportMonth,
      fileName: input.fileName,
      fileHash: `processing:${Date.now()}`,
      uploadedSlots: input.uploadedSlots,
      totalRecords: 0,
      salesRecords: 0,
      cashbackRecords: 0,
      status: 'processing',
      lifecycleStatus: 'processing',
    });
    return {
      uploadId: upload._id?.toString?.() ?? '',
    };
  }

  async runQueuedImport(
    jobId: string,
    expectedMarketplace: 'flipkart' | 'amazon' | 'meesho' | 'myntra',
    hooks?: {
      fileUploadMs?: number;
      onProgress?: (
        phase: ImportJobPhase,
        pct: number,
        rowsImported?: number,
        totalRecords?: number,
      ) => void;
    },
  ) {
    const job = await this.importJobService.getJob(jobId);
    const timer = new ImportPerformanceTimer();
    if (hooks?.fileUploadMs) {
      timer.addStageMs('fileUpload', hooks.fileUploadMs);
    }
    timer.startStage('fileRead');
    const stored = await this.fileStore.loadJobFiles(jobId);
    timer.endStage('fileRead');

    const files = this.storedToMarketplaceFiles(stored);
    const dto = job.dtoSnapshot as unknown as UploadReportDto;
    const ctx = await this.validation.validateOwnership(dto);
    const uploadId = job.uploadId ?? '';

    const marketplaceIdentifier = ctx.marketplaceIdentifier;
    const isAmazon = marketplaceIdentifier.includes('amazon');
    const isMeesho = marketplaceIdentifier.includes('meesho');
    const isMyntra = marketplaceIdentifier.includes('myntra');

    const { fileHashes, fileName } = this.buildFileHashBundle(
      files,
      isAmazon,
      isMeesho,
      isMyntra,
    );

    await this.validation.ensureNoDuplicateFileHashes({
      sellerId: ctx.canonicalSellerId || dto.sellerId,
      gstin: ctx.gst.gstNumber,
      marketplace: job.marketplaceId,
      fileHashes,
      excludeUploadId: uploadId,
      reportMonth: dto.reportMonth,
    });

    if (uploadId) {
      await this.uploadModel.findByIdAndUpdate(uploadId, {
        $set: { fileName },
      });
    }

    hooks?.onProgress?.('reading_excel', 10);

    const result = await this.processImport(
      expectedMarketplace,
      files,
      dto,
      ctx,
      uploadId || null,
      {
        timer,
        onProgress: hooks?.onProgress,
      },
    );

    await this.fileStore.cleanupJobFiles(jobId);

    timer.logSummary(this.logger, `job=${jobId}`, timer.getTimings());

    return {
      ...result,
      timings: timer.getTimings(),
      fileName,
    };
  }

  private storedToMarketplaceFiles(
    stored: Record<string, { buffer: Buffer; originalname: string }>,
  ): MarketplaceFilesInput {
    const out: MarketplaceFilesInput = {};
    const paymentReportFiles: UploadedFileInput[] = [];
    for (const [slot, file] of Object.entries(stored)) {
      if (
        slot === 'paymentReportFile' ||
        slot.startsWith('amazonPaymentFile:')
      ) {
        paymentReportFiles.push(file);
        continue;
      }
      (out as Record<string, UploadedFileInput>)[slot] = file;
    }
    if (paymentReportFiles.length) {
      out.paymentReportFiles = paymentReportFiles;
      out.paymentReportFile = paymentReportFiles[0];
    }
    return out;
  }

  /** Respond immediately; parse/validate/insert from in-memory buffers (no disk). */
  private async startInMemoryBackgroundImport(
    expectedMarketplace: 'flipkart' | 'amazon' | 'meesho' | 'myntra',
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
    flags: { isAmazon: boolean; isMeesho: boolean; isMyntra: boolean },
  ) {
    const marketplaceId =
      ctx.marketplace._id?.toString?.() ?? dto.marketplaceId;
    await this.assertRequiredFiles(
      flags,
      files,
      dto.reportMonth
        ? {
            sellerId: ctx.canonicalSellerId || dto.sellerId,
            gstId: dto.gstId,
            marketplaceId,
            reportMonth: dto.reportMonth,
          }
        : undefined,
    );

    const label =
      expectedMarketplace.charAt(0).toUpperCase() +
      expectedMarketplace.slice(1);

    const upload = await this.uploadModel.create({
      sellerId: ctx.canonicalSellerId || dto.sellerId,
      gstId: dto.gstId,
      gstin: ctx.gst.gstNumber,
      marketplace: marketplaceId,
      reportMonth: dto.reportMonth,
      fileName: `${label} import (processing)`,
      fileHash: `processing:${Date.now()}`,
      totalRecords: 0,
      salesRecords: 0,
      cashbackRecords: 0,
      status: 'processing',
    });
    const uploadId = upload._id?.toString?.() ?? '';
    const fileSnapshot = this.cloneFileBuffers(files);

    setImmediate(() => {
      void this.runInMemoryBackgroundJob(
        uploadId,
        expectedMarketplace,
        fileSnapshot,
        dto,
        ctx,
        flags,
      );
    });

    return {
      success: true,
      status: 'processing' as const,
      uploadId,
      count: 0,
      message:
        'Import started. Parsing and saving rows in the background — stay on this page to see progress.',
    };
  }

  private async runInMemoryBackgroundJob(
    uploadId: string,
    expectedMarketplace: 'flipkart' | 'amazon' | 'meesho' | 'myntra',
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
    flags: { isAmazon: boolean; isMeesho: boolean; isMyntra: boolean },
  ) {
    try {
      const marketplaceId =
        ctx.marketplace._id?.toString?.() ?? dto.marketplaceId;
      const { fileHashes, fileName } = this.buildFileHashBundle(
        files,
        flags.isAmazon,
        flags.isMeesho,
        flags.isMyntra,
      );

      await this.validation.ensureNoDuplicateFileHashes({
        sellerId: ctx.canonicalSellerId || dto.sellerId,
        gstin: ctx.gst.gstNumber,
        marketplace: marketplaceId,
        fileHashes,
        excludeUploadId: uploadId,
        reportMonth: dto.reportMonth,
      });

      await this.uploadModel.findByIdAndUpdate(uploadId, {
        $set: { fileName },
      });

      await this.processImport(expectedMarketplace, files, dto, ctx, uploadId);
    } catch (err) {
      this.logger.error(
        `Background import failed (${expectedMarketplace}, upload ${uploadId})`,
        err instanceof Error ? err.stack : String(err),
      );
      await this.markUploadFailed(uploadId, err);
    }
  }

  private cloneFile(file?: UploadedFileInput): UploadedFileInput | undefined {
    if (!file) return undefined;
    return {
      buffer: Buffer.from(file.buffer),
      originalname: file.originalname,
    };
  }

  private cloneFileBuffers(
    files: MarketplaceFilesInput,
  ): MarketplaceFilesInput {
    return {
      file: this.cloneFile(files.file),
      mtrB2bFile: this.cloneFile(files.mtrB2bFile),
      mtrB2cFile: this.cloneFile(files.mtrB2cFile),
      tcsSalesFile: this.cloneFile(files.tcsSalesFile),
      tcsSalesReturnFile: this.cloneFile(files.tcsSalesReturnFile),
      orderReportFile: this.cloneFile(files.orderReportFile),
      returnInTransitReportFile: this.cloneFile(
        files.returnInTransitReportFile,
      ),
      returnOutForDeliveryReportFile: this.cloneFile(
        files.returnOutForDeliveryReportFile,
      ),
      returnDeliveryCompleteReportFile: this.cloneFile(
        files.returnDeliveryCompleteReportFile,
      ),
      paymentReportFile: this.cloneFile(files.paymentReportFile),
      paymentReportFiles: files.paymentReportFiles?.map(
        (file) => this.cloneFile(file)!,
      ),
      returnReportFile: this.cloneFile(files.returnReportFile),
      amazonReturnReportFile: this.cloneFile(files.amazonReturnReportFile),
      gstrReportPackedFile: this.cloneFile(files.gstrReportPackedFile),
      mDirectOrdersReportFile: this.cloneFile(files.mDirectOrdersReportFile),
      salesRevenuePackedB2cFile: this.cloneFile(
        files.salesRevenuePackedB2cFile,
      ),
      gstrReportRtoFile: this.cloneFile(files.gstrReportRtoFile),
      gstrReportRtFile: this.cloneFile(files.gstrReportRtFile),
      mDirectReturnsReportFile: this.cloneFile(files.mDirectReturnsReportFile),
      pgForwardSettledFile: this.cloneFile(files.pgForwardSettledFile),
      pgReverseSettledFile: this.cloneFile(files.pgReverseSettledFile),
    };
  }

  async markUploadFailedById(uploadId: string, err: unknown) {
    if (!uploadId) return;
    await this.markUploadFailed(uploadId, err);
  }

  /** Mark uploads left in `processing` after a crash or interrupted job. */
  async failStaleProcessingUploads(maxAgeMs = 30 * 60 * 1000) {
    const cutoff = new Date(Date.now() - maxAgeMs);
    await this.uploadModel
      .updateMany(
        {
          status: 'processing',
          updatedAt: { $lt: cutoff },
        },
        {
          $set: {
            status: 'failed',
            lifecycleStatus: 'failed',
            errorMessage:
              'Import timed out or was interrupted. Please upload again.',
          },
        },
      )
      .exec();
  }

  /** Reuse the queued upload record when processing in the background; otherwise create a new one. */
  private async resolveDedicatedUploadRecord(
    existingUploadId: string | null | undefined,
    fields: Record<string, unknown>,
  ): Promise<string> {
    const trimmed =
      typeof existingUploadId === 'string' ? existingUploadId.trim() : '';
    if (trimmed) {
      await this.uploadModel.findByIdAndUpdate(trimmed, { $set: fields });
      return trimmed;
    }
    const upload = await this.uploadModel.create(fields);
    return upload._id?.toString?.() ?? '';
  }

  private async markUploadFailed(uploadId: string, err: unknown) {
    const errorMessage = this.extractErrorMessage(err);
    const upload = await this.uploadModel
      .findByIdAndUpdate(
        uploadId,
        { $set: { status: 'failed', errorMessage } },
        { new: true },
      )
      .lean()
      .exec();
    if (!upload?.reportMonth) return;

    const uploadedSlots =
      Array.isArray(upload.uploadedSlots)
        ? upload.uploadedSlots
        : inferUploadedSlotsFromFileHash(String(upload.fileHash ?? ''));
    if (!uploadedSlots.length) return;

    await this.importWorkflow.clearFailedSlotRecords({
      sellerId: upload.sellerId,
      gstId: upload.gstId,
      marketplaceId: upload.marketplace,
      reportMonth: upload.reportMonth,
      slots: uploadedSlots,
    });
  }

  private extractErrorMessage(err: unknown): string {
    if (err instanceof BadRequestException) {
      const response = err.getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message: string | string[] }).message;
        return Array.isArray(message) ? message.join('\n') : String(message);
      }
    }
    return err instanceof Error ? err.message : 'Import failed';
  }

  private async assertRequiredFiles(
    flags: { isAmazon: boolean; isMeesho: boolean; isMyntra: boolean },
    files: MarketplaceFilesInput,
    ownership?: {
      sellerId: string;
      gstId: string;
      marketplaceId: string;
      reportMonth: string;
    },
  ) {
    const { isAmazon, isMeesho, isMyntra } = flags;
    if (isAmazon) {
      const hasMtr = Boolean(files.mtrB2cFile || files.mtrB2bFile);
      const hasPayment =
        Boolean(files.paymentReportFile) ||
        Boolean(files.paymentReportFiles?.length);
      const hasReturn = Boolean(files.amazonReturnReportFile);
      if (!hasMtr && !hasReturn && !hasPayment) {
        throw new BadRequestException(
          'Amazon upload requires an MTR, return, or payment report file',
        );
      }
      const hasReturnOnly = hasReturn && !hasMtr;
      if (hasReturnOnly && ownership) {
        const b2cUploaded = await this.importWorkflow.hasCompletedSlot({
          sellerId: ownership.sellerId,
          gstId: ownership.gstId,
          marketplaceId: ownership.marketplaceId,
          reportMonth: ownership.reportMonth,
          slot: 'mtrB2cFile',
        });
        const b2bUploaded = await this.importWorkflow.hasCompletedSlot({
          sellerId: ownership.sellerId,
          gstId: ownership.gstId,
          marketplaceId: ownership.marketplaceId,
          reportMonth: ownership.reportMonth,
          slot: 'mtrB2bFile',
        });
        if (!b2cUploaded && !b2bUploaded) {
          throw new BadRequestException(
            'MTR B2C or B2B report is required before uploading the Amazon return report',
          );
        }
      }
    } else if (isMeesho) {
      const hasImportFile = Boolean(
        files.tcsSalesFile ||
        files.tcsSalesReturnFile ||
        files.orderReportFile ||
        files.returnInTransitReportFile ||
        files.returnOutForDeliveryReportFile ||
        files.returnDeliveryCompleteReportFile,
      );
      const hasPaymentOnly = Boolean(files.paymentReportFile) && !hasImportFile;
      if (!hasImportFile && !hasPaymentOnly) {
        throw new BadRequestException(
          'Meesho upload requires at least one report file',
        );
      }
      if (hasImportFile && !files.tcsSalesFile) {
        const tcsAlreadyUploaded =
          ownership &&
          (await this.importWorkflow.hasCompletedSlot({
            sellerId: ownership.sellerId,
            gstId: ownership.gstId,
            marketplaceId: ownership.marketplaceId,
            reportMonth: ownership.reportMonth,
            slot: 'tcsSalesFile',
          }));
        if (!tcsAlreadyUploaded) {
          throw new BadRequestException(
            'TCS Sales Report is required when uploading sales or return reports',
          );
        }
      }
    } else if (isMyntra) {
      const hasSalesFile = Boolean(
        files.gstrReportPackedFile ||
        files.salesRevenuePackedB2cFile ||
        files.gstrReportRtoFile ||
        files.gstrReportRtFile ||
        files.mDirectOrdersReportFile ||
        files.mDirectReturnsReportFile,
      );
      const hasPaymentOnly = hasMyntraPaymentFiles(files) && !hasSalesFile;
      if (hasPaymentOnly && ownership) {
        const requiredSlots = [
          'gstrReportPackedFile',
          'salesRevenuePackedB2cFile',
          'gstrReportRtoFile',
          'gstrReportRtFile',
        ] as const;
        for (const slot of requiredSlots) {
          const alreadyUploaded = await this.importWorkflow.hasCompletedSlot({
            sellerId: ownership.sellerId,
            gstId: ownership.gstId,
            marketplaceId: ownership.marketplaceId,
            reportMonth: ownership.reportMonth,
            slot,
          });
          if (!alreadyUploaded) {
            throw new BadRequestException(
              'Upload all required Myntra sales and return reports before uploading the payment report',
            );
          }
        }
      } else if (!hasSalesFile && !hasPaymentOnly) {
        throw new BadRequestException(
          'Myntra upload requires sales/return reports or a payment report file',
        );
      } else if (hasSalesFile) {
        if (
          !files.gstrReportPackedFile ||
          !files.salesRevenuePackedB2cFile ||
          !files.gstrReportRtoFile ||
          !files.gstrReportRtFile
        ) {
          const requiredSlots = [
            'gstrReportPackedFile',
            'salesRevenuePackedB2cFile',
            'gstrReportRtoFile',
            'gstrReportRtFile',
          ] as const;
          if (ownership) {
            for (const slot of requiredSlots) {
              if (files[slot]) continue;
              const alreadyUploaded =
                await this.importWorkflow.hasCompletedSlot({
                  sellerId: ownership.sellerId,
                  gstId: ownership.gstId,
                  marketplaceId: ownership.marketplaceId,
                  reportMonth: ownership.reportMonth,
                  slot,
                });
              if (!alreadyUploaded) {
                throw new BadRequestException(
                  'Myntra upload requires: GSTR Report Packed, Sales Revenue Packed B2C, GSTR Report RTO, and GSTR Report RT. MDirect Orders and MDirect Returns are optional.',
                );
              }
            }
          } else {
            throw new BadRequestException(
              'Myntra upload requires: GSTR Report Packed, Sales Revenue Packed B2C, GSTR Report RTO, and GSTR Report RT. MDirect Orders and MDirect Returns are optional.',
            );
          }
        }
      }
      if (hasPaymentOnly && hasSalesFile) {
        throw new BadRequestException(
          'Myntra PG payment reports must be uploaded separately from sales and return reports',
        );
      }
    } else {
      const hasFlipkartSales = Boolean(files.file);
      const hasFlipkartPaymentOnly =
        Boolean(files.paymentReportFile) &&
        !hasFlipkartSales &&
        !files.returnReportFile;
      const hasFlipkartReturnOnly =
        Boolean(files.returnReportFile) &&
        !hasFlipkartSales &&
        !files.paymentReportFile;
      if (
        !hasFlipkartSales &&
        !hasFlipkartPaymentOnly &&
        !hasFlipkartReturnOnly
      ) {
        throw new BadRequestException(
          'Flipkart upload requires a sales, return, or payment report file',
        );
      }
      if ((hasFlipkartPaymentOnly || hasFlipkartReturnOnly) && ownership) {
        const salesAlreadyUploaded = await this.importWorkflow.hasCompletedSlot(
          {
            sellerId: ownership.sellerId,
            gstId: ownership.gstId,
            marketplaceId: ownership.marketplaceId,
            reportMonth: ownership.reportMonth,
            slot: 'file',
          },
        );
        if (!salesAlreadyUploaded) {
          throw new BadRequestException(
            'Sales Report is required before uploading the return or payment report',
          );
        }
      }
    }
  }

  private buildFileHashBundle(
    files: MarketplaceFilesInput,
    isAmazon: boolean,
    isMeesho: boolean,
    isMyntra: boolean,
  ) {
    const singleFileHash = files.file
      ? this.validation.computeFileHash(files.file.buffer)
      : '';
    const b2bFileHash = files.mtrB2bFile
      ? this.validation.computeFileHash(files.mtrB2bFile.buffer)
      : '';
    const b2cFileHash = files.mtrB2cFile
      ? this.validation.computeFileHash(files.mtrB2cFile.buffer)
      : '';
    const tcsSalesFileHash = files.tcsSalesFile
      ? this.validation.computeFileHash(files.tcsSalesFile.buffer)
      : '';
    const tcsSalesReturnFileHash = files.tcsSalesReturnFile
      ? this.validation.computeFileHash(files.tcsSalesReturnFile.buffer)
      : '';
    const orderReportFileHash = files.orderReportFile
      ? this.validation.computeFileHash(files.orderReportFile.buffer)
      : '';
    const returnInTransitReportFileHash = files.returnInTransitReportFile
      ? this.validation.computeFileHash(files.returnInTransitReportFile.buffer)
      : '';
    const returnOutForDeliveryReportFileHash =
      files.returnOutForDeliveryReportFile
        ? this.validation.computeFileHash(
            files.returnOutForDeliveryReportFile.buffer,
          )
        : '';
    const returnDeliveryCompleteReportFileHash =
      files.returnDeliveryCompleteReportFile
        ? this.validation.computeFileHash(
            files.returnDeliveryCompleteReportFile.buffer,
          )
        : '';
    const paymentReportFileHash = files.paymentReportFile
      ? this.validation.computeFileHash(files.paymentReportFile.buffer)
      : '';
    const returnReportFileHash = files.returnReportFile
      ? this.validation.computeFileHash(files.returnReportFile.buffer)
      : '';
    const amazonReturnReportFileHash = files.amazonReturnReportFile
      ? this.validation.computeFileHash(files.amazonReturnReportFile.buffer)
      : '';
    const gstrReportPackedFileHash = files.gstrReportPackedFile
      ? this.validation.computeFileHash(files.gstrReportPackedFile.buffer)
      : '';
    const mDirectOrdersReportFileHash = files.mDirectOrdersReportFile
      ? this.validation.computeFileHash(files.mDirectOrdersReportFile.buffer)
      : '';
    const salesRevenuePackedB2cFileHash = files.salesRevenuePackedB2cFile
      ? this.validation.computeFileHash(files.salesRevenuePackedB2cFile.buffer)
      : '';
    const gstrReportRtoFileHash = files.gstrReportRtoFile
      ? this.validation.computeFileHash(files.gstrReportRtoFile.buffer)
      : '';
    const gstrReportRtFileHash = files.gstrReportRtFile
      ? this.validation.computeFileHash(files.gstrReportRtFile.buffer)
      : '';
    const mDirectReturnsReportFileHash = files.mDirectReturnsReportFile
      ? this.validation.computeFileHash(files.mDirectReturnsReportFile.buffer)
      : '';
    const pgForwardSettledFileHash = files.pgForwardSettledFile
      ? this.validation.computeFileHash(files.pgForwardSettledFile.buffer)
      : '';
    const pgReverseSettledFileHash = files.pgReverseSettledFile
      ? this.validation.computeFileHash(files.pgReverseSettledFile.buffer)
      : '';

    const fileHash = isAmazon
      ? paymentReportFileHash &&
        !b2cFileHash &&
        !b2bFileHash &&
        !amazonReturnReportFileHash
        ? `amazon-payment|${paymentReportFileHash}`
        : `amazon|b2c:${b2cFileHash || 'none'}|b2b:${b2bFileHash || 'none'}|return:${amazonReturnReportFileHash || 'none'}`
      : isMeesho
        ? `meesho|tcsSales:${tcsSalesFileHash || 'none'}|tcsSalesReturn:${tcsSalesReturnFileHash || 'none'}|order:${orderReportFileHash || 'none'}|returnInTransit:${returnInTransitReportFileHash || 'none'}|returnOutForDelivery:${returnOutForDeliveryReportFileHash || 'none'}|returnDeliveryComplete:${returnDeliveryCompleteReportFileHash || 'none'}|payment:${paymentReportFileHash || 'none'}`
        : isMyntra
          ? (pgForwardSettledFileHash || pgReverseSettledFileHash) &&
            !gstrReportPackedFileHash &&
            !salesRevenuePackedB2cFileHash &&
            !gstrReportRtoFileHash &&
            !gstrReportRtFileHash &&
            !mDirectOrdersReportFileHash &&
            !mDirectReturnsReportFileHash
            ? buildMyntraPaymentFileHash({
                forwardHash: pgForwardSettledFileHash,
                reverseHash: pgReverseSettledFileHash,
              })
            : `myntra|gstr:${gstrReportPackedFileHash}|mdirect:${mDirectOrdersReportFileHash}|sales:${salesRevenuePackedB2cFileHash}|rto:${gstrReportRtoFileHash}|rt:${gstrReportRtFileHash}|returns:${mDirectReturnsReportFileHash}`
          : `flipkart|sales:${singleFileHash || 'none'}|return:${returnReportFileHash || 'none'}|payment:${paymentReportFileHash || 'none'}`;

    const fileHashes = isAmazon
      ? [
          b2cFileHash,
          b2bFileHash,
          amazonReturnReportFileHash,
          paymentReportFileHash,
        ].filter(Boolean)
      : isMeesho
        ? [
            tcsSalesFileHash,
            tcsSalesReturnFileHash,
            orderReportFileHash,
            returnInTransitReportFileHash,
            returnOutForDeliveryReportFileHash,
            returnDeliveryCompleteReportFileHash,
            paymentReportFileHash,
          ].filter(Boolean)
        : isMyntra
          ? [
              gstrReportPackedFileHash,
              mDirectOrdersReportFileHash,
              salesRevenuePackedB2cFileHash,
              gstrReportRtoFileHash,
              gstrReportRtFileHash,
              mDirectReturnsReportFileHash,
              pgForwardSettledFileHash,
              pgReverseSettledFileHash,
            ].filter(Boolean)
          : [
              singleFileHash,
              returnReportFileHash,
              paymentReportFileHash,
            ].filter(Boolean);

    const fileName = isAmazon
      ? [
          files.mtrB2bFile?.originalname,
          files.mtrB2cFile?.originalname,
          files.amazonReturnReportFile?.originalname,
          files.paymentReportFile?.originalname,
        ]
          .filter(Boolean)
          .join(' + ') || 'Amazon reports'
      : isMeesho
        ? [
            files.tcsSalesFile?.originalname,
            files.tcsSalesReturnFile?.originalname,
            files.orderReportFile?.originalname,
            files.returnInTransitReportFile?.originalname,
            files.returnOutForDeliveryReportFile?.originalname,
            files.returnDeliveryCompleteReportFile?.originalname,
            files.paymentReportFile?.originalname,
          ]
            .filter(Boolean)
            .join(' + ') || 'Meesho reports'
        : isMyntra
          ? hasMyntraPaymentFiles(files) &&
            !files.gstrReportPackedFile &&
            !files.salesRevenuePackedB2cFile &&
            !files.gstrReportRtoFile &&
            !files.gstrReportRtFile &&
            !files.mDirectOrdersReportFile &&
            !files.mDirectReturnsReportFile
            ? [
                files.pgForwardSettledFile?.originalname,
                files.pgReverseSettledFile?.originalname,
              ]
                .filter(Boolean)
                .join(' + ') || 'Myntra PG payment reports'
            : `${files.gstrReportPackedFile?.originalname ?? 'GSTR-Packed'} + ${files.mDirectOrdersReportFile?.originalname ?? 'MDirect-Orders'} + ${files.salesRevenuePackedB2cFile?.originalname ?? 'Sales-Revenue-B2C'} + ${files.gstrReportRtoFile?.originalname ?? 'GSTR-RTO'} + ${files.gstrReportRtFile?.originalname ?? 'GSTR-RT'} + ${files.mDirectReturnsReportFile?.originalname ?? 'MDirect-Returns'}`
          : [
              files.file?.originalname,
              files.returnReportFile?.originalname,
              files.paymentReportFile?.originalname,
            ]
              .filter(Boolean)
              .join(' + ') || 'Flipkart reports';

    return { fileHash, fileHashes, fileName };
  }

  private collectAmazonPaymentFiles(
    files: MarketplaceFilesInput,
  ): UploadedFileInput[] {
    if (files.paymentReportFiles?.length) {
      return files.paymentReportFiles;
    }
    return files.paymentReportFile ? [files.paymentReportFile] : [];
  }

  private async processAmazonPaymentFileBatch(
    paymentFiles: UploadedFileInput[],
    dto: UploadReportDto,
    ctx: UploadContext,
    existingUploadId?: string | null,
  ) {
    if (paymentFiles.length > AMAZON_MAX_PAYMENT_FILES) {
      throw new BadRequestException(
        `Amazon allows up to ${AMAZON_MAX_PAYMENT_FILES} payment report files per month`,
      );
    }

    const { gst, marketplace } = ctx;
    const sellerId = ctx.canonicalSellerId || dto.sellerId;
    const marketplaceId = marketplace._id?.toString?.() ?? dto.marketplaceId;
    const reportMonth = String(dto.reportMonth ?? '').trim();
    if (!reportMonth) {
      throw new BadRequestException(
        'reportMonth is required for Amazon payment upload',
      );
    }

    const results: Array<{
      uploadId: string;
      fileName: string;
      parsedRows: number;
      invalidRows: number;
    }> = [];

    let placeholderUploadConsumed = false;
    const existingPaymentUploadCount = await this.uploadModel.countDocuments({
      sellerId,
      gstId: dto.gstId,
      marketplace: marketplaceId,
      reportMonth,
      fileHash: { $regex: /^amazon-payment\|/ },
      lifecycleStatus: { $ne: 'deleted' },
      status: 'completed',
    });

    for (const paymentFile of paymentFiles) {
      const contentHash = this.validation.computeFileHash(paymentFile.buffer);
      const fileHash = buildAmazonPaymentFileHash(contentHash, reportMonth);
      const slotKey = buildAmazonPaymentSlotKey(contentHash);
      const fileName = paymentFile.originalname;

      const existingUpload = await this.uploadModel
        .findOne({
          sellerId,
          gstId: dto.gstId,
          marketplace: marketplaceId,
          reportMonth,
          fileHash,
          lifecycleStatus: { $ne: 'deleted' },
        })
        .select('_id')
        .lean()
        .exec();

      if (
        !existingUpload &&
        !placeholderUploadConsumed &&
        existingPaymentUploadCount >= AMAZON_MAX_PAYMENT_FILES
      ) {
        throw new BadRequestException(
          `Amazon allows up to ${AMAZON_MAX_PAYMENT_FILES} payment report files per month`,
        );
      }

      const placeholderUploadId =
        !placeholderUploadConsumed && existingUploadId
          ? existingUploadId
          : null;
      const uploadIdStr = existingUpload?._id
        ? String(existingUpload._id)
        : await this.resolveDedicatedUploadRecord(placeholderUploadId, {
            sellerId,
            gstId: dto.gstId,
            gstin: gst.gstNumber,
            marketplace: marketplaceId,
            reportMonth,
            fileName,
            fileHash,
            uploadedSlots: [slotKey],
            fileSize: paymentFile.buffer.length,
            totalRecords: 0,
            salesRecords: 0,
            cashbackRecords: 0,
            status: 'processing',
            lifecycleStatus: 'processing',
          });
      if (!existingUpload && placeholderUploadId) {
        placeholderUploadConsumed = true;
      }

      const paymentUploadSummary =
        await this.amazonPaymentService.processUpload({
          buffer: paymentFile.buffer,
          uploadedFileName: fileName,
          sellerId,
          gstId: dto.gstId,
          gstin: gst.gstNumber,
          marketplace: marketplaceId,
          reportMonth,
          uploadId: uploadIdStr,
          duplicateStrategy: 'update',
        });

      await this.uploadModel.findByIdAndUpdate(uploadIdStr, {
        $set: {
          totalRecords: paymentUploadSummary.parsedRows,
          salesRecords: paymentUploadSummary.parsedRows,
          processedRecords: paymentUploadSummary.parsedRows,
          status: 'completed',
          lifecycleStatus: 'completed',
          fileName,
          fileHash,
          uploadedSlots: [slotKey],
          fileSize: paymentFile.buffer.length,
        },
      });

      await this.importWorkflow.recordSlotUploads({
        sellerId,
        gstId: dto.gstId,
        marketplaceId,
        reportMonth,
        uploadId: uploadIdStr,
        uploadedSlots: [slotKey],
        fileName,
        fileSize: paymentFile.buffer.length,
        importBatchId: uploadIdStr,
        slotDetails: {
          [slotKey]: buildPaymentOnlySlotDetail(
            paymentFile,
            paymentUploadSummary.parsedRows,
          ),
        },
      });

      results.push({
        uploadId: uploadIdStr,
        fileName,
        parsedRows: paymentUploadSummary.parsedRows,
        invalidRows: paymentUploadSummary.invalidRows,
      });
    }

    return { results, placeholderUploadConsumed };
  }

  private async completeAmazonPaymentUpload(
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
    existingUploadId?: string | null,
  ) {
    const paymentFiles = this.collectAmazonPaymentFiles(files);
    if (!paymentFiles.length) {
      throw new BadRequestException('Amazon payment report file is required');
    }

    const { results, placeholderUploadConsumed } =
      await this.processAmazonPaymentFileBatch(
        paymentFiles,
        dto,
        ctx,
        existingUploadId,
      );

    const totalParsedRows = results.reduce(
      (sum, item) => sum + item.parsedRows,
      0,
    );
    const totalInvalidRows = results.reduce(
      (sum, item) => sum + item.invalidRows,
      0,
    );

    if (
      existingUploadId &&
      !placeholderUploadConsumed &&
      !results.some((item) => item.uploadId === existingUploadId)
    ) {
      await this.uploadModel.findByIdAndUpdate(existingUploadId, {
        $set: {
          status: 'completed',
          lifecycleStatus: 'completed',
          totalRecords: totalParsedRows,
          salesRecords: totalParsedRows,
          processedRecords: totalParsedRows,
          fileName:
            results.length === 1
              ? results[0].fileName
              : `${results.length} Amazon payment files`,
        },
      });
    }

    return {
      success: true,
      status: 'completed' as const,
      message:
        results.length === 1
          ? `Stored ${totalParsedRows} Amazon payment transaction row(s).`
          : `Stored ${totalParsedRows} Amazon payment transaction row(s) from ${results.length} file(s).`,
      uploadId:
        placeholderUploadConsumed && existingUploadId
          ? existingUploadId
          : results[results.length - 1]?.uploadId,
      count: totalParsedRows,
      rowErrorCount: totalInvalidRows,
      paymentUploadSummary: {
        parsedRows: totalParsedRows,
        invalidRows: totalInvalidRows,
        filesProcessed: results.length,
      },
    };
  }

  private async completeMeeshoPaymentUpload(
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
    existingUploadId?: string | null,
  ) {
    const { gst, marketplace } = ctx;
    const sellerId = ctx.canonicalSellerId || dto.sellerId;
    const marketplaceId = marketplace._id?.toString?.() ?? dto.marketplaceId;
    const paymentFile = files.paymentReportFile!;
    const fileHash = this.validation.computeFileHash(paymentFile.buffer);
    const fileName = paymentFile.originalname;

    const uploadIdStr = await this.resolveDedicatedUploadRecord(
      existingUploadId,
      {
        sellerId,
        gstId: dto.gstId,
        gstin: gst.gstNumber,
        marketplace: marketplaceId,
        reportMonth: dto.reportMonth,
        fileName,
        fileHash: `meesho-payment|${fileHash}|month:${dto.reportMonth ?? ''}`,
        uploadedSlots: ['paymentReportFile'],
        fileSize: paymentFile.buffer.length,
        totalRecords: 0,
        salesRecords: 0,
        cashbackRecords: 0,
        status: 'processing',
        lifecycleStatus: 'processing',
      },
    );

    const paymentImportSummary = await this.meeshoPaymentService.processUpload({
      buffer: paymentFile.buffer,
      uploadedFileName: fileName,
      sellerId,
      gstId: dto.gstId,
      gstin: gst.gstNumber,
      marketplace: marketplaceId,
      reportMonth: dto.reportMonth,
      importId: uploadIdStr,
    });

    const paymentByOrder = this.meeshoImport.indexBySubOrderNum(
      paymentImportSummary.orderPaymentRawRows,
    );
    const orderIds = [...paymentByOrder.keys()];

    const salesUploads = await this.uploadModel
      .find({
        sellerId,
        gstin: gst.gstNumber,
        marketplace: marketplaceId,
        reportMonth: dto.reportMonth,
        status: 'completed',
        totalRecords: { $gt: 0 },
      })
      .select('_id')
      .lean()
      .exec();

    const uploadIds = salesUploads.map((item) => String(item._id));
    let bulkOpsCount = 0;
    let unmatchedPaymentRows = 0;

    if (uploadIds.length && orderIds.length) {
      const existingRows = await this.rowModel
        .find({
          uploadId: { $in: uploadIds },
          orderID: { $in: orderIds },
        })
        .select(['_id', 'orderID'])
        .lean()
        .exec();

      const bulkOps = existingRows
        .map((row) => {
          const paymentRow = paymentByOrder.get(String(row.orderID ?? ''));
          if (!paymentRow) return null;
          return {
            updateOne: {
              filter: { _id: row._id },
              update: {
                $set: this.mapping.mapMeeshoPaymentFields(paymentRow),
              },
            },
          };
        })
        .filter((op): op is NonNullable<typeof op> => op !== null);

      if (bulkOps.length) {
        await this.rowModel.bulkWrite(bulkOps, { ordered: false });
      }

      bulkOpsCount = bulkOps.length;
      const matchedOrders = new Set(
        existingRows.map((row) => String(row.orderID ?? '')),
      );
      unmatchedPaymentRows = orderIds.filter(
        (id) => !matchedOrders.has(id),
      ).length;
    }

    await this.uploadModel.findByIdAndUpdate(uploadIdStr, {
      $set: {
        totalRecords: paymentImportSummary.summary.orderPayments,
        salesRecords: paymentImportSummary.summary.orderPayments,
        processedRecords: paymentImportSummary.summary.orderPayments,
        status: 'completed',
        lifecycleStatus: 'completed',
      },
    });

    await this.importWorkflow.recordSlotUploads({
      sellerId,
      gstId: dto.gstId,
      marketplaceId,
      reportMonth: dto.reportMonth!,
      uploadId: uploadIdStr,
      uploadedSlots: ['paymentReportFile'],
      fileName,
      fileSize: paymentFile.buffer.length,
      importBatchId: uploadIdStr,
      slotDetails: {
        paymentReportFile: buildPaymentOnlySlotDetail(
          paymentFile,
          paymentImportSummary.summary.orderPayments,
        ),
      },
    });
    await this.reconciliationService.enqueueForUpload(uploadIdStr);

    const enrichedMessage =
      bulkOpsCount > 0
        ? unmatchedPaymentRows > 0
          ? `Payment data applied to ${bulkOpsCount} order(s). ${unmatchedPaymentRows} payment row(s) had no matching sales order for this month.`
          : `Payment data applied to ${bulkOpsCount} order(s).`
        : '';

    const storedMessage = `Stored Meesho payment report: ${paymentImportSummary.summary.orderPayments} order payment(s), ${paymentImportSummary.summary.adsCost} ads cost row(s), ${paymentImportSummary.summary.referralPayments} referral payment(s), ${paymentImportSummary.summary.compensationRecovery} compensation/recovery row(s).`;

    const message = enrichedMessage
      ? `${storedMessage} ${enrichedMessage}`
      : storedMessage;

    return {
      success: true,
      status: 'completed' as const,
      message,
      uploadId: uploadIdStr,
      count: paymentImportSummary.summary.orderPayments,
      rowErrorCount: 0,
      marketplace: paymentImportSummary.marketplace,
      summary: paymentImportSummary.summary,
      meeshoPaymentImport: paymentImportSummary,
    };
  }

  private async completeFlipkartPaymentUpload(
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
    existingUploadId?: string | null,
  ) {
    const { gst, marketplace } = ctx;
    const sellerId = ctx.canonicalSellerId || dto.sellerId;
    const marketplaceId = marketplace._id?.toString?.() ?? dto.marketplaceId;
    const paymentFile = files.paymentReportFile!;
    const fileHash = this.validation.computeFileHash(paymentFile.buffer);
    const fileName = paymentFile.originalname;

    const uploadIdStr = await this.resolveDedicatedUploadRecord(
      existingUploadId,
      {
        sellerId,
        gstId: dto.gstId,
        gstin: gst.gstNumber,
        marketplace: marketplaceId,
        reportMonth: dto.reportMonth,
        fileName,
        fileHash: `flipkart-payment|${fileHash}|month:${dto.reportMonth ?? ''}`,
        uploadedSlots: ['paymentReportFile'],
        fileSize: paymentFile.buffer.length,
        totalRecords: 0,
        salesRecords: 0,
        cashbackRecords: 0,
        status: 'processing',
        lifecycleStatus: 'processing',
      },
    );

    const paymentUploadSummary =
      await this.flipkartPaymentService.processUpload({
        buffer: paymentFile.buffer,
        uploadedFileName: fileName,
        sellerId,
        gstId: dto.gstId,
        gstin: gst.gstNumber,
        marketplace: marketplaceId,
        reportMonth: dto.reportMonth,
        uploadId: uploadIdStr,
        duplicateStrategy: 'update',
      });

    // Re-upload should clear previously entered bank receive amounts so variance
    // is recalculated only after the seller re-enters bank receipt values.
    if (paymentUploadSummary.neftIds?.length) {
      const resetCount =
        await this.analyticsPayoutsService.resetReceiptsForNefts({
          sellerId,
          marketplace: marketplaceId,
          neftIds: paymentUploadSummary.neftIds,
        });
      if (resetCount > 0) {
        this.logger.log(
          `Reset ${resetCount} payout bank receipt(s) after Flipkart payment re-upload ${uploadIdStr}`,
        );
      }
    }

    await this.uploadModel.findByIdAndUpdate(uploadIdStr, {
      $set: {
        totalRecords: paymentUploadSummary.parsedRows,
        salesRecords: paymentUploadSummary.parsedRows,
        processedRecords: paymentUploadSummary.parsedRows,
      },
    });

    const legacyEnrichedCount =
      await this.enrichFlipkartImportRowsFromPaymentStore({
        sellerId,
        gstin: gst.gstNumber,
        marketplaceId,
        reportMonth: dto.reportMonth!,
        paymentUploadId: uploadIdStr,
      });

    await this.uploadModel.findByIdAndUpdate(uploadIdStr, {
      $set: {
        status: 'completed',
        lifecycleStatus: 'completed',
      },
    });

    await this.importWorkflow.recordSlotUploads({
      sellerId,
      gstId: dto.gstId,
      marketplaceId,
      reportMonth: dto.reportMonth!,
      uploadId: uploadIdStr,
      uploadedSlots: ['paymentReportFile'],
      fileName,
      fileSize: paymentFile.buffer.length,
      importBatchId: uploadIdStr,
      slotDetails: {
        paymentReportFile: buildPaymentOnlySlotDetail(
          paymentFile,
          paymentUploadSummary.parsedRows,
        ),
      },
    });
    await this.reconciliationService.enqueueForUpload(uploadIdStr);

    const message =
      paymentUploadSummary.parsedRows > 0
        ? `Stored ${paymentUploadSummary.parsedRows} payment record(s) in Flipkart payment reports.${legacyEnrichedCount > 0 ? ` Enriched ${legacyEnrichedCount} sales row(s).` : ''}`
        : 'Payment report processed, but no valid payment rows were found.';

    return {
      success: true,
      status: 'completed' as const,
      message,
      uploadId: uploadIdStr,
      count: paymentUploadSummary.parsedRows,
      rowErrorCount: paymentUploadSummary.invalidRows,
      paymentUploadSummary,
    };
  }

  private async completeMyntraPaymentUpload(
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
    existingUploadId?: string | null,
  ) {
    const { gst, marketplace } = ctx;
    const sellerId = ctx.canonicalSellerId || dto.sellerId;
    const marketplaceId = marketplace._id?.toString?.() ?? dto.marketplaceId;
    const forwardFile = files.pgForwardSettledFile;
    const reverseFile = files.pgReverseSettledFile;
    if (!forwardFile && !reverseFile) {
      throw new BadRequestException(
        'At least one Myntra PG payment file is required (PG Forward Settled or PG Reverse Settled)',
      );
    }

    const forwardHash = forwardFile
      ? this.validation.computeFileHash(forwardFile.buffer)
      : '';
    const reverseHash = reverseFile
      ? this.validation.computeFileHash(reverseFile.buffer)
      : '';
    const fileHash = buildMyntraPaymentFileHash({
      forwardHash,
      reverseHash,
      reportMonth: dto.reportMonth ?? '',
    });
    const fileName =
      [forwardFile?.originalname, reverseFile?.originalname]
        .filter(Boolean)
        .join(' + ') || 'Myntra PG payment reports';
    const totalFileSize =
      (forwardFile?.buffer.length ?? 0) + (reverseFile?.buffer.length ?? 0);

    const uploadedSlots: string[] = [];
    if (forwardFile) uploadedSlots.push('pgForwardSettledFile');
    if (reverseFile) uploadedSlots.push('pgReverseSettledFile');

    const uploadIdStr = await this.resolveDedicatedUploadRecord(
      existingUploadId,
      {
        sellerId,
        gstId: dto.gstId,
        gstin: gst.gstNumber,
        marketplace: marketplaceId,
        reportMonth: dto.reportMonth,
        fileName,
        fileHash,
        uploadedSlots,
        fileSize: totalFileSize,
        totalRecords: 0,
        salesRecords: 0,
        cashbackRecords: 0,
        status: 'processing',
        lifecycleStatus: 'processing',
      },
    );

    const baseContext = {
      sellerId,
      gstId: dto.gstId,
      gstin: gst.gstNumber,
      marketplace: marketplaceId,
      reportMonth: dto.reportMonth,
      uploadId: uploadIdStr,
      duplicateStrategy: 'update' as const,
    };

    let totalParsed = 0;
    let totalInvalid = 0;
    let totalGstSkipped = 0;
    const slotDetails: Record<
      string,
      ReturnType<typeof buildPaymentOnlySlotDetail>
    > = {};

    if (forwardFile) {
      const summary = await this.myntraPaymentService.processUpload({
        ...baseContext,
        buffer: forwardFile.buffer,
        uploadedFileName: forwardFile.originalname,
        reportKind: 'forward',
      });
      totalParsed += summary.parsedRows;
      totalInvalid += summary.invalidRows;
      totalGstSkipped += summary.gstSkippedRows ?? 0;
      slotDetails.pgForwardSettledFile = buildPaymentOnlySlotDetail(
        forwardFile,
        summary.parsedRows,
      );
    }

    if (reverseFile) {
      const summary = await this.myntraPaymentService.processUpload({
        ...baseContext,
        buffer: reverseFile.buffer,
        uploadedFileName: reverseFile.originalname,
        reportKind: 'reverse',
      });
      totalParsed += summary.parsedRows;
      totalInvalid += summary.invalidRows;
      totalGstSkipped += summary.gstSkippedRows ?? 0;
      slotDetails.pgReverseSettledFile = buildPaymentOnlySlotDetail(
        reverseFile,
        summary.parsedRows,
      );
    }

    await this.uploadModel.findByIdAndUpdate(uploadIdStr, {
      $set: {
        totalRecords: totalParsed,
        salesRecords: totalParsed,
        processedRecords: totalParsed,
        status: 'completed',
        lifecycleStatus: 'completed',
      },
    });

    await this.importWorkflow.recordSlotUploads({
      sellerId,
      gstId: dto.gstId,
      marketplaceId,
      reportMonth: dto.reportMonth!,
      uploadId: uploadIdStr,
      uploadedSlots,
      fileName,
      fileSize: totalFileSize,
      importBatchId: uploadIdStr,
      slotDetails,
    });
    await this.reconciliationService.enqueueForUpload(uploadIdStr);

    const gstNote =
      totalGstSkipped > 0
        ? ` ${totalGstSkipped} row(s) skipped (other GSTINs in file).`
        : '';
    const labels: string[] = [];
    if (forwardFile) labels.push('PG Forward Settled');
    if (reverseFile) labels.push('PG Reverse Settled');

    return {
      success: true,
      status: 'completed' as const,
      message: `Myntra ${labels.join(' and ')} report(s) uploaded: ${totalParsed} row(s) stored.${gstNote}`,
      uploadId: uploadIdStr,
      count: totalParsed,
      rowErrorCount: totalInvalid,
    };
  }

  /** Enrich sales import_rows from stored Flipkart payment report rows. */
  private async enrichFlipkartImportRowsFromPaymentStore(scope: {
    sellerId: string;
    gstin: string;
    marketplaceId: string;
    reportMonth: string;
    paymentUploadId: string;
  }): Promise<number> {
    const salesUploadIds = await this.rowModel.distinct('uploadId', {
      sellerId: scope.sellerId,
      gstin: scope.gstin,
      marketplace: scope.marketplaceId,
      reportMonth: scope.reportMonth,
    });
    if (!salesUploadIds.length) return 0;

    const paymentRows =
      await this.flipkartPaymentService.listPaymentsForImportRowEnrichment({
        sellerId: scope.sellerId,
        gstin: scope.gstin,
        marketplace: scope.marketplaceId,
        reportMonth: scope.reportMonth,
        uploadId: scope.paymentUploadId,
      });

    if (!paymentRows.length) return 0;

    const paymentByOrder = new Map(
      paymentRows.map((row) => [String(row.orderId ?? ''), row]),
    );
    const orderIds = [...paymentByOrder.keys()].filter(Boolean);
    if (!orderIds.length) return 0;

    let enriched = 0;
    const chunkSize = 500;
    for (let i = 0; i < orderIds.length; i += chunkSize) {
      const chunk = orderIds.slice(i, i + chunkSize);
      const existingRows = await this.rowModel
        .find({
          uploadId: { $in: salesUploadIds },
          orderID: { $in: chunk },
        })
        .select(['_id', 'orderID'])
        .lean()
        .exec();

      const bulkOps = existingRows
        .map((row) => {
          const paymentRow = paymentByOrder.get(String(row.orderID ?? ''));
          if (!paymentRow) return null;
          return {
            updateOne: {
              filter: { _id: row._id },
              update: {
                $set: {
                  finalSettlementAmount: paymentRow.bankSettlementValue,
                  transactionId: paymentRow.neftId,
                  paymentDate: paymentRow.paymentDate,
                },
              },
            },
          };
        })
        .filter((op): op is NonNullable<typeof op> => op !== null);

      if (bulkOps.length) {
        await this.rowModel.bulkWrite(bulkOps, { ordered: false });
        enriched += bulkOps.length;
      }
    }

    return enriched;
  }

  private async completeFlipkartReturnUpload(
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
    existingUploadId?: string | null,
  ) {
    const { gst, marketplace } = ctx;
    const sellerId = ctx.canonicalSellerId || dto.sellerId;
    const marketplaceId = marketplace._id?.toString?.() ?? dto.marketplaceId;
    const returnFile = files.returnReportFile!;
    const parsedReturn = this.flipkartImport.validateReturnFile(returnFile);
    this.flipkartImport.validateReturnHeaders(parsedReturn.headers);
    this.validation.validateRequiredHeaderGroups(
      parsedReturn.headers,
      FLIPKART_RETURN_REQUIRED_HEADER_GROUPS,
      'Return Report',
    );

    const returnByOrder = this.flipkartImport.indexReturnDetailsByOrderId(
      parsedReturn.rows,
    );

    const salesUploads = await this.uploadModel
      .find({
        sellerId,
        gstin: gst.gstNumber,
        marketplace: marketplaceId,
        reportMonth: dto.reportMonth,
        status: 'completed',
        totalRecords: { $gt: 0 },
      })
      .select('_id')
      .lean()
      .exec();

    if (!salesUploads.length) {
      throw new BadRequestException(
        'No sales import found for this GST, marketplace, and month. Upload the Sales Report first.',
      );
    }

    const uploadIds = salesUploads.map((item) => String(item._id));
    const returnVoucherRows = await this.rowModel
      .find({
        uploadId: { $in: uploadIds },
        voucherType: { $regex: /^return$/i },
      })
      .select(['_id', 'orderID'])
      .lean()
      .exec();

    const bulkOps = returnVoucherRows
      .map((row) => {
        const details = lookupFlipkartReturnDetails(returnByOrder, row.orderID);
        if (!details) return null;
        const hasValues =
          details.typeOfReturn ||
          details.returnReason ||
          details.detailedReturnReason;
        if (!hasValues) return null;
        return {
          updateOne: {
            filter: { _id: row._id },
            update: { $set: details },
          },
        };
      })
      .filter((op): op is NonNullable<typeof op> => op !== null);

    if (bulkOps.length) {
      await this.rowModel.bulkWrite(bulkOps, { ordered: false });
    }

    const fileHash = this.validation.computeFileHash(returnFile.buffer);
    const fileName = returnFile.originalname;
    const matchedOrders = new Set(
      returnVoucherRows
        .filter((row) =>
          Boolean(lookupFlipkartReturnDetails(returnByOrder, row.orderID)),
        )
        .map((row) => this.flipkartImport.orderIdLookupKey(row.orderID)),
    );
    const unmatchedReturnRows = [...returnByOrder.keys()].filter(
      (orderId) => !matchedOrders.has(orderId),
    ).length;

    const uploadIdStr = await this.resolveDedicatedUploadRecord(
      existingUploadId,
      {
        sellerId,
        gstId: dto.gstId,
        gstin: gst.gstNumber,
        marketplace: marketplaceId,
        reportMonth: dto.reportMonth,
        fileName,
        fileHash: `flipkart-return|${fileHash}|month:${dto.reportMonth ?? ''}`,
        uploadedSlots: ['returnReportFile'],
        fileSize: returnFile.buffer.length,
        totalRecords: bulkOps.length,
        salesRecords: bulkOps.length,
        cashbackRecords: 0,
        status: 'completed',
        lifecycleStatus: 'completed',
      },
    );
    await this.importWorkflow.recordSlotUploads({
      sellerId,
      gstId: dto.gstId,
      marketplaceId,
      reportMonth: dto.reportMonth!,
      uploadId: uploadIdStr,
      uploadedSlots: ['returnReportFile'],
      fileName,
      fileSize: returnFile.buffer.length,
      importBatchId: uploadIdStr,
      slotDetails: {
        returnReportFile: {
          fileName,
          fileSize: returnFile.buffer.length,
          totalRecords: parsedReturn.rows.length,
          salesRecords: bulkOps.length,
          cashbackRecords: 0,
          includeDbBreakdown: false,
        },
      },
    });

    const message =
      unmatchedReturnRows > 0
        ? `Return details applied to ${bulkOps.length} order(s). ${unmatchedReturnRows} return report row(s) had no matching returned sales order for this month.`
        : bulkOps.length
          ? `Return details applied to ${bulkOps.length} order(s).`
          : 'Return report uploaded. No returned sales orders matched for this month.';

    return {
      success: true,
      status: 'completed' as const,
      message,
      uploadId: uploadIdStr,
      count: bulkOps.length,
      rowErrorCount: 0,
    };
  }

  private async completeAmazonReturnUpload(
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
    existingUploadId?: string | null,
  ) {
    const { gst, marketplace } = ctx;
    const sellerId = ctx.canonicalSellerId || dto.sellerId;
    const marketplaceId = marketplace._id?.toString?.() ?? dto.marketplaceId;
    const returnFile = files.amazonReturnReportFile!;
    const parsedReturn = this.amazonImport.validateReturnFile(returnFile);
    this.amazonImport.validateReturnHeaders(parsedReturn.headers);
    this.validation.validateRequiredHeaderGroups(
      parsedReturn.headers,
      AMAZON_RETURN_REQUIRED_HEADER_GROUPS,
      'Return Report',
    );

    const returnByOrder = this.amazonImport.indexReturnDetailsByOrderId(
      parsedReturn.rows,
    );

    const salesUploads = await this.uploadModel
      .find({
        sellerId,
        gstin: gst.gstNumber,
        marketplace: marketplaceId,
        reportMonth: dto.reportMonth,
        status: 'completed',
        totalRecords: { $gt: 0 },
      })
      .select('_id')
      .lean()
      .exec();

    if (!salesUploads.length) {
      throw new BadRequestException(
        'No Amazon MTR import found for this GST, marketplace, and month. Upload MTR B2C or B2B first.',
      );
    }

    const uploadIds = salesUploads.map((item) => String(item._id));
    const returnTxnRows = await this.rowModel
      .find({
        uploadId: { $in: uploadIds },
        $or: [
          {
            documentType: {
              $regex: /(REFUND|CANCEL|\bRETURN\b|RTO)/i,
            },
          },
          {
            voucherType: {
              $regex: /(REFUND|CANCEL|\bRETURN\b|RTO)/i,
            },
          },
        ],
      })
      .select([
        '_id',
        'orderID',
        'documentType',
        'voucherType',
        'amazonMtrSource',
        'customerGstNo',
      ])
      .lean()
      .exec();

    const bulkOps = returnTxnRows
      .filter(
        (row) =>
          !isAmazonCancellationTransaction(row.documentType, row.voucherType),
      )
      .map((row) => {
        const details = lookupAmazonReturnDetails(returnByOrder, row.orderID);
        let finalRow: AmazonReturnDetails & {
          documentType?: string;
          voucherType?: string;
          amazonMtrSource?: 'b2b' | 'b2c';
          customerGstNo?: string;
        } = {
          documentType: row.documentType,
          voucherType: row.voucherType,
          amazonMtrSource: row.amazonMtrSource,
          customerGstNo: row.customerGstNo,
        };
        if (details) {
          finalRow = applyAmazonReturnDetailsToRow(finalRow, details);
        }
        finalRow = applyAmazonReturnTransactionDefaults(finalRow);
        const $set: Record<string, string> = {};
        if (finalRow.typeOfReturn) $set.typeOfReturn = finalRow.typeOfReturn;
        if (finalRow.amazonReturnSubType) {
          $set.amazonReturnSubType = finalRow.amazonReturnSubType;
        }
        if (finalRow.returnReason) $set.returnReason = finalRow.returnReason;
        if (!Object.keys($set).length) return null;
        return {
          updateOne: {
            filter: { _id: row._id },
            update: { $set },
          },
        };
      })
      .filter((op): op is NonNullable<typeof op> => op !== null);

    if (bulkOps.length) {
      await this.rowModel.bulkWrite(bulkOps, { ordered: false });
    }

    const naRows = parsedReturn.rows
      .filter((row) => {
        const orderId = getRowCell(
          row,
          'Order Id',
          'Order ID',
          'order_id',
          'Order Number',
        );
        return !String(orderId ?? '').trim();
      })
      .map((row) => ({
        ...this.buildAmazonNaReturnRow(row, gst.gstNumber),
        __sheetName: row.__sheetName,
        __rowNumber: row.__rowNumber,
      }));

    const fileHash = this.validation.computeFileHash(returnFile.buffer);
    const fileName = returnFile.originalname;
    const uploadIdStr = await this.resolveDedicatedUploadRecord(
      existingUploadId,
      {
        sellerId,
        gstId: dto.gstId,
        gstin: gst.gstNumber,
        marketplace: marketplaceId,
        reportMonth: dto.reportMonth,
        fileName,
        fileHash: `amazon-return|${fileHash}|month:${dto.reportMonth ?? ''}`,
        uploadedSlots: ['amazonReturnReportFile'],
        fileSize: returnFile.buffer.length,
        totalRecords: bulkOps.length + naRows.length,
        salesRecords: bulkOps.length + naRows.length,
        cashbackRecords: 0,
        status: 'completed',
        lifecycleStatus: 'completed',
      },
    );
    if (naRows.length) {
      await insertImportRowsInBatches(this.rowModel, naRows, {
        uploadId: uploadIdStr,
        sellerId,
        marketplace: marketplaceId,
        gstin: gst.gstNumber,
        reportMonth: dto.reportMonth,
      });
    }

    await this.importWorkflow.recordSlotUploads({
      sellerId,
      gstId: dto.gstId,
      marketplaceId,
      reportMonth: dto.reportMonth!,
      uploadId: uploadIdStr,
      uploadedSlots: ['amazonReturnReportFile'],
      fileName,
      fileSize: returnFile.buffer.length,
      importBatchId: uploadIdStr,
      slotDetails: {
        amazonReturnReportFile: {
          fileName,
          fileSize: returnFile.buffer.length,
          totalRecords: parsedReturn.rows.length,
          salesRecords: bulkOps.length + naRows.length,
          cashbackRecords: 0,
          includeDbBreakdown: false,
        },
      },
    });

    const matchedOrders = new Set(
      returnTxnRows
        .filter((row) =>
          Boolean(lookupAmazonReturnDetails(returnByOrder, row.orderID)),
        )
        .map((row) => this.amazonImport.orderIdLookupKey(row.orderID)),
    );
    const unmatchedReturnRows = [...returnByOrder.keys()].filter(
      (orderId) => !matchedOrders.has(orderId),
    ).length;

    const message =
      unmatchedReturnRows > 0 || naRows.length > 0
        ? `Return details applied to ${bulkOps.length} order(s). ${naRows.length} row(s) stored as #N/A without order id. ${unmatchedReturnRows} return report row(s) had no matching Amazon return transaction for this month.`
        : bulkOps.length
          ? `Return details applied to ${bulkOps.length} order(s).`
          : 'Return report uploaded. No matching Amazon return transactions found for this month.';

    return {
      success: true,
      status: 'completed' as const,
      message,
      uploadId: uploadIdStr,
      count: bulkOps.length + naRows.length,
      rowErrorCount: 0,
    };
  }

  private buildAmazonNaReturnRow(
    returnRow: ParsedSheetRow,
    sellerGSTIN: string,
  ): NormalizedImportRow {
    const details = this.amazonImport.mapReturnFields(returnRow);
    return {
      reportType: 'sales',
      documentType: 'Return Report',
      sellerGSTIN,
      typeOfReturn: details.typeOfReturn ?? '#N/A',
      amazonReturnSubType: details.amazonReturnSubType ?? 'na',
      quantity: 0,
      invoiceAmount: 0,
      taxableAmount: 0,
      igstAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
    };
  }

  async processImport(
    expectedMarketplace: 'flipkart' | 'amazon' | 'meesho' | 'myntra',
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
    existingUploadId: string | null,
    instrumentation?: {
      timer?: ImportPerformanceTimer;
      onProgress?: (
        phase: ImportJobPhase,
        pct: number,
        rowsImported?: number,
        totalRecords?: number,
      ) => void;
    },
  ) {
    const timer = instrumentation?.timer;
    const onProgress = instrumentation?.onProgress;
    const { gst, marketplace, marketplaceIdentifier } = ctx;
    const sellerId = ctx.canonicalSellerId || dto.sellerId;
    const isAmazon = marketplaceIdentifier.includes('amazon');
    const isMeesho = marketplaceIdentifier.includes('meesho');
    const isMyntra = marketplaceIdentifier.includes('myntra');
    const isFlipkart = expectedMarketplace === 'flipkart';
    let flipkartGstSkippedRows = 0;
    let amazonGstSkippedRows = 0;
    let meeshoGstSkippedRows = 0;
    let myntraGstSkippedRows = 0;
    if (!existingUploadId) {
      const marketplaceId = marketplace._id?.toString?.() ?? dto.marketplaceId;
      await this.assertRequiredFiles(
        { isAmazon, isMeesho, isMyntra },
        files,
        dto.reportMonth
          ? {
              sellerId,
              gstId: dto.gstId,
              marketplaceId,
              reportMonth: dto.reportMonth,
            }
          : undefined,
      );
    }

    const hasMeeshoImportFile = Boolean(
      files.tcsSalesFile ||
      files.tcsSalesReturnFile ||
      files.orderReportFile ||
      files.returnInTransitReportFile ||
      files.returnOutForDeliveryReportFile ||
      files.returnDeliveryCompleteReportFile,
    );
    if (isMeesho && files.paymentReportFile && !hasMeeshoImportFile) {
      return this.completeMeeshoPaymentUpload(
        files,
        dto,
        ctx,
        existingUploadId,
      );
    }
    const hasFlipkartSalesFile = Boolean(files.file);
    if (
      isAmazon &&
      this.collectAmazonPaymentFiles(files).length &&
      !files.mtrB2cFile &&
      !files.mtrB2bFile &&
      !files.amazonReturnReportFile
    ) {
      return this.completeAmazonPaymentUpload(
        files,
        dto,
        ctx,
        existingUploadId,
      );
    }
    if (
      isFlipkart &&
      files.paymentReportFile &&
      !hasFlipkartSalesFile &&
      !files.returnReportFile
    ) {
      return this.completeFlipkartPaymentUpload(
        files,
        dto,
        ctx,
        existingUploadId,
      );
    }
    const hasMyntraSalesFile = Boolean(
      files.gstrReportPackedFile ||
      files.salesRevenuePackedB2cFile ||
      files.gstrReportRtoFile ||
      files.gstrReportRtFile ||
      files.mDirectOrdersReportFile ||
      files.mDirectReturnsReportFile,
    );
    if (isMyntra && hasMyntraPaymentFiles(files) && !hasMyntraSalesFile) {
      return this.completeMyntraPaymentUpload(
        files,
        dto,
        ctx,
        existingUploadId,
      );
    }
    if (
      isFlipkart &&
      files.returnReportFile &&
      !hasFlipkartSalesFile &&
      !files.paymentReportFile
    ) {
      return this.completeFlipkartReturnUpload(
        files,
        dto,
        ctx,
        existingUploadId,
      );
    }
    const hasAmazonMtr = Boolean(files.mtrB2cFile || files.mtrB2bFile);
    if (isAmazon && files.amazonReturnReportFile && !hasAmazonMtr) {
      return this.completeAmazonReturnUpload(files, dto, ctx, existingUploadId);
    }

    timer?.startStage('excelParsing');
    onProgress?.('reading_excel', 15);
    // Parse Flipkart/Amazon in worker threads so status polling and other API calls
    // stay responsive while a 5–10 MB workbook is read.
    await yieldToEventLoop();
    const parsedFlipkart =
      isFlipkart && files.file
        ? await this.parser.parseFlipkartWorkbookInWorker(files.file.buffer)
        : null;
    if (isFlipkart && files.returnReportFile) {
      this.flipkartImport.validateReturnFile(files.returnReportFile);
    }
    await yieldToEventLoop();
    const parsedAmazonB2b =
      isAmazon && files.mtrB2bFile
        ? await this.parser.parseAmazonWorkbookInWorker(files.mtrB2bFile.buffer)
        : null;
    await yieldToEventLoop();
    const parsedAmazonB2c =
      isAmazon && files.mtrB2cFile
        ? await this.parser.parseAmazonWorkbookInWorker(files.mtrB2cFile.buffer)
        : null;
    await yieldToEventLoop();
    const parsedMeesho =
      isMeesho && hasMeeshoImportFile
        ? await this.meeshoImport.parseFiles({
            tcsSalesFile: files.tcsSalesFile,
            tcsSalesReturnFile: files.tcsSalesReturnFile,
            orderReportFile: files.orderReportFile,
            returnInTransitReportFile: files.returnInTransitReportFile,
            returnOutForDeliveryReportFile:
              files.returnOutForDeliveryReportFile,
            returnDeliveryCompleteReportFile:
              files.returnDeliveryCompleteReportFile,
          })
        : null;
    await yieldToEventLoop();
    const parsedMyntra =
      isMyntra &&
      files.gstrReportPackedFile &&
      files.salesRevenuePackedB2cFile &&
      files.gstrReportRtoFile &&
      files.gstrReportRtFile
        ? await this.myntraImport.parseFiles({
            gstrReportPackedFile: files.gstrReportPackedFile,
            mDirectOrdersReportFile: files.mDirectOrdersReportFile,
            salesRevenuePackedB2cFile: files.salesRevenuePackedB2cFile,
            gstrReportRtoFile: files.gstrReportRtoFile,
            gstrReportRtFile: files.gstrReportRtFile,
            mDirectReturnsReportFile: files.mDirectReturnsReportFile,
          })
        : null;
    timer?.endStage('excelParsing');
    timer?.startStage('sheetProcessing');
    onProgress?.('processing_sheet', 28);
    await yieldToEventLoop();
    timer?.endStage('sheetProcessing');

    timer?.startStage('columnMapping');
    onProgress?.('mapping_data', 35);
    if (isAmazon && (parsedAmazonB2c || parsedAmazonB2b)) {
      const requiredAmazonHeaderGroups = [
        [...amazonImportMapping.gstin.excelColumns],
        ['Order Id', 'Order ID'],
        ['Sku', 'SKU'],
        ['Hsn/sac', 'HSN Code'],
        ['Transaction Type'],
        ['Payment Method', 'Payment Mode', 'Payment Method Code'],
        ['Fulfillment Channel', 'Fullfilment Channel', 'Fulfilment Type'],
        ['Quantity'],
        ['Invoice Amount'],
        ['Tax Exclusive Gross', 'Taxable Amount', 'Taxable Value'],
        ['Igst Rate', 'IGST Rate'],
        ['Igst Tax', 'IGST Amount'],
        ['Cgst Rate', 'CGST Rate'],
        ['Cgst Tax', 'CGST Amount'],
        ['Sgst Rate', 'SGST Rate'],
        ['Sgst Tax', 'SGST Amount'],
        ['Invoice Number', 'Invoice No'],
        ['Invoice Date'],
        ['Ship To Postal Code', 'Pincode'],
        ['Ship To State', 'State Name'],
      ];
      if (parsedAmazonB2c) {
        this.validation.validateRequiredHeaderGroups(
          parsedAmazonB2c.headers,
          requiredAmazonHeaderGroups,
          'Amazon MTR B2C Report',
        );
        const amazonB2cGstFilter =
          this.validation.filterAmazonRowsBySelectedGstin(
            parsedAmazonB2c.rows,
            gst.gstNumber,
            parsedAmazonB2c.headers,
            {
              reportLabel: 'Amazon MTR B2C Report',
              fileName: files.mtrB2cFile?.originalname,
            },
          );
        parsedAmazonB2c.rows = amazonB2cGstFilter.rows;
        amazonGstSkippedRows += amazonB2cGstFilter.skippedCount;
      }
      if (parsedAmazonB2b) {
        this.validation.validateRequiredHeaderGroups(
          parsedAmazonB2b.headers,
          requiredAmazonHeaderGroups,
          'Amazon MTR B2B Report',
        );
        this.validation.validateRequiredHeaderGroups(
          parsedAmazonB2b.headers,
          AMAZON_B2B_EXTRA_HEADER_GROUPS,
          'Amazon MTR B2B Report',
        );
        const amazonB2bGstFilter =
          this.validation.filterAmazonRowsBySelectedGstin(
            parsedAmazonB2b.rows,
            gst.gstNumber,
            parsedAmazonB2b.headers,
            {
              reportLabel: 'Amazon MTR B2B Report',
              fileName: files.mtrB2bFile?.originalname,
            },
          );
        parsedAmazonB2b.rows = amazonB2bGstFilter.rows;
        amazonGstSkippedRows += amazonB2bGstFilter.skippedCount;
      }
    } else if (parsedFlipkart) {
      const requiredSalesHeaderGroups = [
        [...flipkartImportMapping.gstin.excelColumns],
        ['Order ID'],
        ['Invoice No', 'Buyer Invoice ID'],
        ['Buyer Invoice Date'],
        ['Taxable Amount', 'Taxable Value'],
        ['IGST Amount'],
        ['CGST Amount'],
        ['SGST Amount', 'UTGST Amount'],
        ['Document Type', 'Event Type'],
      ];
      const requiredCashbackHeaderGroups = [
        [...flipkartImportMapping.gstin.excelColumns],
        ['Order ID'],
        [
          'Invoice No',
          'Credit Note ID',
          'Debit Note ID',
          'Credit Note ID / Debit Note ID',
        ],
        ['Invoice Date'],
        ['Taxable Amount', 'Taxable Value'],
        ['IGST Amount'],
        ['CGST Amount'],
        ['SGST Amount', 'UTGST Amount'],
        ['Payment Mode', 'Document Type'],
      ];
      this.validation.validateRequiredHeaderGroups(
        parsedFlipkart.headers['Sales Report'],
        requiredSalesHeaderGroups,
        'Sales Report',
      );
      this.validation.validateRequiredHeaderGroups(
        parsedFlipkart.headers['Cash Back Report'],
        requiredCashbackHeaderGroups,
        'Cash Back Report',
      );
      const flipkartGstFilter =
        this.validation.filterFlipkartRowsBySelectedGstin(
          parsedFlipkart,
          gst.gstNumber,
        );
      parsedFlipkart.salesRows = flipkartGstFilter.salesRows;
      parsedFlipkart.cashbackRows = flipkartGstFilter.cashbackRows;
      flipkartGstSkippedRows = flipkartGstFilter.skippedCount;
    } else if (isMeesho && parsedMeesho) {
      const requiredTcsSalesHeaderGroups = [
        ['gstin', 'GST NO'],
        [...MEESHO_ORDER_ID_ALIASES],
        ['hsn_code', 'HSN Code'],
        ['quantity', 'Quantity'],
        ['total_invoice_value', 'Invoice Amount'],
        ['total_taxable_sale_value', 'Taxable Amount'],
        ['gst_rate', 'IGST Rate'],
        ['tax_amount', 'IGST Amount'],
        ['order_date', 'Invoice Date'],
        ['end_customer_state_new', 'State Name'],
      ];
      if (files.tcsSalesFile) {
        this.validation.validateRequiredHeaderGroups(
          parsedMeesho.tcsSales.headers,
          requiredTcsSalesHeaderGroups,
          'TCS Sales Report',
        );
      }
      if (files.orderReportFile) {
        this.validation.validateRequiredHeaderGroups(
          parsedMeesho.orderReport.headers,
          [
            ['Sub Order No', ...MEESHO_ORDER_ID_ALIASES],
            ['SKU', 'SKU ID'],
            [
              'Status',
              'Order Status',
              'Live Order Status',
              'Reason for Credit Entry',
            ],
          ],
          'Order Report',
        );
      }
      if (files.tcsSalesReturnFile) {
        this.validation.validateRequiredHeaderGroups(
          parsedMeesho.tcsSalesReturn.headers,
          [
            [...MEESHO_ORDER_ID_ALIASES],
            ['cancel_return_date', 'Return Invoice Date'],
          ],
          'TCS Sales Return Report',
        );
      }
      const lifecycleReturnHeaderGroups = [
        [...MEESHO_ORDER_ID_ALIASES],
        ['Type of Return'],
        ['Sub Type'],
        ['Qty', 'Return Qty'],
        ['Return Reason'],
        ['Detailed Return Reason'],
      ];
      if (files.returnInTransitReportFile) {
        this.validation.validateRequiredHeaderGroups(
          parsedMeesho.returnInTransit.headers,
          lifecycleReturnHeaderGroups,
          'Return In-Transit Report',
        );
      }
      if (files.returnOutForDeliveryReportFile) {
        this.validation.validateRequiredHeaderGroups(
          parsedMeesho.returnOutForDelivery.headers,
          lifecycleReturnHeaderGroups,
          'Return Out for Delivery Report',
        );
      }
      if (files.returnDeliveryCompleteReportFile) {
        this.validation.validateRequiredHeaderGroups(
          parsedMeesho.returnDeliveryComplete.headers,
          lifecycleReturnHeaderGroups,
          'Return Delivery Complete Report',
        );
      }
      const meeshoGstReports = [
        files.tcsSalesFile
          ? {
              reportLabel: 'TCS Sales Report',
              fileName: files.tcsSalesFile.originalname,
              headers: parsedMeesho.tcsSales.headers,
              rows: parsedMeesho.tcsSales.rows,
            }
          : null,
        files.tcsSalesReturnFile
          ? {
              reportLabel: 'TCS Sales Return Report',
              fileName: files.tcsSalesReturnFile.originalname,
              headers: parsedMeesho.tcsSalesReturn.headers,
              rows: parsedMeesho.tcsSalesReturn.rows,
            }
          : null,
        files.orderReportFile
          ? {
              reportLabel: 'Order Report',
              fileName: files.orderReportFile.originalname,
              headers: parsedMeesho.orderReport.headers,
              rows: parsedMeesho.orderReport.rows,
            }
          : null,
        files.returnInTransitReportFile
          ? {
              reportLabel: 'Return In-Transit Report',
              fileName: files.returnInTransitReportFile.originalname,
              headers: parsedMeesho.returnInTransit.headers,
              rows: parsedMeesho.returnInTransit.rows,
            }
          : null,
        files.returnOutForDeliveryReportFile
          ? {
              reportLabel: 'Return Out for Delivery Report',
              fileName: files.returnOutForDeliveryReportFile.originalname,
              headers: parsedMeesho.returnOutForDelivery.headers,
              rows: parsedMeesho.returnOutForDelivery.rows,
            }
          : null,
        files.returnDeliveryCompleteReportFile
          ? {
              reportLabel: 'Return Delivery Complete Report',
              fileName: files.returnDeliveryCompleteReportFile.originalname,
              headers: parsedMeesho.returnDeliveryComplete.headers,
              rows: parsedMeesho.returnDeliveryComplete.rows,
            }
          : null,
      ].filter(
        (report): report is NonNullable<typeof report> => report !== null,
      );
      if (meeshoGstReports.length) {
        const meeshoGstFilter = this.validation.filterMeeshoGstinBundle(
          meeshoGstReports,
          gst.gstNumber,
        );
        meeshoGstSkippedRows = meeshoGstFilter.skippedCount;
        for (const report of meeshoGstFilter.reports) {
          switch (report.reportLabel) {
            case 'TCS Sales Report':
              parsedMeesho.tcsSales.rows = report.rows;
              break;
            case 'TCS Sales Return Report':
              parsedMeesho.tcsSalesReturn.rows = report.rows;
              break;
            case 'Order Report':
              parsedMeesho.orderReport.rows = report.rows;
              break;
            case 'Return In-Transit Report':
              parsedMeesho.returnInTransit.rows = report.rows;
              break;
            case 'Return Out for Delivery Report':
              parsedMeesho.returnOutForDelivery.rows = report.rows;
              break;
            case 'Return Delivery Complete Report':
              parsedMeesho.returnDeliveryComplete.rows = report.rows;
              break;
            default:
              break;
          }
        }
      }
    } else if (isMyntra && parsedMyntra) {
      const returnCorrection = correctMyntraReturnFileAssignment(parsedMyntra, {
        rto: files.gstrReportRtoFile?.originalname,
        rt: files.gstrReportRtFile?.originalname,
      });
      if (returnCorrection.error) {
        throw new BadRequestException(returnCorrection.error);
      }
      if (returnCorrection.swapped && returnCorrection.message) {
        this.logger.log(returnCorrection.message);
      }

      const myntraValidationReports = [
        {
          reportLabel: 'GSTR Report Packed',
          fileName: files.gstrReportPackedFile?.originalname ?? '',
          headers: parsedMyntra.gstrReportPacked.headers,
          rows: parsedMyntra.gstrReportPacked.rows,
          requiredHeaderGroups: MYNTRA_GSTR_PACKED_HEADERS,
          checkGstin: true,
        },
        {
          reportLabel: 'Sales Revenue Packed B2C',
          fileName: files.salesRevenuePackedB2cFile?.originalname ?? '',
          headers: parsedMyntra.salesRevenueB2c.headers,
          rows: parsedMyntra.salesRevenueB2c.rows,
          requiredHeaderGroups: MYNTRA_SALES_REVENUE_HEADERS,
        },
        {
          reportLabel: 'GSTR Report RTO',
          fileName: files.gstrReportRtoFile?.originalname ?? '',
          headers: parsedMyntra.gstrReportRto.headers,
          rows: parsedMyntra.gstrReportRto.rows,
          requiredHeaderGroups: MYNTRA_GSTR_RTO_HEADERS,
        },
        {
          reportLabel: 'GSTR Report RT',
          fileName: files.gstrReportRtFile?.originalname ?? '',
          headers: parsedMyntra.gstrReportRt.headers,
          rows: parsedMyntra.gstrReportRt.rows,
          requiredHeaderGroups: MYNTRA_GSTR_RT_HEADERS,
        },
      ];
      if (files.mDirectOrdersReportFile) {
        myntraValidationReports.splice(1, 0, {
          reportLabel: 'MDirect Orders Report',
          fileName: files.mDirectOrdersReportFile.originalname,
          headers: parsedMyntra.mDirectOrders.headers,
          rows: parsedMyntra.mDirectOrders.rows,
          requiredHeaderGroups: MYNTRA_MDIRECT_ORDERS_HEADERS,
        });
      }
      if (files.mDirectReturnsReportFile) {
        myntraValidationReports.push({
          reportLabel: 'MDirect Returns Report',
          fileName: files.mDirectReturnsReportFile.originalname,
          headers: parsedMyntra.mDirectReturns.headers,
          rows: parsedMyntra.mDirectReturns.rows,
          requiredHeaderGroups: MYNTRA_MDIRECT_RETURNS_HEADERS,
        });
      }
      const myntraGstFilter = this.validation.filterMyntraGstinBundle(
        myntraValidationReports,
        gst.gstNumber,
      );
      myntraGstSkippedRows = myntraGstFilter.skippedCount;
      for (const report of myntraGstFilter.reports) {
        switch (report.reportLabel) {
          case 'GSTR Report Packed':
            parsedMyntra.gstrReportPacked.rows = report.rows;
            break;
          case 'Sales Revenue Packed B2C':
            parsedMyntra.salesRevenueB2c.rows = report.rows;
            break;
          case 'MDirect Orders Report':
            parsedMyntra.mDirectOrders.rows = report.rows;
            break;
          case 'GSTR Report RTO':
            parsedMyntra.gstrReportRto.rows = report.rows;
            break;
          case 'GSTR Report RT':
            parsedMyntra.gstrReportRt.rows = report.rows;
            break;
          case 'MDirect Returns Report':
            parsedMyntra.mDirectReturns.rows = report.rows;
            break;
          default:
            break;
        }
      }
    }
    timer?.endStage('columnMapping');

    let { fileHash, fileHashes, fileName } = this.buildFileHashBundle(
      files,
      isAmazon,
      isMeesho,
      isMyntra,
    );
    if (dto.reportMonth) {
      fileHash = `${fileHash}|month:${dto.reportMonth}`;
    }
    const normalizedRows: Array<
      NormalizedImportRow & {
        __sheetName: string;
        __rowNumber: number;
      }
    > = [];
    const rowErrors: Array<{
      sheetName: string;
      rowNumber: number;
      error: string;
    }> = [];
    let paymentSourceRowCount = 0;
    let parsedAmazonReturn: {
      rows: ParsedSheetRow[];
      headers: string[];
    } | null = null;
    let myntraHistoricalSaleIds: string[] = [];

    timer?.startStage('dataTransformation');
    onProgress?.('processing_sheet', 48);
    if (isAmazon && (parsedAmazonB2c || parsedAmazonB2b)) {
      let returnByOrder: Map<string, AmazonReturnDetails> | null = null;
      if (files.amazonReturnReportFile) {
        parsedAmazonReturn = this.amazonImport.validateReturnFile(
          files.amazonReturnReportFile,
        );
        this.amazonImport.validateReturnHeaders(parsedAmazonReturn.headers);
        this.validation.validateRequiredHeaderGroups(
          parsedAmazonReturn.headers,
          AMAZON_RETURN_REQUIRED_HEADER_GROUPS,
          'Return Report',
        );
        returnByOrder = this.amazonImport.indexReturnDetailsByOrderId(
          parsedAmazonReturn.rows,
        );
      }

      const amazonMtrBatches: Array<{
        rows: ParsedSheetRow[];
        source: 'b2b' | 'b2c';
      }> = [];
      if (parsedAmazonB2b?.rows.length) {
        amazonMtrBatches.push({ rows: parsedAmazonB2b.rows, source: 'b2b' });
      }
      if (parsedAmazonB2c?.rows.length) {
        amazonMtrBatches.push({ rows: parsedAmazonB2c.rows, source: 'b2c' });
      }

      const amazonImportPreview: Record<string, unknown>[] = [];
      let amazonSkippedCancelRows = 0;

      const amazonChunk = 500;
      for (const {
        rows: amazonRows,
        source: amazonMtrSource,
      } of amazonMtrBatches) {
        for (let i = 0; i < amazonRows.length; i += 1) {
          const row = amazonRows[i];
          try {
            let mapped = this.mapping.mapAmazonRow(row);
            mapped.amazonMtrSource = amazonMtrSource;
            if (
              shouldSkipAmazonMtrImportRow(
                mapped.documentType,
                mapped.voucherType,
              )
            ) {
              amazonSkippedCancelRows += 1;
              continue;
            }
            if (
              isAmazonCountableReturnTransaction(
                mapped.documentType,
                mapped.voucherType,
                mapped.amazonMtrSource,
                mapped.customerGstNo,
              )
            ) {
              if (returnByOrder && mapped.orderID) {
                mapped = applyAmazonReturnDetailsToRow(
                  mapped,
                  lookupAmazonReturnDetails(returnByOrder, mapped.orderID),
                );
              }
              mapped = applyAmazonReturnTransactionDefaults(mapped);
            }
            normalizedRows.push({
              ...mapped,
              __sheetName: row.__sheetName,
              __rowNumber: row.__rowNumber,
            });
            amazonImportPreview.push(mapped);
          } catch {
            rowErrors.push({
              sheetName: row.__sheetName,
              rowNumber: row.__rowNumber,
              error: 'Failed to normalize amazon row',
            });
          }
          if (i > 0 && i % amazonChunk === 0) {
            await yieldToEventLoop();
          }
        }
      }

      if (parsedAmazonReturn) {
        for (const returnRow of parsedAmazonReturn.rows) {
          const orderId = getRowCell(
            returnRow,
            'Order Id',
            'Order ID',
            'order_id',
            'Order Number',
          );
          if (String(orderId ?? '').trim()) continue;
          const naRow = this.buildAmazonNaReturnRow(returnRow, gst.gstNumber);
          normalizedRows.push({
            ...naRow,
            __sheetName: returnRow.__sheetName,
            __rowNumber: returnRow.__rowNumber,
          });
          amazonImportPreview.push(naRow);
        }
      }

      const amazonDebug = buildAmazonImportDebugReport(amazonImportPreview);

      console.log(
        `[AMAZON_IMPORT] b2b=${parsedAmazonB2b?.rows.length ?? 0} b2c=${parsedAmazonB2c?.rows.length ?? 0} returnReport=${parsedAmazonReturn?.rows.length ?? 0} skippedCancel=${amazonSkippedCancelRows} classified=${JSON.stringify(amazonDebug.totalsByBucket)}`,
      );

      console.log(
        `[AMAZON_IMPORT] rows=${JSON.stringify(amazonDebug.rows, null, 2)}`,
      );
    } else if (isMeesho && parsedMeesho) {
      let paymentRows: typeof parsedMeesho.tcsSales.rows | undefined;
      if (files.paymentReportFile) {
        const parsedPayment = this.meeshoImport.parsePaymentFile(
          files.paymentReportFile,
        );
        this.validation.validateRequiredHeaderGroups(
          parsedPayment.headers,
          MEESHO_PAYMENT_REQUIRED_HEADER_GROUPS,
          'Order Payments',
        );
        paymentRows = parsedPayment.rows;
        paymentSourceRowCount = parsedPayment.rows.length;
      }

      console.log(
        `[MEESHO_BUILD] tcsSales=${parsedMeesho.tcsSales.rows.length} tcsReturn=${parsedMeesho.tcsSalesReturn.rows.length} order=${parsedMeesho.orderReport.rows.length} inTransit=${parsedMeesho.returnInTransit.rows.length} outForDelivery=${parsedMeesho.returnOutForDelivery.rows.length} deliveryComplete=${parsedMeesho.returnDeliveryComplete.rows.length} payment=${paymentRows?.length ?? 0}`,
      );
      const meeshoResult = this.meeshoImport.buildNormalizedRows(
        parsedMeesho,
        gst.state,
        paymentRows,
      );
      normalizedRows.push(...meeshoResult.rows);
      rowErrors.push(...meeshoResult.errors);
    } else if (isMyntra && parsedMyntra) {
      if (existingUploadId) {
        await this.uploadModel.findByIdAndUpdate(existingUploadId, {
          $set: { totalRecords: 0 },
        });
      }
      const marketplaceId = marketplace._id?.toString?.() ?? dto.marketplaceId;
      const myntraResult = await this.myntraImport.buildNormalizedRows(
        parsedMyntra,
        {
          sellerIds: ctx.sellerIdAliases,
          gstin: gst.gstNumber,
          marketplaceId,
          reportMonth: dto.reportMonth ?? '',
        },
      );
      if (myntraResult.joinIssues && myntraResult.rows.length === 0) {
        throw new BadRequestException(
          formatMyntraJoinIssues(myntraResult.joinIssues),
        );
      }
      normalizedRows.push(...myntraResult.rows);
      rowErrors.push(...myntraResult.errors);
      myntraHistoricalSaleIds = myntraResult.historicalSaleIdsToMarkReturned;
    } else if (parsedFlipkart) {
      let paymentByOrder: Map<string, ParsedSheetRow> | null = null;
      let returnByOrder: Map<string, FlipkartReturnDetails> | null = null;
      if (files.paymentReportFile) {
        const parsedPayment = this.flipkartImport.parsePaymentFile(
          files.paymentReportFile,
        );
        this.validation.validateRequiredHeaderGroups(
          parsedPayment.headers,
          FLIPKART_PAYMENT_REQUIRED_HEADER_GROUPS,
          'Orders',
        );
        paymentByOrder = this.flipkartImport.indexByOrderId(parsedPayment.rows);
        paymentSourceRowCount = parsedPayment.rows.length;
      }
      if (files.returnReportFile) {
        const parsedReturn = this.flipkartImport.parseReturnFile(
          files.returnReportFile,
        );
        this.flipkartImport.validateReturnHeaders(parsedReturn.headers);
        this.validation.validateRequiredHeaderGroups(
          parsedReturn.headers,
          FLIPKART_RETURN_REQUIRED_HEADER_GROUPS,
          'Return Report',
        );
        returnByOrder = this.flipkartImport.indexReturnDetailsByOrderId(
          parsedReturn.rows,
        );
      }

      const enrichFlipkartRow = (
        mapped: NormalizedImportRow,
        options?: { applyReturnDetails?: boolean },
      ): NormalizedImportRow => {
        let result = mapped;
        if (paymentByOrder && mapped.orderID) {
          const paymentRow = paymentByOrder.get(String(mapped.orderID));
          if (paymentRow) {
            result = {
              ...result,
              ...this.flipkartImport.mapPaymentFields(paymentRow),
            };
          }
        }
        if (
          options?.applyReturnDetails &&
          returnByOrder &&
          isFlipkartReturnVoucherType(mapped.voucherType) &&
          mapped.orderID
        ) {
          result = applyFlipkartReturnDetailsToRow(
            result,
            lookupFlipkartReturnDetails(returnByOrder, mapped.orderID),
          );
        }
        return applyFlipkartInvoiceAmount(result);
      };

      const mapChunkSize = 1000;
      for (let i = 0; i < parsedFlipkart.salesRows.length; i += 1) {
        const row = parsedFlipkart.salesRows[i];
        try {
          normalizedRows.push({
            ...enrichFlipkartRow(this.mapping.mapSalesRow(row), {
              applyReturnDetails: true,
            }),
            __sheetName: row.__sheetName,
            __rowNumber: row.__rowNumber,
          });
        } catch {
          rowErrors.push({
            sheetName: row.__sheetName,
            rowNumber: row.__rowNumber,
            error: 'Failed to normalize sales row',
          });
        }
        if (i > 0 && i % mapChunkSize === 0) {
          await yieldToEventLoop();
        }
      }

      for (let i = 0; i < parsedFlipkart.cashbackRows.length; i += 1) {
        const row = parsedFlipkart.cashbackRows[i];
        try {
          normalizedRows.push({
            ...enrichFlipkartRow(this.mapping.mapCashbackRow(row)),
            __sheetName: row.__sheetName,
            __rowNumber: row.__rowNumber,
          });
        } catch {
          rowErrors.push({
            sheetName: row.__sheetName,
            rowNumber: row.__rowNumber,
            error: 'Failed to normalize cashback row',
          });
        }
        if (i > 0 && i % mapChunkSize === 0) {
          await yieldToEventLoop();
        }
      }
    }

    const sellerGstRegistration =
      await this.validation.getSellerGstRegistrationInfo(ctx.sellerIdAliases);
    const sellerGstStates = [...sellerGstRegistration.states];
    const sellerGstins = [...sellerGstRegistration.gstins];
    if (gst.state) {
      sellerGstStates.unshift(gst.state);
    }
    if (gst.gstNumber) {
      sellerGstins.unshift(gst.gstNumber);
    }
    // Flipkart month summary must match the Excel pivot (raw file tax columns).
    for (const row of normalizedRows) {
      if (!isFlipkart) {
        if (
          isMyntra &&
          row.documentType === 'RTO Return' &&
          row.myntraReturnMatchStatus === 'MATCHED_PREVIOUS_MONTH'
        ) {
          // Preserve original prior-month sale GST breakup for RTO rows.
          continue;
        }
        this.mapping.normalizeTaxByState(row, sellerGstStates, sellerGstins);
      }
    }

    timer?.endStage('dataTransformation');
    onProgress?.('saving_data', 55, 0, normalizedRows.length);

    const invoiceDates = normalizedRows
      .map((row) => row.invoiceDate)
      .filter(
        (item): item is string => typeof item === 'string' && item.length > 0,
      )
      .sort();

    const minInvoiceDate = invoiceDates[0];
    const maxInvoiceDate = invoiceDates[invoiceDates.length - 1];
    if (normalizedRows.length === 0) {
      if (isMyntra && parsedMyntra) {
        throw new BadRequestException(
          formatMyntraEmptyImport({
            'GSTR Report Packed': parsedMyntra.gstrReportPacked.rows.length,
            'MDirect Orders Report': parsedMyntra.mDirectOrders.rows.length,
            'Sales Revenue Packed B2C':
              parsedMyntra.salesRevenueB2c.rows.length,
            'GSTR Report RTO': parsedMyntra.gstrReportRto.rows.length,
            'GSTR Report RT': parsedMyntra.gstrReportRt.rows.length,
            'MDirect Returns Report': parsedMyntra.mDirectReturns.rows.length,
          }),
        );
      }
      const hint = rowErrors.length
        ? `${rowErrors.length} row(s) failed validation/mapping.`
        : 'No data rows found in uploaded file(s). Check sheet names and required columns.';
      throw new BadRequestException(`Import produced no records. ${hint}`);
    }
    const marketplaceId = marketplace._id?.toString?.() ?? dto.marketplaceId;
    const { paymentReportFiles: _paymentFiles, ...slotFileMap } = files;
    const uploadedSlots = collectUploadedSlotsFromFiles(
      slotFileMap as Record<string, { buffer?: Buffer } | undefined>,
    );

    // Re-upload for the same slot must replace only that slot's prior rows.
    if (dto.reportMonth && uploadedSlots.length) {
      const retiredUploadIds =
        await this.importWorkflow.deletePreviousSlotUploadData({
          sellerId,
          gstId: dto.gstId,
          marketplaceId,
          reportMonth: dto.reportMonth,
          uploadedSlots,
          keepUploadId: existingUploadId ?? undefined,
          marketplace: expectedMarketplace,
        });
      for (const retiredUploadId of retiredUploadIds) {
        await this.settlementService.deleteNormalizedUpload(retiredUploadId);
      }
    }

    await this.validation.ensureNoDuplicateFileHashes({
      sellerId,
      gstin: gst.gstNumber,
      marketplace: marketplaceId,
      fileHashes,
      excludeUploadId: existingUploadId ?? undefined,
      reportMonth: dto.reportMonth,
    });
    await this.validation.ensureNotDuplicate({
      sellerId,
      gstin: gst.gstNumber,
      marketplace: marketplaceId,
      fileHash,
      minInvoiceDate,
      maxInvoiceDate,
      totalRecords: normalizedRows.length,
      excludeUploadId: existingUploadId ?? undefined,
      reportMonth: dto.reportMonth,
    });

    let uploadId = existingUploadId ?? '';
    if (!uploadId) {
      const upload = await this.uploadModel.create({
        sellerId,
        gstId: dto.gstId,
        gstin: gst.gstNumber,
        marketplace: marketplaceId,
        ...(dto.reportMonth ? { reportMonth: dto.reportMonth } : {}),
        fileName,
        fileHash,
        uploadedSlots,
        totalRecords: normalizedRows.length,
        minInvoiceDate,
        maxInvoiceDate,
        salesRecords: normalizedRows.filter((row) => row.reportType === 'sales')
          .length,
        cashbackRecords: normalizedRows.filter(
          (row) => row.reportType === 'cashback',
        ).length,
        status: 'processing',
      });
      uploadId = upload._id?.toString?.() ?? '';
    }

    timer?.startStage('databaseInsert');
    const totalRows = normalizedRows.length;
    await insertImportRowsInBatches(
      this.rowModel,
      normalizedRows,
      {
        uploadId,
        sellerId,
        gstin: gst.gstNumber,
        marketplace: marketplaceId,
        reportMonth: dto.reportMonth,
      },
      async (savedCount) => {
        await this.uploadModel.findByIdAndUpdate(uploadId, {
          $set: { processedRecords: savedCount },
        });
        const pct =
          totalRows > 0
            ? Math.min(95, 55 + Math.round((savedCount / totalRows) * 40))
            : 95;
        onProgress?.('saving_data', pct, savedCount, totalRows);
      },
      { progressThrottleMs: 1500 },
    );
    timer?.endStage('databaseInsert');

    if (myntraHistoricalSaleIds.length) {
      await this.rowModel.updateMany(
        { _id: { $in: myntraHistoricalSaleIds } },
        { $set: { myntraIsReturned: true } },
      );
    }

    if (rowErrors.length) {
      await this.rowErrorModel.insertMany(
        rowErrors.map((err) => ({ uploadId, ...err })),
      );
    }

    const salesRecords = normalizedRows.filter(
      (row) => row.reportType === 'sales',
    ).length;
    const cashbackRecords = normalizedRows.filter(
      (row) => row.reportType === 'cashback',
    ).length;

    timer?.startStage('postProcessing');

    if (isFlipkart && files.paymentReportFile && uploadId) {
      try {
        const paymentUploadSummary =
          await this.flipkartPaymentService.processUpload({
            buffer: files.paymentReportFile.buffer,
            uploadedFileName: files.paymentReportFile.originalname,
            sellerId,
            gstId: dto.gstId,
            gstin: gst.gstNumber,
            marketplace: marketplaceId,
            reportMonth: dto.reportMonth,
            uploadId,
            duplicateStrategy: 'update',
          });
        if (paymentUploadSummary.neftIds?.length) {
          await this.analyticsPayoutsService.resetReceiptsForNefts({
            sellerId,
            marketplace: marketplaceId,
            neftIds: paymentUploadSummary.neftIds,
          });
        }
      } catch (error) {
        this.logger.warn(
          `Flipkart payment collection persist failed for upload ${uploadId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (isAmazon && uploadId) {
      const amazonPaymentFiles = this.collectAmazonPaymentFiles(files);
      if (amazonPaymentFiles.length) {
        try {
          await this.processAmazonPaymentFileBatch(
            amazonPaymentFiles,
            dto,
            ctx,
            null,
          );
        } catch (error) {
          this.logger.warn(
            `Amazon payment persist after MTR upload failed for upload ${uploadId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    await this.uploadModel.findByIdAndUpdate(uploadId, {
      $set: {
        status: 'completed',
        lifecycleStatus: 'completed',
        totalRecords: normalizedRows.length,
        minInvoiceDate,
        maxInvoiceDate,
        salesRecords,
        cashbackRecords,
        fileHash,
        fileName,
        uploadedSlots,
        fileSize: this.sumFileSizes(files),
      },
      $unset: { errorMessage: 1 },
    });

    if (dto.reportMonth) {
      const slotDetails = buildSlotUploadDetails({
        files,
        uploadedSlots,
        normalizedRows,
        parsedMeesho,
        parsedFlipkart,
        parsedAmazonB2c,
        parsedAmazonB2b,
        parsedAmazonReturn,
        parsedMyntra,
        paymentSourceRowCount,
      });
      await this.importWorkflow.recordSlotUploads({
        sellerId,
        gstId: dto.gstId,
        marketplaceId,
        reportMonth: dto.reportMonth,
        uploadId,
        uploadedSlots,
        fileName,
        fileSize: this.sumFileSizes(files),
        importBatchId: uploadId,
        slotDetails,
      });
    }
    await this.settlementService.replaceNormalizedUpload(
      uploadId,
      this.normalizeOrderTransactions(normalizedRows, expectedMarketplace, {
        sellerId,
        gstId: dto.gstId,
        gstin: gst.gstNumber,
        reportMonth: dto.reportMonth,
        uploadId,
      }),
    );
    await this.reconciliationService.enqueueForUpload(uploadId);
    this.skuMasterSyncService.enqueueForUpload(uploadId);
    timer?.endStage('postProcessing');
    onProgress?.('completed', 100, normalizedRows.length);

    const gstSkippedRows =
      flipkartGstSkippedRows +
      amazonGstSkippedRows +
      meeshoGstSkippedRows +
      myntraGstSkippedRows;

    return {
      success: true,
      status: 'completed' as const,
      message:
        gstSkippedRows > 0
          ? `Imported ${normalizedRows.length} record(s) for the selected GSTIN. ${gstSkippedRows} row(s) for other GSTINs were skipped.`
          : 'File uploaded successfully',
      uploadId,
      count: normalizedRows.length,
      rowErrorCount: rowErrors.length,
    };
  }

  private normalizeOrderTransactions(
    rows: NormalizedImportRow[],
    marketplace: string,
    context: {
      sellerId: string;
      gstId: string;
      gstin: string;
      reportMonth?: string;
      uploadId: string;
    },
  ): NormalizedTransaction[] {
    return rows.flatMap((row, index) => {
      const orderId = String(row.orderID ?? '').trim();
      if (!orderId) return [];
      const flipkartClassification =
        marketplace === 'flipkart'
          ? classifyFlipkartSettlementRow(row.documentType, row.voucherType)
          : null;
      const isReturnDocument =
        flipkartClassification?.role === 'return' ||
        row.myntraTransactionType === 'RETURN' ||
        Number(row.returnQty ?? 0) > 0 ||
        /return|credit|refund/i.test(String(row.documentType ?? ''));
      const invoiceAmount = Math.abs(Number(row.invoiceAmount ?? 0));
      const saleAmount = Math.abs(
        Number(
          flipkartClassification
            ? flipkartClassification.role === 'sale'
              ? invoiceAmount
              : 0
            : (row.totalSaleAmountInclShippingGst ??
                (!isReturnDocument ? row.invoiceAmount : 0) ??
                0),
        ),
      );
      const returnAmount =
        (flipkartClassification?.role === 'return'
          ? flipkartClassification.sign
          : 1) *
        Math.abs(
          Number(
            flipkartClassification
              ? flipkartClassification.role === 'return'
                ? invoiceAmount
                : 0
              : (row.meeshoReturnInvoiceAmount ??
                  row.totalSaleReturnAmountInclShippingGst ??
                  (isReturnDocument ? row.invoiceAmount : 0) ??
                  0),
          ),
        );
      const settlementDate = new Date(
        row.paymentDate ??
          row.invoiceDate ??
          row.returnInvoiceDate ??
          row.frRefundedDate ??
          Date.now(),
      );
      const orderDateValue =
        row.order_created_date ??
        row.invoiceDate ??
        row.buyerInvoiceDate ??
        row.order_packed_date;
      const orderDate = orderDateValue ? new Date(orderDateValue) : undefined;
      const settlementId =
        String(row.transactionId ?? '').trim() ||
        `UNSETTLED-${context.reportMonth ?? 'UNKNOWN'}`;
      const base = {
        sellerId: context.sellerId,
        gstId: context.gstId,
        gstin: context.gstin,
        marketplace,
        settlementId,
        settlementDate,
        ...(orderDate && !Number.isNaN(orderDate.getTime())
          ? { orderDate }
          : {}),
        orderId,
        currency: 'INR',
        contributesToReceived: false,
        disputed: false,
        sourceType: 'order-report',
        uploadId: context.uploadId,
        reportMonth: context.reportMonth,
        metadata: {
          skuId: row.skuID,
          invoiceNo: row.invoiceNo,
          documentType: row.documentType,
          voucherType: row.voucherType,
          quantity: row.quantity,
        },
      };
      const transactions: NormalizedTransaction[] = [];
      if (Number.isFinite(saleAmount) && saleAmount !== 0) {
        transactions.push({
          ...base,
          transactionType: 'sale',
          transactionCategory: 'Sales',
          transactionName:
            flipkartClassification?.transactionName ?? 'Order Sale',
          calculationRole: 'sale',
          amount: saleAmount,
          sourceId: `${context.uploadId}:${index}:sale`,
        });
      }
      if (Number.isFinite(returnAmount) && returnAmount !== 0) {
        transactions.push({
          ...base,
          transactionType: 'return',
          transactionCategory: 'Returns',
          transactionName:
            flipkartClassification?.transactionName ?? 'Order Return',
          calculationRole: 'return',
          amount: returnAmount,
          sourceId: `${context.uploadId}:${index}:return`,
        });
      }
      return transactions;
    });
  }

  private sumFileSizes(files: MarketplaceFilesInput): number {
    let total = 0;
    for (const value of Object.values(files)) {
      if (!value) continue;
      if (Array.isArray(value)) {
        total += value.reduce(
          (sum, file) => sum + (file.buffer?.length ?? 0),
          0,
        );
        continue;
      }
      total += value.buffer?.length ?? 0;
    }
    return total;
  }
}
