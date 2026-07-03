/**
 * Net sales rows for state-wise GST:
 * - Non-Meesho: SALE documents only (returns excluded).
 * - Meesho: gross sales (meeshoIsGrossSale true) minus TCS return rows (false).
 */
export function buildStateWiseSalesMatch(
  filter: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...filter,
    $or: [
      {
        meeshoIsGrossSale: { $exists: false },
        documentType: { $not: /^RETURN$/i },
      },
      { meeshoIsGrossSale: true },
      { meeshoIsGrossSale: false },
    ],
  };
}

export type StateWiseAggregatedRow = {
  stateName: string;
  gstRate: number;
  qty: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  invoiceAmount: number;
};

export function mapAggregationResults(
  rows: Array<{
    _id?: { stateName?: string; gstRate?: number };
    qty?: number;
    taxableValue?: number;
    igst?: number;
    cgst?: number;
    sgst?: number;
    invoiceAmount?: number;
  }>,
): StateWiseAggregatedRow[] {
  return rows.map((row) => ({
    stateName: String(row._id?.stateName ?? 'Unknown'),
    gstRate: Number(row._id?.gstRate ?? 0),
    qty: Number(row.qty ?? 0),
    taxableValue: Number(row.taxableValue ?? 0),
    igst: Number(row.igst ?? 0),
    cgst: Number(row.cgst ?? 0),
    sgst: Number(row.sgst ?? 0),
    invoiceAmount: Number(row.invoiceAmount ?? 0),
  }));
}
