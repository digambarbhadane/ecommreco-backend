/**
 * Order Report display enrichment for Myntra return rows.
 *
 * GSTR RTO / RT rows often lack invoiceNo and skuID. At import time those are
 * copied from the matched SALE when matching succeeds. For UNMATCHED (or
 * historically unmatched) returns where a SALE with the same Order ID later
 * exists, fill only missing Invoice No / SKU from that SALE for API display.
 * Does not mutate stored import rows or change financial fields.
 */

export const MYNTRA_ORDER_REPORT_RETURN_TYPES = new Set([
  'RTO Return',
  'Customer Return',
]);

export type MyntraSaleDisplayFields = {
  _id?: string;
  orderID?: string;
  invoiceNo?: string;
  skuID?: string;
  sellerId?: string;
  gstin?: string;
  marketplace?: string;
  reportMonth?: string;
};

export type MyntraReturnDisplayRow = {
  documentType?: string;
  orderID?: string;
  invoiceNo?: string;
  skuID?: string;
  sellerId?: string;
  gstin?: string;
  marketplace?: string;
  linkedSaleRowId?: string;
  myntraTransactionType?: string;
  myntraReturnMatchStatus?: string;
  [key: string]: unknown;
};

export function isMyntraOrderReportReturnRow(
  row: Pick<
    MyntraReturnDisplayRow,
    'documentType' | 'myntraTransactionType' | 'myntraReturnMatchStatus'
  >,
): boolean {
  const docType = String(row.documentType ?? '').trim();
  if (!MYNTRA_ORDER_REPORT_RETURN_TYPES.has(docType)) return false;
  const tx = String(row.myntraTransactionType ?? '').trim().toUpperCase();
  if (tx === 'RETURN') return true;
  // Legacy Myntra returns always carry a match-status marker from import.
  return Boolean(String(row.myntraReturnMatchStatus ?? '').trim());
}

export function myntraReturnNeedsSaleDisplayEnrichment(
  row: MyntraReturnDisplayRow,
): boolean {
  if (!isMyntraOrderReportReturnRow(row)) return false;
  const invoiceNo = String(row.invoiceNo ?? '').trim();
  const skuID = String(row.skuID ?? '').trim();
  return !invoiceNo || !skuID;
}

export function buildMyntraSaleOrderLookupKey(parts: {
  sellerId?: string;
  gstin?: string;
  marketplace?: string;
  orderID?: string;
}): string {
  return [
    String(parts.sellerId ?? '').trim(),
    String(parts.gstin ?? '').trim().toUpperCase(),
    String(parts.marketplace ?? '').trim(),
    String(parts.orderID ?? '').trim(),
  ].join('|');
}

/** Prefer the SALE that carries both display fields, then newer reportMonth. */
export function pickPreferredMyntraSaleDisplay(
  sales: MyntraSaleDisplayFields[],
): MyntraSaleDisplayFields | undefined {
  if (!sales.length) return undefined;
  const scored = [...sales].sort((a, b) => {
    const aScore =
      (String(a.invoiceNo ?? '').trim() ? 2 : 0) +
      (String(a.skuID ?? '').trim() ? 1 : 0);
    const bScore =
      (String(b.invoiceNo ?? '').trim() ? 2 : 0) +
      (String(b.skuID ?? '').trim() ? 1 : 0);
    if (bScore !== aScore) return bScore - aScore;
    return String(b.reportMonth ?? '').localeCompare(String(a.reportMonth ?? ''));
  });
  return scored[0];
}

/**
 * Copy SALE invoiceNo / skuID onto a return row only where the return is blank.
 * Leaves Order ID, Type, dates, amounts, and tax fields untouched.
 */
export function applyMyntraSaleDisplayFieldsToReturn<
  T extends MyntraReturnDisplayRow,
>(row: T, sale: MyntraSaleDisplayFields | undefined): T {
  if (!sale) return row;
  const next = { ...row };
  if (!String(next.invoiceNo ?? '').trim()) {
    const invoiceNo = String(sale.invoiceNo ?? '').trim();
    if (invoiceNo) next.invoiceNo = invoiceNo;
  }
  if (!String(next.skuID ?? '').trim()) {
    const skuID = String(sale.skuID ?? '').trim();
    if (skuID) next.skuID = skuID;
  }
  return next;
}

export function enrichMyntraReturnRowsFromSaleMaps<
  T extends MyntraReturnDisplayRow,
>(
  rows: T[],
  salesById: Map<string, MyntraSaleDisplayFields>,
  salesByOrderKey: Map<string, MyntraSaleDisplayFields>,
): T[] {
  return rows.map((row) => {
    if (!myntraReturnNeedsSaleDisplayEnrichment(row)) return row;

    let sale: MyntraSaleDisplayFields | undefined;
    const linkedId = String(row.linkedSaleRowId ?? '').trim();
    if (linkedId) sale = salesById.get(linkedId);

    if (!sale) {
      const orderID = String(row.orderID ?? '').trim();
      if (orderID) {
        sale = salesByOrderKey.get(
          buildMyntraSaleOrderLookupKey({
            sellerId: String(row.sellerId ?? ''),
            gstin: String(row.gstin ?? ''),
            marketplace: String(row.marketplace ?? ''),
            orderID,
          }),
        );
      }
    }

    return applyMyntraSaleDisplayFieldsToReturn(row, sale);
  });
}
