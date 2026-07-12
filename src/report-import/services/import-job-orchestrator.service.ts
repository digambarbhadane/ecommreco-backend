import { BadRequestException, Inject, Injectable, forwardRef } from '@nestjs/common';
import { UploadReportDto } from '../dto/upload-report.dto';
import { collectUploadedSlotsFromFiles } from '../import-slot.constants';
import type { MarketplaceUploadKey } from '../marketplace-upload.routes';
import { ImportFileStoreService } from './import-file-store.service';
import { ImportJobService } from './import-job.service';
import { ImportQueueService } from './import-queue.service';
import { UploadService } from './upload.service';
import { ValidationService } from './validation.service';
import { ImportPerformanceTimer } from '../utils/import-performance.util';

type UploadedFileInput = { buffer: Buffer; originalname: string };
type MarketplaceFilesInput = Record<string, UploadedFileInput | undefined>;

@Injectable()
export class ImportJobOrchestratorService {
  constructor(
    private readonly validation: ValidationService,
    @Inject(forwardRef(() => UploadService))
    private readonly uploadService: UploadService,
    private readonly fileStore: ImportFileStoreService,
    private readonly importJobService: ImportJobService,
    private readonly importQueue: ImportQueueService,
  ) {}

  async enqueueMarketplaceImport(
    expectedMarketplace: MarketplaceUploadKey,
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    options?: {
      reportType?: string;
      createdBy?: string;
      fileUploadMs?: number;
    },
  ) {
    const ctx = await this.validation.validateOwnership(dto);
    const { marketplaceIdentifier } = ctx;
    if (!marketplaceIdentifier.includes(expectedMarketplace)) {
      throw new BadRequestException(
        `Selected marketplace does not match ${expectedMarketplace} upload.`,
      );
    }
    if (!dto.reportMonth) {
      throw new BadRequestException('reportMonth is required for marketplace imports');
    }

    const isAmazon = marketplaceIdentifier.includes('amazon');
    const isMeesho = marketplaceIdentifier.includes('meesho');
    const isMyntra = marketplaceIdentifier.includes('myntra');

    const marketplaceId =
      ctx.marketplace._id?.toString?.() ?? dto.marketplaceId;
    const sellerId = ctx.canonicalSellerId || dto.sellerId;

    await this.uploadService.assertRequiredFilesPublic(
      { isAmazon, isMeesho, isMyntra },
      files,
      {
        sellerId,
        gstId: dto.gstId,
        marketplaceId,
        reportMonth: dto.reportMonth,
      },
    );
    const { fileName } = this.uploadService.buildFileHashBundlePublic(
      files,
      isAmazon,
      isMeesho,
      isMyntra,
    );
    const uploadedSlots = collectUploadedSlotsFromFiles(files);

    const storedFiles: Record<string, UploadedFileInput> = {};
    let fileSize = 0;
    for (const [slot, file] of Object.entries(files)) {
      if (file?.buffer?.length) {
        storedFiles[slot] = file;
        fileSize += file.buffer.length;
      }
    }

    const job = await this.importJobService.createJob({
      sellerId,
      gstId: dto.gstId,
      marketplaceId,
      marketplace: expectedMarketplace,
      reportType: options?.reportType ?? expectedMarketplace,
      importMonth: dto.reportMonth,
      fileName,
      fileSize,
      createdBy: options?.createdBy,
      dtoSnapshot: { ...dto },
      storagePath: '',
      uploadedSlots,
      status: 'uploading',
    });

    const storeTimer = new ImportPerformanceTimer();
    storeTimer.startStage('fileUpload');
    const storagePath = await this.fileStore.saveJobFiles(job.jobId, storedFiles);
    storeTimer.endStage('fileUpload');
    const fileUploadMs =
      options?.fileUploadMs ?? storeTimer.getTimings().fileUploadMs;

    await this.importJobService.updateJob(job.jobId, {
      status: 'queued',
      phase: 'queued',
      progressPercentage: 5,
      startedAt: new Date(),
      storagePath,
    });

    const upload = await this.uploadService.createProcessingUpload({
      sellerId,
      dto,
      ctx,
      marketplaceId,
      fileName,
      uploadedSlots,
      reportMonth: dto.reportMonth,
    });

    await this.importJobService.updateJob(job.jobId, {
      uploadId: upload.uploadId,
    });

    await this.importQueue.enqueue({
      jobId: job.jobId,
      expectedMarketplace,
      fileUploadMs,
    });

    return {
      success: true,
      status: 'queued' as const,
      jobId: job.jobId,
      uploadId: upload.uploadId,
      count: 0,
      progressPercentage: 5,
      fileUploadMs,
      message:
        'Your file has been uploaded successfully and is being processed in the background.',
    };
  }
}
