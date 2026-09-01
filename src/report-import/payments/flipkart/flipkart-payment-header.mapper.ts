import type {
  FlipkartPaymentFieldType,
  FlipkartPaymentMappedRow,
} from './flipkart-payment.types';
import {
  buildNormalizedHeaderLookup,
  normalizePaymentHeader,
} from '../core/payment-header-normalizer.util';
import {
  coercePaymentDate,
  coercePaymentInteger,
  coercePaymentNumber,
  coercePaymentString,
} from '../core/payment-row-coercion.util';

export type FlipkartPaymentHeaderEntry = {
  excelLabel: string;
  field: keyof FlipkartPaymentMappedRow;
  type: FlipkartPaymentFieldType;
};

/** Flipkart payment Excel column → schema field mappings. */
export const FLIPKART_PAYMENT_HEADER_ENTRIES: FlipkartPaymentHeaderEntry[] = [
  { excelLabel: 'NEFT ID', field: 'neftId', type: 'string' },
  { excelLabel: 'Neft Type', field: 'neftType', type: 'string' },
  { excelLabel: 'Payment Date', field: 'paymentDate', type: 'date' },
  {
    excelLabel: 'Bank Settlement Value (Rs.) = SUM(J:R)',
    field: 'bankSettlementValue',
    type: 'number',
  },
  {
    excelLabel: 'Input GST + TCS Credits (Rs.) [GST+TCS]',
    field: 'inputGSTAndTCSCredits',
    type: 'number',
  },
  {
    excelLabel: 'Income Tax Credits (Rs.) [TDS]',
    field: 'incomeTaxCredits',
    type: 'number',
  },
  { excelLabel: 'Order ID', field: 'orderId', type: 'string' },
  { excelLabel: 'Order item ID', field: 'orderItemId', type: 'string' },
  { excelLabel: 'Sale Amount (Rs.)', field: 'saleAmount', type: 'number' },
  {
    excelLabel: 'Total Offer Amount (Rs.)',
    field: 'totalOfferAmount',
    type: 'number',
  },
  { excelLabel: 'My share (Rs.)', field: 'myShare', type: 'number' },
  {
    excelLabel: 'Customer Add-ons Amount (Rs.)',
    field: 'customerAddonsAmount',
    type: 'number',
  },
  { excelLabel: 'Taxes (Rs.)', field: 'taxes', type: 'number' },
  {
    excelLabel: 'Offer Adjustments (Rs.)',
    field: 'offerAdjustments',
    type: 'number',
  },
  {
    excelLabel: 'Protection Fund (Rs.)',
    field: 'protectionFund',
    type: 'number',
  },
  { excelLabel: 'Refund (Rs.)', field: 'refund', type: 'number' },
  { excelLabel: 'Tier', field: 'tier', type: 'string' },
  {
    excelLabel: 'Commission Rate (%)',
    field: 'commissionRate',
    type: 'number',
  },
  { excelLabel: 'Commission (Rs.)', field: 'commission', type: 'number' },
  { excelLabel: 'Fixed Fee (Rs.)', field: 'fixedFee', type: 'number' },
  {
    excelLabel: 'Collection Fee (Rs.)',
    field: 'collectionFee',
    type: 'number',
  },
  {
    excelLabel: 'Pick And Pack Fee (Rs.)',
    field: 'pickAndPackFee',
    type: 'number',
  },
  { excelLabel: 'Shipping Fee (Rs.)', field: 'shippingFee', type: 'number' },
  {
    excelLabel: 'Reverse Shipping Fee (Rs.)',
    field: 'reverseShippingFee',
    type: 'number',
  },
  {
    excelLabel: 'No Cost Emi Fee Reimbursement(Rs.)',
    field: 'noCostEmiFeeReimbursement',
    type: 'number',
  },
  {
    excelLabel: 'Installation Fee (Rs.)',
    field: 'installationFee',
    type: 'number',
  },
  { excelLabel: 'Tech Visit Fee (Rs.)', field: 'techVisitFee', type: 'number' },
  {
    excelLabel: 'Uninstallation & Packaging Fee (Rs.)',
    field: 'uninstallationAndPackagingFee',
    type: 'number',
  },
  {
    excelLabel: 'Customer Add-ons Amount Recovery (Rs.)',
    field: 'customerAddonsAmountRecovery',
    type: 'number',
  },
  { excelLabel: 'Franchise Fee (Rs.)', field: 'franchiseFee', type: 'number' },
  {
    excelLabel: 'Shopsy Marketing Fee (Rs.)',
    field: 'shopsyMarketingFee',
    type: 'number',
  },
  {
    excelLabel: 'Product Cancellation Fee (Rs.)',
    field: 'productCancellationFee',
    type: 'number',
  },
  { excelLabel: 'TCS (Rs.)', field: 'tcs', type: 'number' },
  { excelLabel: 'TDS (Rs.)', field: 'tds', type: 'number' },
  {
    excelLabel: 'GST on MP Fees (Rs.)',
    field: 'gstOnMarketplaceFees',
    type: 'number',
  },
  {
    excelLabel: 'Offer amount settled as Discount in MP Fee (Rs.)',
    field: 'offerAmountSettledAsDiscountInMPFee',
    type: 'number',
  },
  { excelLabel: 'Item GST Rate (%)', field: 'itemGstRate', type: 'number' },
  {
    excelLabel: 'Discount in MP fees (Rs.)',
    field: 'discountInMarketplaceFee',
    type: 'number',
  },
  {
    excelLabel: 'GST on Discount (Rs.)',
    field: 'gstOnDiscount',
    type: 'number',
  },
  {
    excelLabel: 'Total Discount in MP Fee (Rs.)',
    field: 'totalDiscountInMarketplaceFee',
    type: 'number',
  },
  {
    excelLabel: 'Offer Adjustment (Rs.)',
    field: 'offerAdjustment',
    type: 'number',
  },
  { excelLabel: 'Dead Weight (kgs)', field: 'deadWeight', type: 'number' },
  {
    excelLabel: 'Length*Breadth*Height',
    field: 'lengthBreadthHeight',
    type: 'string',
  },
  {
    excelLabel: 'Volumetric Weight (kgs)',
    field: 'volumetricWeight',
    type: 'number',
  },
  {
    excelLabel: 'Chargeable Weight Source',
    field: 'chargeableWeightSource',
    type: 'string',
  },
  {
    excelLabel: 'Chargeable Weight Type',
    field: 'chargeableWeightType',
    type: 'string',
  },
  {
    excelLabel: 'Chargeable Wt. Slab (In Kgs)',
    field: 'chargeableWeightSlab',
    type: 'string',
  },
  { excelLabel: 'Shipping Zone', field: 'shippingZone', type: 'string' },
  { excelLabel: 'Order Date', field: 'orderDate', type: 'date' },
  { excelLabel: 'Dispatch Date', field: 'dispatchDate', type: 'date' },
  { excelLabel: 'Fulfilment Type', field: 'fulfilmentType', type: 'string' },
  { excelLabel: 'Seller SKU', field: 'sellerSku', type: 'string' },
  { excelLabel: 'Quantity', field: 'quantity', type: 'integer' },
  {
    excelLabel: 'Product Sub Category',
    field: 'productSubCategory',
    type: 'string',
  },
  {
    excelLabel: 'Additional Information',
    field: 'additionalInformation',
    type: 'string',
  },
  { excelLabel: 'Return Type', field: 'returnType', type: 'string' },
  { excelLabel: 'Shopsy Order', field: 'shopsyOrder', type: 'string' },
  {
    excelLabel: 'Item Return Status',
    field: 'itemReturnStatus',
    type: 'string',
  },
  { excelLabel: 'Invoice ID', field: 'invoiceId', type: 'string' },
  { excelLabel: 'Invoice Date', field: 'invoiceDate', type: 'date' },
  { excelLabel: 'Sale Amount', field: 'saleAmountSummary', type: 'number' },
  {
    excelLabel: 'Total Offer Amount',
    field: 'totalOfferAmountSummary',
    type: 'number',
  },
  { excelLabel: 'My Share', field: 'myShareSummary', type: 'number' },
  {
    excelLabel: 'Free Shipping Offer (Rs.)',
    field: 'freeShippingOffer',
    type: 'number',
  },
  {
    excelLabel: 'Non-Free Shipping Offer (Rs.)',
    field: 'nonFreeShippingOffer',
    type: 'number',
  },
  { excelLabel: 'Total (Rs.)', field: 'shippingOfferTotal', type: 'number' },
];

const HEADER_LOOKUP = buildNormalizedHeaderLookup(
  FLIPKART_PAYMENT_HEADER_ENTRIES,
);

const FIELD_TYPES = new Map(
  FLIPKART_PAYMENT_HEADER_ENTRIES.map((entry) => [entry.field, entry.type]),
);

function resolveFlipkartPaymentField(
  header: string,
): keyof FlipkartPaymentMappedRow | undefined {
  const normalized = normalizePaymentHeader(header);
  const exact = HEADER_LOOKUP.get(normalized) as
    | keyof FlipkartPaymentMappedRow
    | undefined;
  if (exact) return exact;
  return undefined;
}

function coerceFieldValue(
  field: keyof FlipkartPaymentMappedRow,
  value: unknown,
): string | number | undefined {
  const type = FIELD_TYPES.get(field);
  switch (type) {
    case 'number':
      return coercePaymentNumber(value);
    case 'integer':
      return coercePaymentInteger(value);
    case 'date':
      return coercePaymentDate(value);
    default:
      return coercePaymentString(value);
  }
}

export function mapFlipkartPaymentRawRow(
  rawRow: Record<string, unknown>,
): Partial<FlipkartPaymentMappedRow> {
  const mapped: Partial<FlipkartPaymentMappedRow> = {};

  for (const [header, value] of Object.entries(rawRow)) {
    if (header.startsWith('__')) continue;
    const field = resolveFlipkartPaymentField(header);
    if (!field || value === undefined || value === null || value === '')
      continue;
    const coerced = coerceFieldValue(field, value);
    if (coerced !== undefined) {
      (mapped as Record<string, unknown>)[field] = coerced;
    }
  }

  return mapped;
}

export function headersIncludeRequiredFlipkartPaymentColumns(
  headers: string[],
): boolean {
  const normalized = new Set(headers.map((h) => normalizePaymentHeader(h)));
  return FLIPKART_PAYMENT_HEADER_ENTRIES.filter((entry) =>
    (['orderId', 'paymentDate', 'sellerSku', 'quantity'] as const).includes(
      entry.field as 'orderId' | 'paymentDate' | 'sellerSku' | 'quantity',
    ),
  ).every((entry) => normalized.has(normalizePaymentHeader(entry.excelLabel)));
}
