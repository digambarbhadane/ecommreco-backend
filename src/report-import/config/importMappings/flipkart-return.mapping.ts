/** Flipkart return report — order-level return reason details. */
export const FLIPKART_RETURN_SHEET_NAMES = [
  'Return Report',
  'Returns',
  'Return',
  'return report',
  'returns',
] as const;

export const FLIPKART_RETURN_HEADER_ALIASES = [
  'order id',
  'order_id',
  'return type',
  'type of return',
  'return reason',
  'return sub reason',
  'return sub-reason',
  'sub reason',
] as const;

export type FlipkartReturnFieldKey =
  | 'typeOfReturn'
  | 'returnReason'
  | 'detailedReturnReason';

export type FlipkartReturnFieldMapping = {
  target: FlipkartReturnFieldKey;
  source: string[];
};

export const flipkartReturnFieldMappings: FlipkartReturnFieldMapping[] = [
  {
    target: 'typeOfReturn',
    source: ['Return Type', 'Type of Return', 'Return_Type', 'type_of_return'],
  },
  {
    target: 'returnReason',
    source: ['Return Reason', 'Return_Reason', 'return_reason'],
  },
  {
    target: 'detailedReturnReason',
    source: [
      'Return Sub-reason',
      'Return Sub Reason',
      'Return Sub-Reason',
      'Return SubReason',
      'Sub Reason',
      'Sub-Reason',
      'Return Sub_reason',
    ],
  },
];

export const FLIPKART_RETURN_REQUIRED_HEADER_GROUPS = [
  ['Order ID', 'Order Id', 'order_id'],
] as const;
