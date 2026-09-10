import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MeeshoReferralPaymentsDocument =
  HydratedDocument<MeeshoReferralPayments>;

@Schema({
  timestamps: true,
  collection: 'meesho_referral_payments',
})
export class MeeshoReferralPayments {
  @Prop({ trim: true, index: true })
  rewardId?: string;

  @Prop({ index: true })
  paymentDate?: Date;

  @Prop({ trim: true })
  storeName?: string;

  @Prop({ trim: true })
  reason?: string;

  @Prop()
  netReferralAmount?: number;

  @Prop()
  taxesGstTds?: number;

  @Prop({ required: true, default: 'meesho', index: true })
  marketplace: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  sellerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  importId: Types.ObjectId;

  @Prop({ required: true })
  importedAt: Date;

  @Prop()
  gstId?: string;

  @Prop()
  gstin?: string;

  @Prop({ index: true })
  reportMonth?: string;

  @Prop({ required: true })
  uploadedFileName: string;

  @Prop({ required: true })
  sheetName: string;
}

export const MeeshoReferralPaymentsSchema = SchemaFactory.createForClass(
  MeeshoReferralPayments,
);

MeeshoReferralPaymentsSchema.index({ sellerId: 1, importId: 1 });
MeeshoReferralPaymentsSchema.index({ sellerId: 1, rewardId: 1 });
MeeshoReferralPaymentsSchema.index({ sellerId: 1, paymentDate: 1 });
