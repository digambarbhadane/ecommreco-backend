import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReconEventDocument = HydratedDocument<ReconEvent>;

@Schema({ timestamps: true, collection: 'recon_events' })
export class ReconEvent {
  @Prop({ required: true, index: true })
  sellerId!: string;

  @Prop({ required: true, index: true })
  marketplace!: string;

  @Prop({ required: true, index: true })
  uploadId!: string;

  @Prop({ index: true })
  reportMonth?: string;

  @Prop({ required: true, index: true })
  canonicalKey!: string;

  @Prop({
    required: true,
    enum: ['sale', 'return', 'settlement', 'unknown'],
    index: true,
  })
  eventType!: 'sale' | 'return' | 'settlement' | 'unknown';

  @Prop({ index: true })
  eventDate?: string;

  @Prop()
  orderId?: string;

  @Prop()
  skuId?: string;

  @Prop()
  invoiceNo?: string;

  @Prop({ default: 0 })
  rowCount!: number;

  @Prop({ default: 0 })
  quantity!: number;

  @Prop({ default: 0 })
  invoiceAmount!: number;

  @Prop({ default: 0 })
  settlementAmount!: number;
}

export const ReconEventSchema = SchemaFactory.createForClass(ReconEvent);

ReconEventSchema.index(
  { sellerId: 1, marketplace: 1, eventDate: 1 },
  { name: 'recon_event_date_idx' },
);
ReconEventSchema.index(
  { uploadId: 1, canonicalKey: 1, eventType: 1 },
  { unique: true, name: 'recon_event_upload_key_uniq_idx' },
);
