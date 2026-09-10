import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type AmazonPaymentTransactionDocument =
  HydratedDocument<AmazonPaymentTransaction>;

@Schema({
  timestamps: true,
  collection: 'amazon_payment_transactions',
})
export class AmazonPaymentTransaction {
  @Prop({ required: true, trim: true, index: true })
  settlementId: string;

  @Prop({ type: SchemaTypes.Mixed, required: true, index: true })
  depositDate: Date | string;

  @Prop({ default: '', trim: true })
  transactionType: string;

  @Prop({ default: '', trim: true, index: true })
  orderId: string;

  @Prop({ default: '' })
  amountDescription: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  sourceRowNumber: number;

  @Prop({ required: true })
  rowKey: string;

  @Prop({ required: true, index: true })
  marketplace: string;

  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop({ index: true })
  gstId?: string;

  @Prop({ index: true })
  gstin?: string;

  @Prop({ index: true })
  reportMonth?: string;

  @Prop({ required: true, index: true })
  uploadId: string;

  @Prop({ required: true })
  uploadedFileName: string;

  @Prop({ required: true })
  sheetName: string;

  @Prop({ required: true })
  uploadedAt: Date;
}

export const AmazonPaymentTransactionSchema = SchemaFactory.createForClass(
  AmazonPaymentTransaction,
);

AmazonPaymentTransactionSchema.index(
  { sellerId: 1, marketplace: 1, reportMonth: 1, rowKey: 1 },
  { unique: true, name: 'amazon_payment_transaction_row_unique_idx' },
);
AmazonPaymentTransactionSchema.index(
  { sellerId: 1, marketplace: 1, gstin: 1, depositDate: -1 },
  { name: 'amazon_payment_transaction_filter_idx' },
);
AmazonPaymentTransactionSchema.index(
  { sellerId: 1, marketplace: 1, settlementId: 1 },
  { name: 'amazon_payment_settlement_idx' },
);
