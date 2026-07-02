/** Flipkart settlement / payment report — typically an "Orders" sheet with order-level payouts. */
export const FLIPKART_PAYMENT_SHEET_NAMES = [
  'Orders',
  'orders',
  'Order',
  'Settlement',
  'settlements',
] as const;

export const FLIPKART_PAYMENT_HEADER_ALIASES = [
  'order id',
  'order_id',
  'settlement value',
  'settlement amount',
  'net settlement',
  'neft id',
  'utr',
  'payment date',
  'settlement date',
] as const;

export type FlipkartPaymentFieldKey =
  | 'finalSettlementAmount'
  | 'transactionId'
  | 'paymentDate';

export type FlipkartPaymentFieldMapping = {
  target: FlipkartPaymentFieldKey;
  source: string[];
};

export const flipkartPaymentFieldMappings: FlipkartPaymentFieldMapping[] = [
  {
    target: 'finalSettlementAmount',
    source: [
      'Settlement Value',
      'Settlement Amount',
      'Net Settlement Amount',
      'Net Amount',
      'Net Payable Amount',
      'Settlement',
    ],
  },
  {
    target: 'transactionId',
    source: ['NEFT ID', 'NEFT_ID', 'UTR', 'Settlement UTR', 'Bank UTR'],
  },
  {
    target: 'paymentDate',
    source: ['Settlement Date', 'Payment Date', 'NEFT Date', 'Payout Date'],
  },
];

export const FLIPKART_PAYMENT_REQUIRED_HEADER_GROUPS = [
  ['Order ID', 'Order Id', 'order_id'],
] as const;
