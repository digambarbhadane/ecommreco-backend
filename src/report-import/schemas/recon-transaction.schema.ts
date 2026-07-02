import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReconTransactionDocument = HydratedDocument<ReconTransaction>;

@Schema({ timestamps: true, collection: 'recon_transactions' })
export class ReconTransaction {
  @Prop({ required: true, index: true })
  sellerId!: string;

  @Prop({ required: true, index: true })
  gstId!: string;

  @Prop({ required: true, index: true })
  gstin!: string;

  @Prop({ required: true, index: true })
  marketplace!: string;

  @Prop({ required: true })
  canonicalKey!: string;

  @Prop()
  orderId?: string;

  @Prop()
  skuId?: string;

  @Prop()
  invoiceNo?: string;

  @Prop()
  firstEventDate?: string;

  @Prop()
  lastEventDate?: string;

  @Prop({ index: true })
  firstReportMonth?: string;

  @Prop({ index: true })
  lastReportMonth?: string;

  @Prop({
    enum: [
      'pending',
      'delivered',
      'returned',
      'returned_only',
      'settlement_updated',
      'completed',
    ],
    default: 'pending',
  })
  status!:
    | 'pending'
    | 'delivered'
    | 'returned'
    | 'returned_only'
    | 'settlement_updated'
    | 'completed';

  @Prop({ default: 0 })
  totalSalesRows!: number;

  @Prop({ default: 0 })
  totalReturnRows!: number;

  @Prop({ default: 0 })
  totalSalesQty!: number;

  @Prop({ default: 0 })
  totalReturnQty!: number;

  @Prop({ default: 0 })
  totalSalesAmount!: number;

  @Prop({ default: 0 })
  totalReturnAmount!: number;

  @Prop({ default: 0 })
  totalSettlementAmount!: number;

  @Prop({ index: true })
  lastReconciledUploadId?: string;
}

export const ReconTransactionSchema =
  SchemaFactory.createForClass(ReconTransaction);

ReconTransactionSchema.index(
  { sellerId: 1, marketplace: 1, canonicalKey: 1 },
  { unique: true, name: 'recon_transaction_key_uniq_idx' },
);
ReconTransactionSchema.index(
  { sellerId: 1, marketplace: 1, status: 1, lastReportMonth: -1 },
  { name: 'recon_transaction_status_month_idx' },
);
