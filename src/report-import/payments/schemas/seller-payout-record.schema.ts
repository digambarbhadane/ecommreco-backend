import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SellerPayoutRecordDocument = HydratedDocument<SellerPayoutRecord>;

/** Seller-entered bank receipt data keyed by marketplace + NEFT. */
@Schema({
  timestamps: true,
  collection: 'seller_payout_records',
})
export class SellerPayoutRecord {
  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop({ trim: true, uppercase: true })
  gstin?: string;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  marketplace: string;

  @Prop({ required: true, trim: true, index: true })
  neftId: string;

  /** Portal settlement / payment date from imported reports. */
  @Prop({ trim: true })
  paymentDate?: string;

  /** Expected settlement total from payment reports (cached on save). */
  @Prop()
  bankSettlementTotal?: number;

  /** Date seller received funds in bank (manual entry). */
  @Prop({ trim: true })
  bankReceiveDate?: string;

  /** Amount seller received in bank (manual entry). */
  @Prop()
  bankReceiveAmount?: number;

  @Prop({ trim: true })
  updatedBy?: string;
}

export const SellerPayoutRecordSchema =
  SchemaFactory.createForClass(SellerPayoutRecord);

SellerPayoutRecordSchema.index(
  { sellerId: 1, marketplace: 1, neftId: 1 },
  { unique: true, name: 'seller_payout_neft_unique_idx' },
);
