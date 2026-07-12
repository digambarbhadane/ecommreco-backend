import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { ImportJobService } from './import-job.service';
import { ImportProgressGateway } from '../gateways/import-progress.gateway';
import { UploadService } from './upload.service';
import { yieldToEventLoop } from '../utils/import-performance.util';

export type QueuedImportPayload = {
  jobId: string;
  expectedMarketplace: 'flipkart' | 'amazon' | 'meesho' | 'myntra';
  fileUploadMs?: number;
};

@Injectable()
export class ImportQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportQueueService.name);
  private queue?: Queue;
  private worker?: Worker;
  private readonly inMemoryQueue: QueuedImportPayload[] = [];
  private processing = false;
  private useBull = false;

  constructor(
    private readonly config: ConfigService,
    private readonly importJobService: ImportJobService,
    @Inject(forwardRef(() => UploadService))
    private readonly uploadService: UploadService,
    private readonly progressGateway: ImportProgressGateway,
  ) {}

  async onModuleInit() {
    try {
      await this.importJobService.failStaleActiveJobs();
      await this.uploadService.failStaleProcessingUploads();
    } catch (err) {
      this.logger.warn(
        `Could not clean stale import jobs on startup: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.processing = false;
    this.inMemoryQueue.length = 0;

    const redisUrl = this.config.get<string>('REDIS_URL');
    if (redisUrl?.trim()) {
      this.useBull = true;
      this.queue = new Queue('import-jobs', {
        connection: { url: redisUrl },
      });
      this.worker = new Worker(
        'import-jobs',
        async (job) => {
          await this.processJob(job.data as QueuedImportPayload);
        },
        { connection: { url: redisUrl }, concurrency: 1 },
      );
      this.worker.on('failed', (job, err) => {
        this.logger.error(
          `Bull import job failed id=${job?.id} error=${err.message}`,
        );
      });
      this.logger.log('Import queue: BullMQ worker started');
    } else {
      this.logger.log(
        'Import queue: in-process worker (set REDIS_URL for BullMQ)',
      );
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  async enqueue(payload: QueuedImportPayload) {
    if (this.useBull && this.queue) {
      await this.queue.add('process-import', payload, {
        removeOnComplete: 100,
        removeOnFail: 50,
      });
      return;
    }

    this.inMemoryQueue.push(payload);
    setImmediate(() => {
      void this.drainInMemoryQueue();
    });
  }

  private async drainInMemoryQueue() {
    if (this.processing) return;
    this.processing = true;
    await yieldToEventLoop();
    try {
      while (this.inMemoryQueue.length) {
        const next = this.inMemoryQueue.shift();
        if (!next) break;
        try {
          await this.processJob(next);
        } catch (err) {
          this.logger.error(
            `Unhandled import job error ${next.jobId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        await yieldToEventLoop();
      }
    } finally {
      this.processing = false;
      if (this.inMemoryQueue.length) {
        setImmediate(() => {
          void this.drainInMemoryQueue();
        });
      }
    }
  }

  private async processJob(payload: QueuedImportPayload) {
    this.logger.log(
      `Processing import job ${payload.jobId} (${payload.expectedMarketplace})`,
    );
    const job = await this.importJobService.getJob(payload.jobId);

    // Snapshot the static metadata once — avoids re-fetching on every progress event.
    const jobMeta = {
      jobId: job.jobId,
      uploadId: job.uploadId,
      sellerId: job.sellerId,
      marketplace: job.marketplace,
      reportType: job.reportType,
      fileName: job.fileName,
    };

    await this.importJobService.updateJob(payload.jobId, {
      status: 'processing',
      phase: 'reading_excel',
      progressPercentage: 8,
      startedAt: job.startedAt ?? new Date(),
    });
    this.emitSocketSync(jobMeta, 'reading_excel', 8, undefined, { status: 'processing' });

    let lastSocketEmit = 0;
    const throttleSocketMs = 800;

    try {
      const result = await this.uploadService.runQueuedImport(
        payload.jobId,
        payload.expectedMarketplace,
        {
          fileUploadMs: payload.fileUploadMs,
          onProgress: (phase, pct, rowsImported, totalRecords) => {
            const now = Date.now();
            if (now - lastSocketEmit < throttleSocketMs && pct < 100) return;
            lastSocketEmit = now;
            void this.importJobService
              .updateJob(payload.jobId, {
                status: 'processing',
                phase,
                progressPercentage: pct,
                rowsImported: rowsImported ?? 0,
                recordsProcessed: rowsImported ?? 0,
                totalRecords: totalRecords ?? job.totalRecords,
              })
              .then(() =>
                this.emitSocketSync(jobMeta, phase, pct, rowsImported, {
                  status: 'processing',
                  totalRecords,
                }),
              );
          },
        },
      );

      const completedAt = new Date();
      const durationMs = result.timings?.totalMs;
      const updatedMeta = { ...jobMeta, uploadId: result.uploadId ?? jobMeta.uploadId, fileName: result.fileName ?? jobMeta.fileName };
      await this.importJobService.updateJob(payload.jobId, {
        status: 'completed',
        phase: 'completed',
        progressPercentage: 100,
        completedAt,
        durationMs,
        rowsImported: result.count ?? 0,
        recordsProcessed: result.count ?? 0,
        totalRecords: result.count ?? 0,
        timings: result.timings,
        uploadId: result.uploadId,
        fileName: result.fileName,
      });
      this.emitSocketSync(updatedMeta, 'completed', 100, result.count, {
        status: 'completed',
        timings: result.timings,
        completedAt: completedAt.toISOString(),
        message: result.message,
        durationMs,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Import failed';
      // Re-fetch only to get uploadId in case it was set after job creation.
      const latestJob = await this.importJobService.getJob(payload.jobId);
      if (latestJob.uploadId) {
        await this.uploadService.markUploadFailedById(latestJob.uploadId, err);
      }
      await this.importJobService.updateJob(payload.jobId, {
        status: 'failed',
        phase: 'failed',
        progressPercentage: 0,
        completedAt: new Date(),
        errorMessage,
      });
      this.emitSocketSync({ ...jobMeta, uploadId: latestJob.uploadId ?? jobMeta.uploadId }, 'failed', 0, 0, {
        status: 'failed',
        errorMessage,
      });
      this.logger.error(
        `Import job ${payload.jobId} failed: ${errorMessage}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  /** Emit a socket event synchronously using pre-fetched job metadata (no DB read). */
  private emitSocketSync(
    jobMeta: {
      jobId: string;
      uploadId?: string;
      sellerId: string;
      marketplace: string;
      reportType?: string;
      fileName?: string;
    },
    phase: import('../schemas/import-job.schema').ImportJobPhase,
    progressPercentage: number,
    rowsImported?: number,
    extra?: {
      status?: string;
      timings?: Record<string, number>;
      completedAt?: string;
      message?: string;
      errorMessage?: string;
      durationMs?: number;
      totalRecords?: number;
    },
  ) {
    const status =
      extra?.status ??
      (phase === 'completed'
        ? 'completed'
        : phase === 'failed'
          ? 'failed'
          : 'processing');
    const socketPayload = {
      ...jobMeta,
      status,
      phase,
      progressPercentage,
      rowsImported,
      ...extra,
    };
    if (phase === 'completed') {
      this.progressGateway.emitCompleted(socketPayload);
    } else if (phase === 'failed') {
      this.progressGateway.emitFailed(socketPayload);
    } else {
      this.progressGateway.emitProgress(socketPayload);
    }
  }
}
