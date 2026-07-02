import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  ImportJob,
  ImportJobDocument,
  ImportJobPhase,
  ImportJobStatus,
} from '../schemas/import-job.schema';
import type { ImportStageTimings } from '../utils/import-performance.util';

const parseYearFromMonth = (reportMonth?: string) => {
  if (!reportMonth?.trim()) return undefined;
  const year = Number(reportMonth.trim().slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
};

@Injectable()
export class ImportJobService {
  constructor(
    @InjectModel(ImportJob.name)
    private readonly jobModel: Model<ImportJobDocument>,
  ) {}

  async createJob(input: {
    sellerId: string;
    gstId: string;
    marketplaceId: string;
    marketplace: string;
    reportType?: string;
    importMonth?: string;
    fileName?: string;
    fileSize?: number;
    uploadId?: string;
    createdBy?: string;
    dtoSnapshot: Record<string, unknown>;
    storagePath: string;
    uploadedSlots: string[];
    status?: ImportJobStatus;
    reuploadCount?: number;
  }) {
    const jobId = randomUUID();
    const job = await this.jobModel.create({
      jobId,
      sellerId: input.sellerId,
      gstId: input.gstId,
      organizationId: input.sellerId,
      marketplaceId: input.marketplaceId,
      marketplace: input.marketplace,
      reportType: input.reportType,
      importMonth: input.importMonth,
      importYear: parseYearFromMonth(input.importMonth),
      fileName: input.fileName,
      fileSize: input.fileSize ?? 0,
      uploadId: input.uploadId,
      createdBy: input.createdBy,
      dtoSnapshot: input.dtoSnapshot,
      storagePath: input.storagePath,
      uploadedSlots: input.uploadedSlots,
      status: input.status ?? 'queued',
      phase: 'queued',
      progressPercentage: 0,
      rowsImported: 0,
      recordsProcessed: 0,
      totalRecords: 0,
      reuploadCount: input.reuploadCount ?? 0,
    });
    return job;
  }

  async getJob(jobId: string, sellerId?: string) {
    const job = await this.jobModel.findOne({ jobId }).lean().exec();
    if (!job) {
      throw new NotFoundException('Import job not found');
    }
    if (sellerId && String(job.sellerId) !== String(sellerId)) {
      throw new NotFoundException('Import job not found');
    }
    return job;
  }

  async listJobs(sellerId: string, limit = 50) {
    return this.jobModel
      .find({ sellerId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async listImportHistory(sellerId: string, limit = 100) {
    const jobs = await this.listJobs(sellerId, limit);
    return jobs.map((job) => ({
      jobId: job.jobId,
      marketplace: job.marketplace,
      reportType: job.reportType,
      month: job.importMonth,
      year: job.importYear,
      fileName: job.fileName,
      fileSize: job.fileSize,
      uploadedBy: job.createdBy,
      uploadedOn: (job as { createdAt?: Date }).createdAt,
      status: job.status,
      durationMs:
        job.durationMs ??
        (job.startedAt && job.completedAt
          ? new Date(job.completedAt).getTime() -
            new Date(job.startedAt).getTime()
          : job.timings?.totalMs),
      rowsImported: job.rowsImported,
      recordsProcessed: job.recordsProcessed,
      totalRecords: job.totalRecords,
      errorMessage: job.errorMessage,
      reuploadCount: job.reuploadCount ?? 0,
      timings: job.timings,
      uploadId: job.uploadId,
    }));
  }

  async listActiveJobs(sellerId: string) {
    return this.jobModel
      .find({
        sellerId,
        status: { $in: ['queued', 'uploading', 'processing'] },
        updatedAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async failStaleActiveJobs(maxAgeMs = 30 * 60 * 1000) {
    const cutoff = new Date(Date.now() - maxAgeMs);
    await this.jobModel
      .updateMany(
        {
          status: { $in: ['queued', 'uploading', 'processing'] },
          updatedAt: { $lt: cutoff },
        },
        {
          $set: {
            status: 'failed',
            phase: 'failed',
            errorMessage:
              'Import timed out or was interrupted. Please upload again.',
            completedAt: new Date(),
          },
        },
      )
      .exec();
  }

  async updateJob(
    jobId: string,
    patch: Partial<{
      status: ImportJobStatus;
      phase: ImportJobPhase;
      progressPercentage: number;
      startedAt: Date;
      completedAt: Date;
      durationMs: number;
      errorMessage: string;
      rowsImported: number;
      recordsProcessed: number;
      totalRecords: number;
      timings: ImportStageTimings;
      uploadId: string;
      fileName: string;
      storagePath: string;
    }>,
  ) {
    return this.jobModel
      .findOneAndUpdate({ jobId }, { $set: patch }, { new: true })
      .lean()
      .exec();
  }
}
