import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ImportUploadDocument = HydratedDocument<ImportUpload>;

@Schema({ timestamps: true, collection: 'import_uploads' })
export class ImportUpload {
  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop({ required: true, index: true })
  gstId: string;

  @Prop({ required: true, index: true })
  gstin: string;

  @Prop({ required: true, index: true })
  marketplace: string;

  @Prop({ index: true })
  reportMonth?: string;

  @Prop({ required: true, index: true })
  fileName: string;

  @Prop({ required: true, index: true })
  fileHash: string;

  @Prop({ required: true, default: 0 })
  totalRecords: number;

  @Prop()
  minInvoiceDate?: string;

  @Prop()
  maxInvoiceDate?: string;

  @Prop({ required: true, default: 0 })
  salesRecords: number;

  @Prop({ required: true, default: 0 })
  cashbackRecords: number;

  @Prop({ required: true, default: 'completed' })
  status: 'processing' | 'completed' | 'failed';

  @Prop({ type: [String], default: [] })
  uploadedSlots?: string[];

  @Prop()
  fileSize?: number;

  @Prop()
  uploadedBy?: string;

  @Prop({ index: true })
  importBatchId?: string;

  @Prop({
    enum: ['completed', 'processing', 'failed', 'deleted', 'reuploaded'],
  })
  lifecycleStatus?: 'completed' | 'processing' | 'failed' | 'deleted' | 'reuploaded';

  @Prop()
  errorMessage?: string;
}

export const ImportUploadSchema = SchemaFactory.createForClass(ImportUpload);
ImportUploadSchema.index(
  {
    sellerId: 1,
    gstin: 1,
    marketplace: 1,
    minInvoiceDate: 1,
    maxInvoiceDate: 1,
    totalRecords: 1,
  },
  { name: 'import_duplicate_guard_idx' },
);
// Fast fileHash duplicate detection
ImportUploadSchema.index({ fileHash: 1 }, { name: 'import_file_hash_idx' });
// Payment upload lookup: completed uploads for a seller+gst+marketplace+month
ImportUploadSchema.index(
  { sellerId: 1, gstId: 1, marketplace: 1, reportMonth: 1, status: 1 },
  { name: 'import_upload_payment_lookup_idx' },
);
