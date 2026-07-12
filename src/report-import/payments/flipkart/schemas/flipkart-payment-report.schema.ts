import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FlipkartPaymentReportDocument =
  HydratedDocument<FlipkartPaymentReport>;

@Schema({
  timestamps: true,
  collection: 'flipkart_payment_reports',
})
export class FlipkartPaymentReport {
  @Prop({ required: true, index: true, trim: true })
  orderId: string;

  @Prop({ trim: true })
  orderItemId?: string;

  @Prop({ trim: true, index: true })
  neftId?: string;

  @Prop({ trim: true })
  neftType?: string;

  @Prop({ index: true })
  paymentDate?: string;

  @Prop()
  bankSettlementValue?: number;

  @Prop()
  inputGSTAndTCSCredits?: number;

  @Prop()
  incomeTaxCredits?: number;

  @Prop()
  saleAmount?: number;

  @Prop()
  totalOfferAmount?: number;

  @Prop()
  myShare?: number;

  @Prop()
  customerAddonsAmount?: number;

  @Prop()
  marketplaceFee?: number;

  @Prop()
  taxes?: number;

  @Prop()
  offerAdjustments?: number;

  @Prop()
  protectionFund?: number;

  @Prop()
  refund?: number;

  @Prop()
  tier?: string;

  @Prop()
  commissionRate?: number;

  @Prop()
  commission?: number;

  @Prop()
  fixedFee?: number;

  @Prop()
  collectionFee?: number;

  @Prop()
  pickAndPackFee?: number;

  @Prop()
  shippingFee?: number;

  @Prop()
  reverseShippingFee?: number;

  @Prop()
  noCostEmiFeeReimbursement?: number;

  @Prop()
  installationFee?: number;

  @Prop()
  techVisitFee?: number;

  @Prop()
  uninstallationAndPackagingFee?: number;

  @Prop()
  customerAddonsAmountRecovery?: number;

  @Prop()
  franchiseFee?: number;

  @Prop()
  shopsyMarketingFee?: number;

  @Prop()
  productCancellationFee?: number;

  @Prop()
  tcs?: number;

  @Prop()
  tds?: number;

  @Prop()
  gstOnMarketplaceFees?: number;

  @Prop()
  offerAmountSettledAsDiscountInMPFee?: number;

  @Prop()
  itemGstRate?: number;

  @Prop()
  discountInMarketplaceFee?: number;

  @Prop()
  gstOnDiscount?: number;

  @Prop()
  totalDiscountInMarketplaceFee?: number;

  @Prop()
  offerAdjustment?: number;

  @Prop()
  deadWeight?: number;

  @Prop()
  lengthBreadthHeight?: string;

  @Prop()
  volumetricWeight?: number;

  @Prop()
  chargeableWeightSource?: string;

  @Prop()
  chargeableWeightType?: string;

  @Prop()
  chargeableWeightSlab?: string;

  @Prop()
  shippingZone?: string;

  @Prop({ index: true })
  orderDate?: string;

  @Prop({ index: true })
  dispatchDate?: string;

  @Prop()
  fulfilmentType?: string;

  @Prop({ trim: true })
  sellerSku?: string;

  @Prop()
  quantity?: number;

  @Prop()
  productSubCategory?: string;

  @Prop()
  additionalInformation?: string;

  @Prop()
  returnType?: string;

  @Prop()
  shopsyOrder?: string;

  @Prop()
  itemReturnStatus?: string;

  @Prop({ index: true, trim: true })
  invoiceId?: string;

  @Prop()
  invoiceDate?: string;

  @Prop()
  saleAmountSummary?: number;

  @Prop()
  totalOfferAmountSummary?: number;

  @Prop()
  myShareSummary?: number;

  @Prop()
  freeShippingOffer?: number;

  @Prop()
  nonFreeShippingOffer?: number;

  @Prop()
  shippingOfferTotal?: number;

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
}

export const FlipkartPaymentReportSchema =
  SchemaFactory.createForClass(FlipkartPaymentReport);

FlipkartPaymentReportSchema.index(
  { sellerId: 1, marketplace: 1, orderId: 1, reportMonth: 1 },
  { unique: true, name: 'flipkart_payment_order_unique_idx' },
);
FlipkartPaymentReportSchema.index(
  { sellerId: 1, paymentDate: -1 },
  { name: 'flipkart_payment_seller_payment_date_idx' },
);
FlipkartPaymentReportSchema.index(
  { sellerId: 1, invoiceId: 1 },
  { name: 'flipkart_payment_seller_invoice_idx' },
);
