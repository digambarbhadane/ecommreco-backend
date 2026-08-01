import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FlipkartPaymentTcsRecoveryDocument =
  HydratedDocument<FlipkartPaymentTcsRecovery>;

@Schema({
  timestamps: true,
  collection: 'flipkart_payment_tcs_recovery',
})
export class FlipkartPaymentTcsRecovery {
  @Prop({ required: true, index: true, trim: true })
  neftId: string;

  @Prop({ trim: true })
  settlementType?: string;

  @Prop()
  settlementValue?: number;

  @Prop({ trim: true })
  transactionId?: string;

  @Prop({ required: true, default: 'flipkart', index: true })
  marketplace: string;

  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop()
  gstId?: string;

  @Prop()
  gstin?: string;

  @Prop({ index: true })
  reportMonth?: string;

  @Prop({ required: true, default: 'payment' })
  reportType: string;

  @Prop({ required: true })
  uploadedFileName: string;

  @Prop({ required: true })
  sheetName: string;

  @Prop({ required: true, index: true })
  uploadId: string;

  @Prop({ required: true })
  uploadedAt: Date;

  @Prop({ required: true })
  rowKey: string;
}

export const FlipkartPaymentTcsRecoverySchema = SchemaFactory.createForClass(
  FlipkartPaymentTcsRecovery,
);

FlipkartPaymentTcsRecoverySchema.index(
  { sellerId: 1, marketplace: 1, rowKey: 1, reportMonth: 1 },
  { unique: true, name: 'flipkart_payment_tcs_recovery_unique_idx' },
);
