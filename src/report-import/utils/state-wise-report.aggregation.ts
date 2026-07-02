import { PipelineStage } from 'mongoose';

const isMeeshoReturnRow = { $eq: ['$meeshoIsGrossSale', false] };

const signedQty = {
  $cond: [
    isMeeshoReturnRow,
    {
      $multiply: [
        -1,
        { $ifNull: ['$returnQty', { $ifNull: ['$quantity', 0] }] },
      ],
    },
    { $ifNull: ['$quantity', 0] },
  ],
};

const signedAmount = (field: string) => ({
  $cond: [
    isMeeshoReturnRow,
    { $multiply: [-1, { $ifNull: [`$${field}`, 0] }] },
    { $ifNull: [`$${field}`, 0] },
  ],
});

const signedIgst = {
  $cond: [
    { $eq: ['$gstTransactionType', 'intra'] },
    0,
    signedAmount('igstAmount'),
  ],
};

const signedCgst = {
  $cond: [
    { $eq: ['$gstTransactionType', 'inter'] },
    0,
    signedAmount('cgstAmount'),
  ],
};

const signedSgst = {
  $cond: [
    { $eq: ['$gstTransactionType', 'inter'] },
    0,
    signedAmount('sgstAmount'),
  ],
};

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

export function buildStateWiseAggregationPipeline(
  match: Record<string, unknown>,
): PipelineStage[] {
  return [
    { $match: match },
    {
      $group: {
        _id: {
          stateName: {
            $trim: {
              input: { $ifNull: ['$stateName', 'Unknown'] },
            },
          },
          gstRate: {
            $cond: [
              { $gt: [{ $ifNull: ['$igstRate', 0] }, 0] },
              { $ifNull: ['$igstRate', 0] },
              {
                $add: [
                  { $ifNull: ['$cgstRate', 0] },
                  { $ifNull: ['$sgstRate', 0] },
                ],
              },
            ],
          },
        },
        qty: { $sum: signedQty },
        taxableValue: { $sum: signedAmount('taxableAmount') },
        igst: { $sum: signedIgst },
        cgst: { $sum: signedCgst },
        sgst: { $sum: signedSgst },
        invoiceAmount: { $sum: signedAmount('invoiceAmount') },
      },
    },
    {
      $match: {
        $or: [
          { qty: { $ne: 0 } },
          { taxableValue: { $ne: 0 } },
          { invoiceAmount: { $ne: 0 } },
        ],
      },
    },
    { $sort: { '_id.stateName': 1, '_id.gstRate': 1 } },
  ];
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
