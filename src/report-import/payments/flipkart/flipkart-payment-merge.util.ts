import type { FlipkartPaymentMappedRow } from './flipkart-payment.types';

/** Numeric money / qty fields that must be summed when Order ID + NEFT ID repeats. */
const SUM_FIELDS: Array<keyof FlipkartPaymentMappedRow> = [
  'bankSettlementValue',
  'inputGSTAndTCSCredits',
  'incomeTaxCredits',
  'saleAmount',
  'totalOfferAmount',
  'myShare',
  'customerAddonsAmount',
  'taxes',
  'offerAdjustments',
  'protectionFund',
  'refund',
  'commission',
  'fixedFee',
  'collectionFee',
  'pickAndPackFee',
  'shippingFee',
  'reverseShippingFee',
  'noCostEmiFeeReimbursement',
  'installationFee',
  'techVisitFee',
  'uninstallationAndPackagingFee',
  'customerAddonsAmountRecovery',
  'franchiseFee',
  'shopsyMarketingFee',
  'productCancellationFee',
  'tcs',
  'tds',
  'gstOnMarketplaceFees',
  'offerAmountSettledAsDiscountInMPFee',
  'discountInMarketplaceFee',
  'gstOnDiscount',
  'totalDiscountInMarketplaceFee',
  'offerAdjustment',
  'quantity',
  'saleAmountSummary',
  'totalOfferAmountSummary',
  'myShareSummary',
  'freeShippingOffer',
  'nonFreeShippingOffer',
  'shippingOfferTotal',
  'deadWeight',
  'volumetricWeight',
];

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function preferText(
  current: string | undefined,
  incoming: string | undefined,
): string | undefined {
  const next = String(incoming ?? '').trim();
  if (!next) return current;
  const prev = String(current ?? '').trim();
  return prev || next;
}

export function normalizeFlipkartPaymentNeftId(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '');
}

/** Merge key: same Order ID + same NEFT ID only. */
export function buildFlipkartPaymentMergeKey(
  orderId: string,
  neftId: unknown,
): string {
  return `${String(orderId).trim()}::${normalizeFlipkartPaymentNeftId(neftId)}`;
}

function mergeTextUnique(
  current: string | undefined,
  incoming: string | undefined,
): string | undefined {
  const parts = new Set(
    [current, incoming]
      .flatMap((value) => String(value ?? '').split(','))
      .map((part) => part.trim())
      .filter(Boolean),
  );
  if (!parts.size) return undefined;
  return [...parts].join(',');
}

/**
 * Merge two Flipkart payment rows that share the same Order ID **and** NEFT ID.
 * Amounts / quantity are summed; identity fields keep the first non-empty value.
 * Same Order ID with a different NEFT must stay as separate records (do not call this).
 */
export function mergeFlipkartPaymentRowsByOrderId(
  existing: FlipkartPaymentMappedRow,
  incoming: FlipkartPaymentMappedRow,
): FlipkartPaymentMappedRow {
  const merged: FlipkartPaymentMappedRow = { ...existing };

  for (const field of SUM_FIELDS) {
    const sum = toNumber(existing[field]) + toNumber(incoming[field]);
    (merged as Record<string, unknown>)[field] = sum;
  }

  merged.orderItemId = mergeTextUnique(
    existing.orderItemId,
    incoming.orderItemId,
  );
  merged.neftId = preferText(existing.neftId, incoming.neftId);
  merged.neftType = preferText(existing.neftType, incoming.neftType);
  merged.paymentDate = preferText(existing.paymentDate, incoming.paymentDate);
  merged.tier = preferText(existing.tier, incoming.tier);
  merged.sellerSku = preferText(existing.sellerSku, incoming.sellerSku);
  merged.invoiceId = preferText(existing.invoiceId, incoming.invoiceId);
  merged.invoiceDate = preferText(existing.invoiceDate, incoming.invoiceDate);
  merged.orderDate = preferText(existing.orderDate, incoming.orderDate);
  merged.dispatchDate = preferText(
    existing.dispatchDate,
    incoming.dispatchDate,
  );
  merged.fulfilmentType = preferText(
    existing.fulfilmentType,
    incoming.fulfilmentType,
  );
  merged.productSubCategory = preferText(
    existing.productSubCategory,
    incoming.productSubCategory,
  );
  merged.returnType = preferText(existing.returnType, incoming.returnType);
  merged.shopsyOrder = preferText(existing.shopsyOrder, incoming.shopsyOrder);
  merged.itemReturnStatus = preferText(
    existing.itemReturnStatus,
    incoming.itemReturnStatus,
  );
  merged.shippingZone = preferText(
    existing.shippingZone,
    incoming.shippingZone,
  );
  merged.additionalInformation = preferText(
    existing.additionalInformation,
    incoming.additionalInformation,
  );

  if (existing.commissionRate == null && incoming.commissionRate != null) {
    merged.commissionRate = incoming.commissionRate;
  }
  if (existing.itemGstRate == null && incoming.itemGstRate != null) {
    merged.itemGstRate = incoming.itemGstRate;
  }

  return merged;
}
