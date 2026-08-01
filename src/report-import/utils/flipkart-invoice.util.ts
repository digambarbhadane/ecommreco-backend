/** Flipkart invoice = taxable + IGST + CGST + SGST (not read from file columns). */
export type FlipkartInvoiceParts = {
  taxableAmount?: number | null;
  taxableValue?: number | null;
  igstAmount?: number | null;
  igst?: number | null;
  cgstAmount?: number | null;
  cgst?: number | null;
  sgstAmount?: number | null;
  sgst?: number | null;
};

export function computeFlipkartInvoiceAmount(row: FlipkartInvoiceParts): number {
  return (
    Number(row.taxableAmount ?? row.taxableValue ?? 0) +
    Number(row.igstAmount ?? row.igst ?? 0) +
    Number(row.cgstAmount ?? row.cgst ?? 0) +
    Number(row.sgstAmount ?? row.sgst ?? 0)
  );
}

/** Credit notes add to gross sales; debit notes reduce returns (negative signed amount). */
export function flipkartNoteComponentSign(
  kind: 'credit' | 'debit',
  amount: number,
): number {
  if (kind === 'credit') {
    return Math.abs(amount);
  }
  return amount <= 0 ? amount : -Math.abs(amount);
}

/** Summary rows must always show invoice = taxable + IGST + CGST + SGST. */
export function syncFlipkartSummaryInvoice<
  T extends FlipkartInvoiceParts & { invoiceAmount?: number },
>(row: T): T & { invoiceAmount: number } {
  return {
    ...row,
    invoiceAmount: computeFlipkartInvoiceAmount(row),
  };
}

export function normalizeFlipkartNoteInvoiceAmount(
  kind: 'credit' | 'debit',
  row: FlipkartInvoiceParts,
): number {
  return flipkartNoteComponentSign(kind, computeFlipkartInvoiceAmount(row));
}

export function applyFlipkartInvoiceAmount<T extends FlipkartInvoiceParts>(
  row: T,
): T & { invoiceAmount: number } {
  return {
    ...row,
    invoiceAmount: computeFlipkartInvoiceAmount(row),
  };
}
