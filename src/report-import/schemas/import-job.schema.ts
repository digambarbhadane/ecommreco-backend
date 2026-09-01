import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { ImportStageTimings } from '../utils/import-performance.util';

export type ImportJobStatus =
  | 'queued'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ImportJobPhase =
  | 'queued'
  | 'uploading'
  | 'reading_excel'
  | 'processing_sheet'
  | 'mapping_data'
  | 'saving_data'
  | 'completed'
  | 'failed';

@Schema({ timestamps: true, collection: 'import_jobs' })
export class ImportJob {
  @Prop({ required: true, unique: true, index: true })
  jobId!: string;

  @Prop({ required: true, index: true })
  sellerId!: string;

  @Prop({ required: true, index: true })
  gstId!: string;

  @Prop({ index: true })
  organizationId?: string;

  @Prop({ required: true })
  marketplaceId!: string;

  @Prop({ required: true })
  marketplace!: string;

  @Prop()
  reportType?: string;

  @Prop()
  importMonth?: string;

  @Prop()
  importYear?: number;

  @Prop()
  fileName?: string;

  @Prop({ default: 0 })
  fileSize?: number;

  @Prop()
  uploadId?: string;

  @Prop()
  createdBy?: string;

  @Prop({
    required: true,
    enum: [
      'queued',
      'uploading',
      'processing',
      'completed',
      'failed',
      'cancelled',
    ],
    default: 'queued',
    index: true,
  })
  status!: ImportJobStatus;

  @Prop({
    enum: [
      'queued',
      'uploading',
      'reading_excel',
      'processing_sheet',
      'mapping_data',
      'saving_data',
      'completed',
      'failed',
    ],
    default: 'queued',
  })
  phase?: ImportJobPhase;

  @Prop({ default: 0, min: 0, max: 100 })
  progressPercentage!: number;

  @Prop({ default: 0 })
  recordsProcessed!: number;

  @Prop({ default: 0 })
  totalRecords!: number;

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop()
  durationMs?: number;

  @Prop()
  errorMessage?: string;

  @Prop({ default: 0 })
  rowsImported!: number;

  @Prop({ default: 0 })
  reuploadCount!: number;

  @Prop({ type: Object })
  timings?: ImportStageTimings;

  @Prop({ type: Object })
  dtoSnapshot?: Record<string, unknown>;

  @Prop()
  storagePath?: string;

  @Prop({ type: [String], default: [] })
  uploadedSlots!: string[];
}

export type ImportJobDocument = HydratedDocument<ImportJob>;
export const ImportJobSchema = SchemaFactory.createForClass(ImportJob);

ImportJobSchema.index({ sellerId: 1, createdAt: -1 });
ImportJobSchema.index({ sellerId: 1, status: 1, createdAt: -1 });
ImportJobSchema.index({ organizationId: 1, createdAt: -1 });
