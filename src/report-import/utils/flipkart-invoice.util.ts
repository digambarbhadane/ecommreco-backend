/** Flipkart invoice = taxable + IGST + CGST + SGST (not read from file columns). */
export type FlipkartInvoiceParts = {
  taxableAmount?: number | null;
  igstAmount?: number | null;
  cgstAmount?: number | null;
  sgstAmount?: number | null;
};

export function computeFlipkartInvoiceAmount(row: FlipkartInvoiceParts): number {
  return (
    Number(row.taxableAmount ?? 0) +
    Number(row.igstAmount ?? 0) +
    Number(row.cgstAmount ?? 0) +
    Number(row.sgstAmount ?? 0)
  );
}

export function applyFlipkartInvoiceAmount<T extends FlipkartInvoiceParts>(
  row: T,
): T & { invoiceAmount: number } {
  return {
    ...row,
    invoiceAmount: computeFlipkartInvoiceAmount(row),
  };
}
