import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MeeshoOrderPaymentsDocument = HydratedDocument<MeeshoOrderPayments>;

@Schema({
  timestamps: true,
  collection: 'meesho_order_payments',
})
export class MeeshoOrderPayments {
  @Prop({ trim: true, index: true })
  subOrderNo?: string;

  @Prop({ index: true })
  orderDate?: Date;

  @Prop()
  dispatchDate?: Date;

  @Prop({ trim: true })
  productName?: string;

  @Prop({ trim: true })
  supplierSku?: string;

  @Prop({ trim: true })
  catalogId?: string;

  @Prop({ trim: true })
  orderSource?: string;

  @Prop({ trim: true })
  liveOrderStatus?: string;

  @Prop()
  productGstPercent?: number;

  @Prop()
  listingPriceInclTaxes?: number;

  @Prop()
  quantity?: number;

  @Prop({ trim: true, index: true })
  transactionId?: string;

  @Prop({ index: true })
  paymentDate?: Date;

  @Prop()
  finalSettlementAmount?: number;

  @Prop({ trim: true })
  priceType?: string;

  @Prop()
  totalSaleAmountInclShippingGst?: number;

  @Prop()
  totalSaleReturnAmountInclShippingGst?: number;

  @Prop()
  fixedFeeInclGst?: number;

  @Prop()
  warehousingFeeInclGst?: number;

  @Prop()
  returnPremiumInclGst?: number;

  @Prop()
  returnPremiumReturnInclGst?: number;

  @Prop()
  meeshoCommissionPercentage?: number;

  @Prop()
  meeshoCommissionInclGst?: number;

  @Prop()
  meeshoGoldPlatformFeeInclGst?: number;

  @Prop()
  meeshoMallPlatformFeeInclGst?: number;

  @Prop()
  fixedFeeDuplicateInclGst?: number;

  @Prop()
  warehousingFeeDuplicateInclGst?: number;

  @Prop()
  returnShippingChargeInclGst?: number;

  @Prop()
  gstCompensationPrpShipping?: number;

  @Prop()
  shippingChargeInclGst?: number;

  @Prop()
  otherSupportServiceChargesExclGst?: number;

  @Prop()
  waiversExclGst?: number;

  @Prop()
  netOtherSupportServiceChargesExclGst?: number;

  @Prop()
  gstOnNetOtherSupportServiceCharges?: number;

  @Prop()
  tcs?: number;

  @Prop()
  tdsRatePercent?: number;

  @Prop()
  tds?: number;

  @Prop()
  compensation?: number;

  @Prop()
  claims?: number;

  @Prop()
  recovery?: number;

  @Prop({ trim: true })
  compensationReason?: string;

  @Prop({ trim: true })
  claimsReason?: string;

  @Prop({ trim: true })
  recoveryReason?: string;

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

export const MeeshoOrderPaymentsSchema =
  SchemaFactory.createForClass(MeeshoOrderPayments);

MeeshoOrderPaymentsSchema.index({ sellerId: 1, importId: 1 });
MeeshoOrderPaymentsSchema.index({ sellerId: 1, subOrderNo: 1 });
MeeshoOrderPaymentsSchema.index({ sellerId: 1, transactionId: 1 });
MeeshoOrderPaymentsSchema.index({ sellerId: 1, paymentDate: 1 });
MeeshoOrderPaymentsSchema.index({ sellerId: 1, orderDate: 1 });
MeeshoOrderPaymentsSchema.index(
  { sellerId: 1, marketplace: 1, gstin: 1, paymentDate: 1 },
  { name: 'meesho_payment_payout_filter_idx' },
);
