import type { PipelineStage } from 'mongoose';

const num = (field: string) => ({ $ifNull: [`$${field}`, 0] });

const docTypeUpper = { $toUpper: { $ifNull: ['$documentType', ''] } };
const voucherTypeUpper = { $toUpper: { $ifNull: ['$voucherType', ''] } };
const txnUpper = {
  $trim: {
    input: {
      $concat: [
        { $ifNull: ['$documentType', ''] },
        ' ',
        { $ifNull: ['$voucherType', ''] },
      ],
    },
  },
};

const isReturnLike = {
  $or: [
    { $regexMatch: { input: docTypeUpper, regex: 'RETURN' } },
    { $regexMatch: { input: docTypeUpper, regex: 'RTO' } },
    { $regexMatch: { input: docTypeUpper, regex: 'REFUND' } },
    { $regexMatch: { input: voucherTypeUpper, regex: 'RETURN' } },
    { $regexMatch: { input: voucherTypeUpper, regex: 'RTO' } },
    { $regexMatch: { input: voucherTypeUpper, regex: 'REFUND' } },
    { $regexMatch: { input: txnUpper, regex: '\\bREFUND' } },
    { $regexMatch: { input: txnUpper, regex: '\\bRTO\\b' } },
  ],
};

const isCancelledLike = {
  $or: [
    { $regexMatch: { input: docTypeUpper, regex: 'CANCEL' } },
    { $regexMatch: { input: voucherTypeUpper, regex: 'CANCEL' } },
    { $regexMatch: { input: txnUpper, regex: '\\bCANCEL' } },
  ],
};

const isSalesLike = {
  $and: [{ $not: isReturnLike }, { $not: isCancelledLike }],
};

export type PaymentNeftSummaryRow = {
  neftNo: string;
  bankSettlementTotal: number;
  salesCount: number;
  returnsCount: number;
};

export type PaymentNeftSummaryTotals = {
  bankSettlementTotal: number;
  salesCount: number;
  returnsCount: number;
};

export function buildPaymentSummaryByNeftPipeline(
  rowFilter: Record<string, unknown>,
): PipelineStage[] {
  const neftNoExpr = {
    $trim: { input: { $ifNull: ['$transactionId', ''] } },
  };

  return [
    { $match: rowFilter },
    {
      $match: {
        transactionId: { $exists: true, $nin: [null, ''] },
      },
    },
    {
      $group: {
        _id: neftNoExpr,
        bankSettlementTotal: { $sum: num('finalSettlementAmount') },
        salesCount: {
          $sum: { $cond: [isSalesLike, 1, 0] },
        },
        returnsCount: {
          $sum: { $cond: [isReturnLike, 1, 0] },
        },
      },
    },
    { $match: { _id: { $ne: '' } } },
    { $sort: { bankSettlementTotal: -1, _id: 1 } },
    {
      $project: {
        _id: 0,
        neftNo: '$_id',
        bankSettlementTotal: 1,
        salesCount: 1,
        returnsCount: 1,
      },
    },
  ];
}

export function summarizePaymentNeftRows(
  rows: PaymentNeftSummaryRow[],
): PaymentNeftSummaryTotals {
  return rows.reduce(
    (acc, row) => ({
      bankSettlementTotal:
        acc.bankSettlementTotal + Number(row.bankSettlementTotal ?? 0),
      salesCount: acc.salesCount + Number(row.salesCount ?? 0),
      returnsCount: acc.returnsCount + Number(row.returnsCount ?? 0),
    }),
    { bankSettlementTotal: 0, salesCount: 0, returnsCount: 0 },
  );
}
