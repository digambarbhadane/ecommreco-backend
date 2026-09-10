import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type NormalizedTransactionDocument =
  HydratedDocument<NormalizedTransaction>;

export type SettlementCalculationRole =
  | 'sale'
  | 'return'
  | 'expense'
  | 'adjustment'
  | 'received'
  | 'ignore';

@Schema({
  timestamps: true,
  collection: 'normalized_transactions',
})
export class NormalizedTransaction {
  @Prop({ required: true, index: true })
  sellerId!: string;

  @Prop({ index: true })
  gstId?: string;

  @Prop({ uppercase: true, trim: true, index: true })
  gstin?: string;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  marketplace!: string;

  @Prop({ required: true, trim: true, index: true })
  settlementId!: string;

  @Prop({ required: true, index: true })
  settlementDate!: Date;

  @Prop({ index: true })
  orderDate?: Date;

  @Prop({ required: true, trim: true, index: true })
  orderId!: string;

  @Prop({ required: true, trim: true })
  transactionType!: string;

  @Prop({ required: true, trim: true, index: true })
  transactionCategory!: string;

  @Prop({ required: true, trim: true, index: true })
  transactionName!: string;

  @Prop({
    required: true,
    enum: ['sale', 'return', 'expense', 'adjustment', 'received', 'ignore'],
    index: true,
  })
  calculationRole!: SettlementCalculationRole;

  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true, default: 'INR', uppercase: true, trim: true })
  currency!: string;

  @Prop({ default: false, index: true })
  contributesToReceived!: boolean;

  @Prop({ default: false, index: true })
  disputed!: boolean;

  @Prop({ required: true, trim: true })
  sourceType!: string;

  @Prop({ required: true, trim: true })
  sourceId!: string;

  @Prop({ trim: true, index: true })
  uploadId?: string;

  @Prop({ trim: true, index: true })
  reportMonth?: string;

  @Prop({ type: SchemaTypes.Mixed })
  metadata?: Record<string, unknown>;
}

export const NormalizedTransactionSchema = SchemaFactory.createForClass(
  NormalizedTransaction,
);

NormalizedTransactionSchema.index(
  {
    sellerId: 1,
    marketplace: 1,
    reportMonth: 1,
    sourceType: 1,
    sourceId: 1,
  },
  { unique: true, name: 'normalized_transaction_source_uniq_idx' },
);
NormalizedTransactionSchema.index(
  { sellerId: 1, marketplace: 1, orderId: 1, settlementDate: -1 },
  { name: 'settlement_order_list_idx' },
);
NormalizedTransactionSchema.index(
  { sellerId: 1, marketplace: 1, orderId: 1, orderDate: -1 },
  { name: 'settlement_order_date_idx' },
);
NormalizedTransactionSchema.index(
  { sellerId: 1, settlementId: 1, settlementDate: -1 },
  { name: 'settlement_id_date_idx' },
);
NormalizedTransactionSchema.index(
  { sellerId: 1, transactionCategory: 1, transactionName: 1 },
  { name: 'settlement_category_name_idx' },
);
