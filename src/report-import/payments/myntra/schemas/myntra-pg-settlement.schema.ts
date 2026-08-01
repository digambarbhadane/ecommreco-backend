import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type MyntraPgSettlementDocument = HydratedDocument<MyntraPgSettlementRow>;

@Schema({
  timestamps: true,
  collection: 'myntra_pg_settlement_rows',
  strict: false,
})
export class MyntraPgSettlementRow {
  @Prop({ required: true, enum: ['forward', 'reverse'], index: true })
  reportKind: 'forward' | 'reverse';

  @Prop({ required: true, index: true })
  rowKey: string;

  @Prop({ default: '', trim: true, index: true })
  orderReleaseId: string;

  @Prop({ default: '', trim: true })
  orderLineId: string;

  @Prop({ default: '', trim: true, index: true })
  sellerOrderId: string;

  @Prop({ default: '', trim: true })
  skuCode: string;

  @Prop({ default: '', trim: true, index: true })
  sellerGstn: string;

  @Prop({ default: '', trim: true })
  returnType: string;

  @Prop({ default: '', trim: true, index: true })
  returnId?: string;

  @Prop({ type: SchemaTypes.Mixed })
  returnDate?: Date | string;

  @Prop({ type: SchemaTypes.Mixed })
  packingDate?: Date | string;

  @Prop({ type: SchemaTypes.Mixed })
  deliveryDate?: Date | string;

  @Prop({ default: '', trim: true })
  invoiceNumber?: string;

  @Prop({ default: '', trim: true, index: true })
  packetId?: string;

  @Prop({ default: '', trim: true })
  hsnCode?: string;

  @Prop({ default: '', trim: true })
  ecommercePortalName?: string;

  @Prop({ default: 0 })
  sellerProductAmount?: number;

  @Prop({ default: 0 })
  postpaidAmount?: number;

  @Prop({ default: 0 })
  prepaidAmount?: number;

  @Prop({ default: 0 })
  mrp?: number;

  @Prop({ default: 0 })
  totalDiscountAmount?: number;

  @Prop({ default: 0 })
  taxableAmount?: number;

  @Prop({ default: 0 })
  igstAmount?: number;

  @Prop({ default: 0 })
  cgstAmount?: number;

  @Prop({ default: 0 })
  sgstAmount?: number;

  @Prop({ default: 0 })
  tcsAmount?: number;

  @Prop({ default: 0 })
  tdsAmount?: number;

  @Prop({ default: 0 })
  totalCommission?: number;

  @Prop({ default: 0 })
  totalLogisticsDeduction?: number;

  @Prop({ default: 0 })
  customerPaidAmt?: number;

  @Prop({ default: 0 })
  totalSettlement?: number;

  @Prop({ default: 0 })
  amountPendingSettlement?: number;

  @Prop({ default: 0 })
  prepaidPayment?: number;

  @Prop({ default: 0 })
  postpaidPayment?: number;

  @Prop({ default: '', trim: true })
  sellerName?: string;

  @Prop({ default: '', trim: true })
  myntraGstn?: string;

  @Prop({ default: '', trim: true })
  sellerTier?: string;

  /** Per-day settlement amount columns from the PG export. */
  @Prop({ type: SchemaTypes.Mixed, default: {} })
  settlementColumns?: Record<string, number>;

  @Prop({ default: 0 })
  totalActualSettlement: number;

  @Prop({ default: 0 })
  totalExpectedSettlement: number;

  @Prop({ type: SchemaTypes.Mixed })
  settlementDate?: Date | string;

  @Prop({ required: true })
  sourceRowNumber: number;

  /** All normalized column values from the PG export (snake_case keys). */
  @Prop({ type: SchemaTypes.Mixed, required: true })
  rowData: Record<string, unknown>;

  @Prop({ type: [String], default: [] })
  fieldKeys: string[];

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
  uploadedAt: Date;
}

export const MyntraPgSettlementRowSchema =
  SchemaFactory.createForClass(MyntraPgSettlementRow);

MyntraPgSettlementRowSchema.index(
  { sellerId: 1, marketplace: 1, reportMonth: 1, reportKind: 1, rowKey: 1 },
  { unique: true, name: 'myntra_pg_settlement_row_unique_idx' },
);
MyntraPgSettlementRowSchema.index(
  { sellerId: 1, marketplace: 1, gstin: 1, reportKind: 1, orderReleaseId: 1 },
  { name: 'myntra_pg_settlement_lookup_idx' },
);
MyntraPgSettlementRowSchema.index(
  { sellerId: 1, marketplace: 1, reportMonth: 1, reportKind: 1, returnId: 1 },
  { name: 'myntra_pg_settlement_reverse_lookup_idx' },
);
