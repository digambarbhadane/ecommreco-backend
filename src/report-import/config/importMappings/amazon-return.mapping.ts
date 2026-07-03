/** Amazon return report — order-level return type details. */
export const AMAZON_RETURN_SHEET_NAMES = [
  'Return Report',
  'Returns',
  'Return',
  'return report',
  'returns',
] as const;

export const AMAZON_RETURN_HEADER_ALIASES = [
  'order id',
  'order_id',
  'return type',
  'type of return',
] as const;

export type AmazonReturnFieldKey = 'typeOfReturn';

export type AmazonReturnFieldMapping = {
  target: AmazonReturnFieldKey;
  source: string[];
};

export const amazonReturnFieldMappings: AmazonReturnFieldMapping[] = [
  {
    target: 'typeOfReturn',
    source: ['Return Type', 'Type of Return', 'Return_Type', 'type_of_return'],
  },
];

export const AMAZON_RETURN_REQUIRED_HEADER_GROUPS = [
  ['Return Type', 'Type of Return', 'Return_Type', 'type_of_return'],
] as const;

export const AMAZON_RETURN_ORDER_ID_HEADER_GROUPS = [
  ['Order Id', 'Order ID', 'order_id', 'Order Number'],
] as const;
