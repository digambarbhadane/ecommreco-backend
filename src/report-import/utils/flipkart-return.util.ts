import type { ParsedSheetRow } from '../services/mapping.service';

export type FlipkartReturnDetails = {
  typeOfReturn?: string;
  returnReason?: string;
  detailedReturnReason?: string;
};

export function normalizeFlipkartOrderId(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function flipkartOrderIdLookupKey(value: unknown): string {
  return normalizeFlipkartOrderId(value).toLowerCase();
}

/** True only for voucher type "Return" (trim + case-insensitive exact match). */
export function isFlipkartReturnVoucherType(
  voucherType?: string | null,
): boolean {
  return (
    String(voucherType ?? '')
      .trim()
      .toLowerCase() === 'return'
  );
}

export function buildFlipkartReturnDetailsByOrderId(
  rows: ParsedSheetRow[],
  mapRow: (row: ParsedSheetRow) => FlipkartReturnDetails,
  getOrderId: (row: ParsedSheetRow) => string,
): Map<string, FlipkartReturnDetails> {
  const index = new Map<string, FlipkartReturnDetails>();
  for (const row of rows) {
    const orderId = getOrderId(row);
    if (!orderId) continue;
    const key = flipkartOrderIdLookupKey(orderId);
    index.set(key, mapRow(row));
  }
  return index;
}

export function lookupFlipkartReturnDetails(
  returnByOrder: Map<string, FlipkartReturnDetails>,
  orderId: unknown,
): FlipkartReturnDetails | undefined {
  const key = flipkartOrderIdLookupKey(orderId);
  if (!key) return undefined;
  return returnByOrder.get(key);
}

export function applyFlipkartReturnDetailsToRow<
  T extends FlipkartReturnDetails,
>(row: T, details?: FlipkartReturnDetails | null): T {
  if (!details) return row;
  return {
    ...row,
    ...(details.typeOfReturn ? { typeOfReturn: details.typeOfReturn } : {}),
    ...(details.returnReason ? { returnReason: details.returnReason } : {}),
    ...(details.detailedReturnReason
      ? { detailedReturnReason: details.detailedReturnReason }
      : {}),
  };
}
