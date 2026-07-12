export type FlipkartPaymentFieldType = 'string' | 'number' | 'date' | 'integer';

export type FlipkartPaymentMappedRow = {
  orderId: string;
  orderItemId?: string;
  neftId?: string;
  neftType?: string;
  paymentDate?: string;
  bankSettlementValue?: number;
  inputGSTAndTCSCredits?: number;
  incomeTaxCredits?: number;
  saleAmount?: number;
  totalOfferAmount?: number;
  myShare?: number;
  customerAddonsAmount?: number;
  marketplaceFee?: number;
  taxes?: number;
  offerAdjustments?: number;
  protectionFund?: number;
  refund?: number;
  tier?: string;
  commissionRate?: number;
  commission?: number;
  fixedFee?: number;
  collectionFee?: number;
  pickAndPackFee?: number;
  shippingFee?: number;
  reverseShippingFee?: number;
  noCostEmiFeeReimbursement?: number;
  installationFee?: number;
  techVisitFee?: number;
  uninstallationAndPackagingFee?: number;
  customerAddonsAmountRecovery?: number;
  franchiseFee?: number;
  shopsyMarketingFee?: number;
  productCancellationFee?: number;
  tcs?: number;
  tds?: number;
  gstOnMarketplaceFees?: number;
  offerAmountSettledAsDiscountInMPFee?: number;
  itemGstRate?: number;
  discountInMarketplaceFee?: number;
  gstOnDiscount?: number;
  totalDiscountInMarketplaceFee?: number;
  offerAdjustment?: number;
  deadWeight?: number;
  lengthBreadthHeight?: string;
  volumetricWeight?: number;
  chargeableWeightSource?: string;
  chargeableWeightType?: string;
  chargeableWeightSlab?: string;
  shippingZone?: string;
  orderDate?: string;
  dispatchDate?: string;
  fulfilmentType?: string;
  sellerSku?: string;
  quantity?: number;
  productSubCategory?: string;
  additionalInformation?: string;
  returnType?: string;
  shopsyOrder?: string;
  itemReturnStatus?: string;
  invoiceId?: string;
  invoiceDate?: string;
  saleAmountSummary?: number;
  totalOfferAmountSummary?: number;
  myShareSummary?: number;
  freeShippingOffer?: number;
  nonFreeShippingOffer?: number;
  shippingOfferTotal?: number;
};

export type FlipkartPaymentReportDocument = FlipkartPaymentMappedRow & {
  marketplace: string;
  sellerId: string;
  gstId?: string;
  gstin?: string;
  reportMonth?: string;
  reportType: 'payment';
  uploadedFileName: string;
  sheetName: string;
  uploadId: string;
  uploadedAt: Date;
};

export type FlipkartPaymentUpsertPayload = Omit<
  FlipkartPaymentReportDocument,
  'uploadedAt'
>;
