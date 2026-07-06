import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ImportRowDocument = HydratedDocument<ImportRow>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'import_rows',
})
export class ImportRow {
  @Prop({ required: true, index: true })
  uploadId: string;

  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop({ required: true, index: true })
  gstin: string;

  @Prop({ required: true, index: true })
  marketplace: string;

  @Prop({ index: true })
  reportMonth?: string;

  @Prop({ required: true, enum: ['sales', 'cashback'], index: true })
  reportType: 'sales' | 'cashback';

  @Prop({ required: true, index: true })
  documentType: string; // canonical: Document Type

  @Prop()
  voucherType?: string; // canonical: Voucher Type

  @Prop()
  orderID?: string; // canonical: Order ID

  @Prop()
  skuID?: string; // canonical: SKU ID

  @Prop()
  hsnCode?: string;

  @Prop()
  paymentMode?: string; // canonical: Payment Mode

  @Prop()
  fulfilmentType?: string;

  @Prop()
  quantity?: number; // canonical: Quantity

  @Prop()
  invoiceAmount?: number;

  @Prop()
  taxableAmount?: number; // canonical: Taxable Amount

  @Prop()
  igstRate?: number;

  @Prop()
  igstAmount?: number;

  @Prop()
  cgstRate?: number;

  @Prop()
  cgstAmount?: number;

  @Prop()
  sgstRate?: number;

  @Prop()
  sgstAmount?: number;

  @Prop()
  gstAmount?: number;

  @Prop({ index: true })
  gstTransactionType?: 'intra' | 'inter';

  @Prop()
  invoiceNo?: string; // canonical: Invoice No

  @Prop()
  buyerInvoiceDate?: string; // canonical: Buyer Invoice Date (Sales Report)

  @Prop({ index: true })
  invoiceDate?: string;

  /** Myntra GSTR Report Packed — order_packed_date */
  @Prop({ index: true })
  order_packed_date?: string;

  /** Myntra Sales Revenue — order created date (informational; sales are dated by order_packed_date) */
  @Prop()
  order_created_date?: string;

  /** Myntra GSTR Report RT — fr_refunded_date as ISO */
  @Prop({ index: true })
  frRefundedDate?: string;

  /** Myntra GSTR Report RTO — order_cancel_date as ISO */
  @Prop({ index: true })
  orderCancelDate?: string;

  @Prop()
  pincode?: string; // canonical: Pincode

  @Prop()
  stateName?: string; // canonical: State Name

  /** Myntra GSTR — 2-digit customer_delivery_state_code for place-of-supply */
  @Prop()
  customerStateCode?: string;

  @Prop()
  customerGstNo?: string; // Amazon optional: Customer Bill To Gstid

  @Prop()
  buyerName?: string; // Amazon optional: Buyer Name

  /** Meesho-only — enriched from TCS Sales Return / Return Report */
  @Prop()
  returnInvoiceDate?: string;

  @Prop()
  typeOfReturn?: string;

  @Prop()
  subType?: string;

  @Prop()
  returnQty?: number;

  @Prop()
  returnReason?: string;

  @Prop()
  detailedReturnReason?: string;

  @Prop({ index: true })
  meeshoHasTcsReturn?: boolean;

  @Prop()
  meeshoOrderStatus?: string;

  @Prop()
  meeshoTcsReturnStatus?: string;

  @Prop({ index: true })
  meeshoIsGrossSale?: boolean;

  @Prop({ index: true })
  meeshoIsPreviousMonthReturn?: boolean;

  @Prop({ index: true })
  meeshoReturnSubType?: string;

  @Prop({ index: true })
  amazonReturnSubType?: string;

  /** Myntra — SALE or RETURN (parallel to documentType for reconciliation). */
  @Prop({ index: true })
  myntraTransactionType?: 'SALE' | 'RETURN';

  /** Myntra return ↔ sale match outcome for the uploaded return month. */
  @Prop({ index: true })
  myntraReturnMatchStatus?:
    | 'MATCHED_CURRENT_MONTH'
    | 'MATCHED_PREVIOUS_MONTH'
    | 'UNMATCHED_RETURN';

  /** Myntra sale row flagged when a return is linked (same or prior month). */
  @Prop({ index: true })
  myntraIsReturned?: boolean;

  /** Myntra return row → matched sale ImportRow _id (prior-month or current upload). */
  @Prop()
  linkedSaleRowId?: string;

  /** Original sale report month when return is matched to a prior-month sale. */
  @Prop()
  saleReferenceMonth?: string;

  @Prop()
  meeshoReturnInvoiceAmount?: number;

  @Prop()
  meeshoReturnTaxableAmount?: number;

  @Prop()
  meeshoReturnIgstAmount?: number;

  @Prop()
  meeshoReturnCgstAmount?: number;

  @Prop()
  meeshoReturnSgstAmount?: number;

  /** Meesho Order Payments — enriched by Sub Order No */
  @Prop() liveOrderStatus?: string;
  @Prop() transactionId?: string;
  @Prop() paymentDate?: string;
  @Prop() finalSettlementAmount?: number;
  @Prop() priceType?: string;
  @Prop() totalSaleAmountInclShippingGst?: number;
  @Prop() totalSaleReturnAmountInclShippingGst?: number;
  @Prop() fixedFeeInclGst?: number;
  @Prop() warehousingFeeInclGst?: number;
  @Prop() returnPremiumInclGst?: number;
  @Prop() returnPremiumInclGstOfReturn?: number;
  @Prop() meeshoCommissionPercentage?: number;
  @Prop() meeshoCommissionInclGst?: number;
  @Prop() meeshoGoldPlatformFeeInclGst?: number;
  @Prop() meeshoMallPlatformFeeInclGst?: number;
  @Prop() returnShippingChargeInclGst?: number;
  @Prop() gstCompensationPrpShipping?: number;
  @Prop() shippingChargeInclGst?: number;
  @Prop() otherSupportServiceChargesExclGst?: number;
  @Prop() waiversExclGst?: number;
  @Prop() netOtherSupportServiceChargesExclGst?: number;
  @Prop() gstOnNetOtherSupportServiceCharges?: number;
  @Prop() paymentTcs?: number;
  @Prop() tdsRatePercent?: number;
  @Prop() tds?: number;
  @Prop() compensation?: number;
  @Prop() claims?: number;
  @Prop() recovery?: number;
  @Prop() compensationReason?: string;
  @Prop() claimsReason?: string;
  @Prop() recoveryReason?: string;
}

export const ImportRowSchema = SchemaFactory.createForClass(ImportRow);
ImportRowSchema.index({
  sellerId: 1,
  gstin: 1,
  marketplace: 1,
  invoiceDate: 1,
});
ImportRowSchema.index({ sellerId: 1, documentType: 1 });
ImportRowSchema.index({ sellerId: 1, gstin: 1, invoiceDate: 1 });
ImportRowSchema.index({ sellerId: 1, invoiceDate: 1, documentType: 1 });
// Supports the payment-lookup query: uploadId $in + orderID $in
ImportRowSchema.index({ uploadId: 1, orderID: 1 });
ImportRowSchema.index(
  { sellerId: 1, marketplace: 1, orderID: 1, reportMonth: 1 },
  { name: 'import_rows_order_month_idx' },
);
