/** Meesho payment report — "Order Payments" sheet, headers on row 2 (index 1). */
export const MEESHO_PAYMENT_SHEET_NAMES = ['Order Payments', 'order payments'];

export const MEESHO_PAYMENT_HEADER_ROW_INDEX = 1;

export type MeeshoPaymentFieldKey =
  | 'liveOrderStatus'
  | 'transactionId'
  | 'paymentDate'
  | 'finalSettlementAmount'
  | 'priceType'
  | 'totalSaleAmountInclShippingGst'
  | 'totalSaleReturnAmountInclShippingGst'
  | 'fixedFeeInclGst'
  | 'warehousingFeeInclGst'
  | 'returnPremiumInclGst'
  | 'returnPremiumInclGstOfReturn'
  | 'meeshoCommissionPercentage'
  | 'meeshoCommissionInclGst'
  | 'meeshoGoldPlatformFeeInclGst'
  | 'meeshoMallPlatformFeeInclGst'
  | 'returnShippingChargeInclGst'
  | 'gstCompensationPrpShipping'
  | 'shippingChargeInclGst'
  | 'otherSupportServiceChargesExclGst'
  | 'waiversExclGst'
  | 'netOtherSupportServiceChargesExclGst'
  | 'gstOnNetOtherSupportServiceCharges'
  | 'paymentTcs'
  | 'tdsRatePercent'
  | 'tds'
  | 'compensation'
  | 'claims'
  | 'recovery'
  | 'compensationReason'
  | 'claimsReason'
  | 'recoveryReason';

export type MeeshoPaymentFieldMapping = {
  target: MeeshoPaymentFieldKey;
  source: string[];
};

export const meeshoPaymentFieldMappings: MeeshoPaymentFieldMapping[] = [
  { target: 'liveOrderStatus', source: ['Live Order Status'] },
  { target: 'transactionId', source: ['Transaction ID'] },
  { target: 'paymentDate', source: ['Payment Date'] },
  { target: 'finalSettlementAmount', source: ['Final Settlement Amount'] },
  { target: 'priceType', source: ['Price Type'] },
  {
    target: 'totalSaleAmountInclShippingGst',
    source: ['Total Sale Amount (Incl. Shipping & GST)'],
  },
  {
    target: 'totalSaleReturnAmountInclShippingGst',
    source: ['Total Sale Return Amount (Incl. Shipping & GST)'],
  },
  { target: 'fixedFeeInclGst', source: ['Fixed Fee (Incl. GST)'] },
  {
    target: 'warehousingFeeInclGst',
    source: ['Warehousing fee (inc Gst)', 'Warehousing fee (Incl. GST)'],
  },
  { target: 'returnPremiumInclGst', source: ['Return premium (incl GST)'] },
  {
    target: 'returnPremiumInclGstOfReturn',
    source: ['Return premium (incl GST) of Return'],
  },
  {
    target: 'meeshoCommissionPercentage',
    source: ['Meesho Commission Percentage'],
  },
  {
    target: 'meeshoCommissionInclGst',
    source: ['Meesho Commission (Incl. GST)'],
  },
  {
    target: 'meeshoGoldPlatformFeeInclGst',
    source: ['Meesho gold platform fee (Incl. GST)'],
  },
  {
    target: 'meeshoMallPlatformFeeInclGst',
    source: ['Meesho mall platform fee (Incl. GST)'],
  },
  {
    target: 'returnShippingChargeInclGst',
    source: ['Return Shipping Charge (Incl. GST)'],
  },
  {
    target: 'gstCompensationPrpShipping',
    source: ['GST Compensation (PRP Shipping)'],
  },
  { target: 'shippingChargeInclGst', source: ['Shipping Charge (Incl. GST)'] },
  {
    target: 'otherSupportServiceChargesExclGst',
    source: ['Other Support Service Charges (Excl. GST)'],
  },
  { target: 'waiversExclGst', source: ['Waivers (Excl. GST)'] },
  {
    target: 'netOtherSupportServiceChargesExclGst',
    source: ['Net Other Support Service Charges (Excl. GST)'],
  },
  {
    target: 'gstOnNetOtherSupportServiceCharges',
    source: ['GST on Net Other Support Service Charges'],
  },
  { target: 'paymentTcs', source: ['TCS'] },
  { target: 'tdsRatePercent', source: ['TDS Rate %', 'TDS Rate'] },
  { target: 'tds', source: ['TDS'] },
  { target: 'compensation', source: ['Compensation'] },
  { target: 'claims', source: ['Claims'] },
  { target: 'recovery', source: ['Recovery'] },
  { target: 'compensationReason', source: ['Compensation Reason'] },
  { target: 'claimsReason', source: ['Claims Reason'] },
  { target: 'recoveryReason', source: ['Recovery Reason'] },
];

export const MEESHO_PAYMENT_REQUIRED_HEADER_GROUPS = [
  ['Sub Order No', 'sub_order_num', 'Order ID'],
] as const;
