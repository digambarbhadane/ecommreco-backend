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
import { flipkartImportMapping } from '../config/importMappings/flipkart.mapping';
import { meeshoImportMapping } from '../config/importMappings/meesho.mapping';
import { MEESHO_PAYMENT_REQUIRED_HEADER_GROUPS } from '../config/importMappings/meesho-payment.mapping';
import { FLIPKART_PAYMENT_REQUIRED_HEADER_GROUPS } from '../config/importMappings/flipkart-payment.mapping';
import { FLIPKART_RETURN_REQUIRED_HEADER_GROUPS } from '../config/importMappings/flipkart-return.mapping';
import { AMAZON_RETURN_REQUIRED_HEADER_GROUPS } from '../config/importMappings/amazon-return.mapping';
import {
  applyFlipkartReturnDetailsToRow,
  isFlipkartReturnVoucherType,
  lookupFlipkartReturnDetails,
  type FlipkartReturnDetails,
} from '../utils/flipkart-return.util';
import {
  applyAmazonReturnDetailsToRow,
  isAmazonReturnTransaction,
  lookupAmazonReturnDetails,
  type AmazonReturnDetails,
} from '../utils/amazon-return.util';
import { ValidationService } from './validation.service';
import {
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
  returnReportFile?: UploadedFileInput;
  amazonReturnReportFile?: UploadedFileInput;
  gstrReportPackedFile?: UploadedFileInput;
  mDirectOrdersReportFile?: UploadedFileInput;
  salesRevenuePackedB2cFile?: UploadedFileInput;
  gstrReportRtoFile?: UploadedFileInput;
  gstrReportRtFile?: UploadedFileInput;
  mDirectReturnsReportFile?: UploadedFileInput;
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
      !(await this.validation.sellerOwnsRecord(String(upload.sellerId), sellerId))
    ) {
      throw new NotFoundException('Import upload not found');
    }
    const totalExpected = upload.totalRecords ?? 0;
    const savedSoFar =
      upload.status === 'completed'
        ? totalExpected
        : Number(upload.processedRecords ?? 0);
    const fileLabel = String(upload.fileName ?? '').toLowerCase();
    const processingHint = fileLabel.includes('myntra')
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
            ? upload.errorMessage ?? 'Import failed'
            : `Import completed with ${savedSoFar} record(s).`,
    };
  }

  async uploadMarketplaceReport(
    expectedMarketplace: 'flipkart' | 'amazon' | 'meesho' | 'myntra',
    files: {
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
      returnReportFile?: UploadedFileInput;
      amazonReturnReportFile?: UploadedFileInput;
      gstrReportPackedFile?: UploadedFileInput;
      mDirectOrdersReportFile?: UploadedFileInput;
      salesRevenuePackedB2cFile?: UploadedFileInput;
      gstrReportRtoFile?: UploadedFileInput;
      gstrReportRtFile?: UploadedFileInput;
      mDirectReturnsReportFile?: UploadedFileInput;
    },
    dto: UploadReportDto,
    options?: { reportType?: string; createdBy?: string },
  ) {
    if (!dto.reportMonth) {
      throw new BadRequestException('reportMonth is required for marketplace imports');
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
    for (const [slot, file] of Object.entries(stored)) {
      out[slot as keyof MarketplaceFilesInput] = file;
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

    const label = expectedMarketplace.charAt(0).toUpperCase() + expectedMarketplace.slice(1);

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
      });

      await this.uploadModel.findByIdAndUpdate(uploadId, {
        $set: { fileName },
      });

      await this.processImport(
        expectedMarketplace,
        files,
        dto,
        ctx,
        uploadId,
      );
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

  private cloneFileBuffers(files: MarketplaceFilesInput): MarketplaceFilesInput {
    return {
      file: this.cloneFile(files.file),
      mtrB2bFile: this.cloneFile(files.mtrB2bFile),
      mtrB2cFile: this.cloneFile(files.mtrB2cFile),
      tcsSalesFile: this.cloneFile(files.tcsSalesFile),
      tcsSalesReturnFile: this.cloneFile(files.tcsSalesReturnFile),
      orderReportFile: this.cloneFile(files.orderReportFile),
      returnInTransitReportFile: this.cloneFile(files.returnInTransitReportFile),
      returnOutForDeliveryReportFile: this.cloneFile(
        files.returnOutForDeliveryReportFile,
      ),
      returnDeliveryCompleteReportFile: this.cloneFile(
        files.returnDeliveryCompleteReportFile,
      ),
      paymentReportFile: this.cloneFile(files.paymentReportFile),
      returnReportFile: this.cloneFile(files.returnReportFile),
      amazonReturnReportFile: this.cloneFile(files.amazonReturnReportFile),
      gstrReportPackedFile: this.cloneFile(files.gstrReportPackedFile),
      mDirectOrdersReportFile: this.cloneFile(files.mDirectOrdersReportFile),
      salesRevenuePackedB2cFile: this.cloneFile(files.salesRevenuePackedB2cFile),
      gstrReportRtoFile: this.cloneFile(files.gstrReportRtoFile),
      gstrReportRtFile: this.cloneFile(files.gstrReportRtFile),
      mDirectReturnsReportFile: this.cloneFile(files.mDirectReturnsReportFile),
    };
  }

  async markUploadFailedById(uploadId: string, err: unknown) {
    if (!uploadId) return;
    await this.markUploadFailed(uploadId, err);
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
      Array.isArray(upload.uploadedSlots) && upload.uploadedSlots.length
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
      const hasReturnOnly =
        Boolean(files.amazonReturnReportFile) && !hasMtr;
      if (!hasMtr && !hasReturnOnly) {
        throw new BadRequestException(
          'Amazon upload requires at least MTR B2C or MTR B2B Report file',
        );
      }
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
      const hasPaymentOnly =
        Boolean(files.paymentReportFile) && !hasImportFile;
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
      if (
        !files.gstrReportPackedFile ||
        !files.salesRevenuePackedB2cFile ||
        !files.gstrReportRtoFile ||
        !files.gstrReportRtFile
      ) {
        throw new BadRequestException(
          'Myntra upload requires: GSTR Report Packed, Sales Revenue Packed B2C, GSTR Report RTO, and GSTR Report RT. MDirect Orders and MDirect Returns are optional.',
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
      if (!hasFlipkartSales && !hasFlipkartPaymentOnly && !hasFlipkartReturnOnly) {
        throw new BadRequestException(
          'Flipkart upload requires a sales, return, or payment report file',
        );
      }
      if ((hasFlipkartPaymentOnly || hasFlipkartReturnOnly) && ownership) {
        const salesAlreadyUploaded = await this.importWorkflow.hasCompletedSlot({
          sellerId: ownership.sellerId,
          gstId: ownership.gstId,
          marketplaceId: ownership.marketplaceId,
          reportMonth: ownership.reportMonth,
          slot: 'file',
        });
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
    const returnOutForDeliveryReportFileHash = files.returnOutForDeliveryReportFile
      ? this.validation.computeFileHash(files.returnOutForDeliveryReportFile.buffer)
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

    const fileHash = isAmazon
      ? `amazon|b2c:${b2cFileHash || 'none'}|b2b:${b2bFileHash || 'none'}|return:${amazonReturnReportFileHash || 'none'}`
      : isMeesho
        ? `meesho|tcsSales:${tcsSalesFileHash || 'none'}|tcsSalesReturn:${tcsSalesReturnFileHash || 'none'}|order:${orderReportFileHash || 'none'}|returnInTransit:${returnInTransitReportFileHash || 'none'}|returnOutForDelivery:${returnOutForDeliveryReportFileHash || 'none'}|returnDeliveryComplete:${returnDeliveryCompleteReportFileHash || 'none'}|payment:${paymentReportFileHash || 'none'}`
        : isMyntra
          ? `myntra|gstr:${gstrReportPackedFileHash}|mdirect:${mDirectOrdersReportFileHash}|sales:${salesRevenuePackedB2cFileHash}|rto:${gstrReportRtoFileHash}|rt:${gstrReportRtFileHash}|returns:${mDirectReturnsReportFileHash}`
          : `flipkart|sales:${singleFileHash || 'none'}|return:${returnReportFileHash || 'none'}|payment:${paymentReportFileHash || 'none'}`;

    const fileHashes = isAmazon
      ? [b2cFileHash, b2bFileHash, amazonReturnReportFileHash].filter(Boolean)
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
            ].filter(Boolean)
          : [
              singleFileHash,
              returnReportFileHash,
              paymentReportFileHash,
            ].filter(Boolean);

    const fileName = isAmazon
      ? `${files.mtrB2bFile?.originalname ?? 'MTR-B2B'} + ${files.mtrB2cFile?.originalname ?? 'MTR-B2C'}`
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
          ? `${files.gstrReportPackedFile?.originalname ?? 'GSTR-Packed'} + ${files.mDirectOrdersReportFile?.originalname ?? 'MDirect-Orders'} + ${files.salesRevenuePackedB2cFile?.originalname ?? 'Sales-Revenue-B2C'} + ${files.gstrReportRtoFile?.originalname ?? 'GSTR-RTO'} + ${files.gstrReportRtFile?.originalname ?? 'GSTR-RT'} + ${files.mDirectReturnsReportFile?.originalname ?? 'MDirect-Returns'}`
          : [
              files.file?.originalname,
              files.returnReportFile?.originalname,
              files.paymentReportFile?.originalname,
            ]
              .filter(Boolean)
              .join(' + ') || 'Flipkart reports';

    return { fileHash, fileHashes, fileName };
  }

  private async completeMeeshoPaymentUpload(
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
  ) {
    const { gst, marketplace } = ctx;
    const sellerId = ctx.canonicalSellerId || dto.sellerId;
    const marketplaceId = marketplace._id?.toString?.() ?? dto.marketplaceId;
    const paymentFile = files.paymentReportFile!;
    const parsedPayment = this.meeshoImport.parsePaymentFile(paymentFile);

    this.validation.validateRequiredHeaderGroups(
      parsedPayment.headers,
      MEESHO_PAYMENT_REQUIRED_HEADER_GROUPS,
      'Order Payments',
    );

    const paymentByOrder = this.meeshoImport.indexBySubOrderNum(parsedPayment.rows);
    const orderIds = [...paymentByOrder.keys()];
    if (!orderIds.length) {
      throw new BadRequestException(
        'Payment report does not contain any rows with Sub Order No',
      );
    }

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
    if (!uploadIds.length) {
      throw new BadRequestException(
        'No sales import found for this GST, marketplace, and month. Upload TCS Sales reports first.',
      );
    }

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

    const fileHash = this.validation.computeFileHash(paymentFile.buffer);
    const fileName = paymentFile.originalname;
    const matchedOrders = new Set(
      existingRows.map((row) => String(row.orderID ?? '')),
    );
    const unmatchedPaymentRows = orderIds.filter((id) => !matchedOrders.has(id)).length;

    const upload = await this.uploadModel.create({
      sellerId,
      gstId: dto.gstId,
      gstin: gst.gstNumber,
      marketplace: marketplaceId,
      reportMonth: dto.reportMonth,
      fileName,
      fileHash: `meesho-payment|${fileHash}|month:${dto.reportMonth ?? ''}`,
      uploadedSlots: ['paymentReportFile'],
      fileSize: paymentFile.buffer.length,
      totalRecords: bulkOps.length,
      salesRecords: bulkOps.length,
      cashbackRecords: 0,
      status: 'completed',
      lifecycleStatus: 'completed',
    });

    const uploadIdStr = upload._id?.toString?.() ?? '';
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
        paymentReportFile: buildPaymentOnlySlotDetail(paymentFile, bulkOps.length),
      },
    });
    await this.reconciliationService.enqueueForUpload(uploadIdStr);

    const message =
      unmatchedPaymentRows > 0
        ? `Payment data applied to ${bulkOps.length} order(s). ${unmatchedPaymentRows} payment row(s) had no matching sales order for this month.`
        : `Payment data applied to ${bulkOps.length} order(s).`;

    return {
      success: true,
      status: 'completed' as const,
      message,
      uploadId: upload._id?.toString?.() ?? '',
      count: bulkOps.length,
      rowErrorCount: 0,
    };
  }

  private async completeFlipkartPaymentUpload(
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
  ) {
    const { gst, marketplace } = ctx;
    const sellerId = ctx.canonicalSellerId || dto.sellerId;
    const marketplaceId = marketplace._id?.toString?.() ?? dto.marketplaceId;
    const paymentFile = files.paymentReportFile!;
    const parsedPayment = this.flipkartImport.parsePaymentFile(paymentFile);

    this.validation.validateRequiredHeaderGroups(
      parsedPayment.headers,
      FLIPKART_PAYMENT_REQUIRED_HEADER_GROUPS,
      'Orders',
    );

    const paymentByOrder = this.flipkartImport.indexByOrderId(parsedPayment.rows);
    const orderIds = [...paymentByOrder.keys()];
    if (!orderIds.length) {
      throw new BadRequestException(
        'Payment report does not contain any rows with Order ID',
      );
    }

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
    if (!uploadIds.length) {
      throw new BadRequestException(
        'No sales import found for this GST, marketplace, and month. Upload the Sales Report first.',
      );
    }

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
              $set: this.flipkartImport.mapPaymentFields(paymentRow),
            },
          },
        };
      })
      .filter((op): op is NonNullable<typeof op> => op !== null);

    if (bulkOps.length) {
      await this.rowModel.bulkWrite(bulkOps, { ordered: false });
    }

    const fileHash = this.validation.computeFileHash(paymentFile.buffer);
    const fileName = paymentFile.originalname;
    const matchedOrders = new Set(
      existingRows.map((row) => String(row.orderID ?? '')),
    );
    const unmatchedPaymentRows = orderIds.filter((id) => !matchedOrders.has(id)).length;

    const upload = await this.uploadModel.create({
      sellerId,
      gstId: dto.gstId,
      gstin: gst.gstNumber,
      marketplace: marketplaceId,
      reportMonth: dto.reportMonth,
      fileName,
      fileHash: `flipkart-payment|${fileHash}|month:${dto.reportMonth ?? ''}`,
      uploadedSlots: ['paymentReportFile'],
      fileSize: paymentFile.buffer.length,
      totalRecords: bulkOps.length,
      salesRecords: bulkOps.length,
      cashbackRecords: 0,
      status: 'completed',
      lifecycleStatus: 'completed',
    });

    const uploadIdStr = upload._id?.toString?.() ?? '';
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
        paymentReportFile: buildPaymentOnlySlotDetail(paymentFile, bulkOps.length),
      },
    });
    await this.reconciliationService.enqueueForUpload(uploadIdStr);

    const message =
      unmatchedPaymentRows > 0
        ? `Payment data applied to ${bulkOps.length} order(s). ${unmatchedPaymentRows} payment row(s) had no matching sales order for this month.`
        : `${
            bulkOps.length
              ? `Payment data applied to ${bulkOps.length} order(s).`
              : 'Payment report uploaded, but no matching sales orders were found for this month.'
          }`;

    return {
      success: true,
      status: 'completed' as const,
      message,
      uploadId: upload._id?.toString?.() ?? '',
      count: bulkOps.length,
      rowErrorCount: 0,
    };
  }

  private async completeFlipkartReturnUpload(
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
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

    const upload = await this.uploadModel.create({
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
    });

    const uploadIdStr = upload._id?.toString?.() ?? '';
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
        documentType: {
          $regex: /(REFUND|CANCEL|\bRETURN\b|RTO)/i,
        },
      })
      .select(['_id', 'orderID', 'documentType', 'voucherType'])
      .lean()
      .exec();

    const bulkOps = returnTxnRows
      .map((row) => {
        const details = lookupAmazonReturnDetails(returnByOrder, row.orderID);
        if (!details?.typeOfReturn && !details?.amazonReturnSubType) return null;
        return {
          updateOne: {
            filter: { _id: row._id },
            update: {
              $set: {
                ...(details.typeOfReturn ? { typeOfReturn: details.typeOfReturn } : {}),
                ...(details.amazonReturnSubType
                  ? { amazonReturnSubType: details.amazonReturnSubType }
                  : {}),
              },
            },
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
    const upload = await this.uploadModel.create({
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
    });

    const uploadIdStr = upload._id?.toString?.() ?? '';
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
    if (
      isMeesho &&
      files.paymentReportFile &&
      !hasMeeshoImportFile
    ) {
      return this.completeMeeshoPaymentUpload(files, dto, ctx);
    }
    const hasFlipkartSalesFile = Boolean(files.file);
    if (
      isFlipkart &&
      files.paymentReportFile &&
      !hasFlipkartSalesFile &&
      !files.returnReportFile
    ) {
      return this.completeFlipkartPaymentUpload(files, dto, ctx);
    }
    if (
      isFlipkart &&
      files.returnReportFile &&
      !hasFlipkartSalesFile &&
      !files.paymentReportFile
    ) {
      return this.completeFlipkartReturnUpload(files, dto, ctx);
    }
    const hasAmazonMtr = Boolean(files.mtrB2cFile || files.mtrB2bFile);
    if (
      isAmazon &&
      files.amazonReturnReportFile &&
      !hasAmazonMtr
    ) {
      return this.completeAmazonReturnUpload(files, dto, ctx);
    }

    timer?.startStage('excelParsing');
    onProgress?.('reading_excel', 15);
    // Parse synchronously. Parsing optimisations (no redundant sheetToMatrix calls)
    // keep this to ~2-4s for a typical 5MB file. The background queue means this
    // runs off the HTTP request path; yieldToEventLoop() opens brief windows between
    // each file so other in-flight requests can be processed.
    await yieldToEventLoop();
    const parsedFlipkart =
      isFlipkart && files.file
        ? this.parser.parseFlipkartWorkbook(files.file.buffer)
        : null;
    if (isFlipkart && files.returnReportFile) {
      this.flipkartImport.validateReturnFile(files.returnReportFile);
    }
    await yieldToEventLoop();
    const parsedAmazonB2b = isAmazon && files.mtrB2bFile
      ? this.parser.parseAmazonWorkbook(files.mtrB2bFile.buffer)
      : null;
    await yieldToEventLoop();
    const parsedAmazonB2c = isAmazon && files.mtrB2cFile
      ? this.parser.parseAmazonWorkbook(files.mtrB2cFile.buffer)
      : null;
    await yieldToEventLoop();
    const parsedMeesho =
      isMeesho && hasMeeshoImportFile
        ? this.meeshoImport.parseFiles({
            tcsSalesFile: files.tcsSalesFile,
            tcsSalesReturnFile: files.tcsSalesReturnFile,
            orderReportFile: files.orderReportFile,
            returnInTransitReportFile: files.returnInTransitReportFile,
            returnOutForDeliveryReportFile: files.returnOutForDeliveryReportFile,
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
        this.validation.validateGstinMatch(
          parsedAmazonB2c.rows,
          gst.gstNumber,
          marketplaceIdentifier,
          parsedAmazonB2c.headers,
          [],
          amazonImportMapping,
        );
      }
      if (parsedAmazonB2b) {
        this.validation.validateRequiredHeaderGroups(
          parsedAmazonB2b.headers,
          requiredAmazonHeaderGroups,
          'Amazon MTR B2B Report',
        );
        this.validation.validateRequiredHeaderGroups(
          parsedAmazonB2b.headers,
          [['Customer Bill To Gstid'], ['Buyer Name']],
          'Amazon MTR B2B Report',
        );
        this.validation.validateGstinMatch(
          parsedAmazonB2b.rows,
          gst.gstNumber,
          marketplaceIdentifier,
          parsedAmazonB2b.headers,
          [],
          amazonImportMapping,
        );
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
      const flipkartGstFilter = this.validation.filterFlipkartRowsBySelectedGstin(
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
      ].filter((report): report is NonNullable<typeof report> => report !== null);
      if (meeshoGstReports.length) {
        const meeshoGstFilter = this.validation.filterMeeshoGstinBundle(
          meeshoGstReports,
          gst.gstNumber,
        );
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
      this.validation.validateMyntraImportBundle(myntraValidationReports, gst.gstNumber);
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
    let parsedAmazonReturn: { rows: ParsedSheetRow[]; headers: string[] } | null = null;
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

      const amazonRows = [...(parsedAmazonB2b?.rows ?? []), ...(parsedAmazonB2c?.rows ?? [])];
      const amazonChunk = 500;
      for (let i = 0; i < amazonRows.length; i += 1) {
        const row = amazonRows[i];
        try {
          let mapped = this.mapping.mapAmazonRow(row);
          if (
            returnByOrder &&
            isAmazonReturnTransaction(mapped.documentType, mapped.voucherType) &&
            mapped.orderID
          ) {
            mapped = applyAmazonReturnDetailsToRow(
              mapped,
              lookupAmazonReturnDetails(returnByOrder, mapped.orderID),
            );
          }
          normalizedRows.push({
            ...mapped,
            __sheetName: row.__sheetName,
            __rowNumber: row.__rowNumber,
          });
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
          normalizedRows.push({
            ...this.buildAmazonNaReturnRow(returnRow, gst.gstNumber),
            __sheetName: returnRow.__sheetName,
            __rowNumber: returnRow.__rowNumber,
          });
        }
      }
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
      // eslint-disable-next-line no-console
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
      const myntraResult = await this.myntraImport.buildNormalizedRows(parsedMyntra, {
        sellerIds: ctx.sellerIdAliases,
        gstin: gst.gstNumber,
        marketplaceId,
        reportMonth: dto.reportMonth ?? '',
      });
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

    const sellerGstRegistration = await this.validation.getSellerGstRegistrationInfo(
      ctx.sellerIdAliases,
    );
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
            'Sales Revenue Packed B2C': parsedMyntra.salesRevenueB2c.rows.length,
            'GSTR Report RTO': parsedMyntra.gstrReportRto.rows.length,
            'GSTR Report RT': parsedMyntra.gstrReportRt.rows.length,
            'MDirect Returns Report': parsedMyntra.mDirectReturns.rows.length,
          }),
        );
      }
      const hint = rowErrors.length
        ? `${rowErrors.length} row(s) failed validation/mapping.`
        : 'No data rows found in uploaded file(s). Check sheet names and required columns.';
      throw new BadRequestException(
        `Import produced no records. ${hint}`,
      );
    }
    const marketplaceId = marketplace._id?.toString?.() ?? dto.marketplaceId;

    // Re-upload for the same month must replace prior imported rows to avoid duplicates.
    if (dto.reportMonth) {
      await this.deletePreviousMonthData({
        sellerId,
        gstin: gst.gstNumber,
        marketplaceId,
        reportMonth: dto.reportMonth,
        keepUploadId: existingUploadId ?? undefined,
      });
    }

    await this.validation.ensureNoDuplicateFileHashes({
      sellerId,
      gstin: gst.gstNumber,
      marketplace: marketplaceId,
      fileHashes,
      excludeUploadId: existingUploadId ?? undefined,
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
    });

    let uploadId = existingUploadId ?? '';
    const uploadedSlots = collectUploadedSlotsFromFiles(files);
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
    await this.reconciliationService.enqueueForUpload(uploadId);
    this.skuMasterSyncService.enqueueForUpload(uploadId);
    timer?.endStage('postProcessing');
    onProgress?.('completed', 100, normalizedRows.length);

    return {
      success: true,
      status: 'completed' as const,
      message:
        flipkartGstSkippedRows > 0
          ? `Imported ${normalizedRows.length} record(s) for the selected GSTIN. ${flipkartGstSkippedRows} row(s) for other GSTINs were skipped.`
          : 'File uploaded successfully',
      uploadId,
      count: normalizedRows.length,
      rowErrorCount: rowErrors.length,
    };
  }

  private sumFileSizes(files: MarketplaceFilesInput): number {
    return Object.values(files).reduce(
      (sum, file) => sum + (file?.buffer?.length ?? 0),
      0,
    );
  }

  private async deletePreviousMonthData(input: {
    sellerId: string;
    gstin: string;
    marketplaceId: string;
    reportMonth: string;
    keepUploadId?: string;
  }) {
    const oldUploads = await this.uploadModel
      .find({
        sellerId: input.sellerId,
        gstin: input.gstin,
        marketplace: input.marketplaceId,
        reportMonth: input.reportMonth,
        ...(input.keepUploadId ? { _id: { $ne: input.keepUploadId } } : {}),
        lifecycleStatus: { $ne: 'deleted' },
      })
      .select('_id')
      .lean()
      .exec();

    const oldUploadIds = oldUploads.map((u) => String(u._id ?? '')).filter(Boolean);
    if (!oldUploadIds.length) return;

    await this.rowModel.deleteMany({ uploadId: { $in: oldUploadIds } }).exec();
    await this.rowErrorModel.deleteMany({ uploadId: { $in: oldUploadIds } }).exec();
    await this.uploadModel
      .updateMany(
        { _id: { $in: oldUploadIds } },
        {
          $set: {
            status: 'failed',
            lifecycleStatus: 'deleted',
            errorMessage: 'Deleted due to month re-upload replacement',
            totalRecords: 0,
          },
        },
      )
      .exec();
  }
}
