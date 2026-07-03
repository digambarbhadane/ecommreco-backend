export type AmazonTransactionCategory =
  | 'sale'
  | 'shipment'
  | 'refund'
  | 'return'
  | 'cancellation'
  | 'other';

/** Classify Amazon MTR Transaction Type for import summary buckets. */
export function classifyAmazonTransactionType(
  documentType: string,
  voucherType?: string,
): AmazonTransactionCategory {
  const raw = `${documentType ?? ''} ${voucherType ?? ''}`.trim().toUpperCase();
  if (!raw) return 'other';
  if (/\bCANCEL/.test(raw)) return 'cancellation';
  if (/\bREFUND/.test(raw)) return 'refund';
  if (/\bRETURN\b/.test(raw) || /\bRTO\b/.test(raw)) return 'return';
  if (/\bSHIPMENT\b/.test(raw)) return 'shipment';
  if (/\bSALE\b/.test(raw) || /\bDELIVER/.test(raw)) return 'sale';
  return 'other';
}

export function isAmazonReturnCategory(
  category: AmazonTransactionCategory,
): boolean {
  return (
    category === 'refund' ||
    category === 'return' ||
    category === 'cancellation'
  );
}

export function isAmazonSaleCategory(category: AmazonTransactionCategory): boolean {
  return category === 'sale' || category === 'shipment' || category === 'other';
}
