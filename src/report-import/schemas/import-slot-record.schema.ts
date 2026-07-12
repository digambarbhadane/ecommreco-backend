import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ImportSlotRecordDocument = HydratedDocument<ImportSlotRecord>;

@Schema({ timestamps: true, collection: 'import_slot_records' })
export class ImportSlotRecord {
  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop({ required: true, index: true })
  gstId: string;

  @Prop({ required: true, index: true })
  marketplaceId: string;

  @Prop({ required: true, index: true })
  reportMonth: string;

  @Prop({ required: true, index: true })
  slot: string;

  @Prop({ required: true, index: true })
  uploadId: string;

  @Prop({ required: true })
  fileName: string;

  @Prop()
  fileSize?: number;

  @Prop()
  uploadedBy?: string;

  @Prop()
  importBatchId?: string;

  @Prop()
  totalRecords?: number;

  @Prop()
  salesRecords?: number;

  @Prop()
  cashbackRecords?: number;

  @Prop()
  includeDbBreakdown?: boolean;

  @Prop({
    required: true,
    enum: ['completed', 'processing', 'failed', 'deleted', 'reuploaded'],
    default: 'completed',
  })
  status: 'completed' | 'processing' | 'failed' | 'deleted' | 'reuploaded';
}

export const ImportSlotRecordSchema =
  SchemaFactory.createForClass(ImportSlotRecord);

ImportSlotRecordSchema.index(
  {
    sellerId: 1,
    gstId: 1,
    marketplaceId: 1,
    reportMonth: 1,
    slot: 1,
    status: 1,
  },
  { name: 'import_slot_lookup_idx' },
);
