/**
 * Order Report counts use one unit per marketplace order.
 * Multi-SKU / multi-line import_rows for the same orderID must not inflate totals.
 */
import type { PipelineStage } from 'mongoose';

export function distinctOrderReportKeyExpression() {
  return {
    $cond: [
      {
        $gt: [
          {
            $strLenCP: {
              $trim: { input: { $ifNull: ['$orderID', ''] } },
            },
          },
          0,
        ],
      },
      { $trim: { input: '$orderID' } },
      '$_id',
    ],
  } as const;
}

/** One Order Report unit per seller marketplace link + order (or row when order ID is missing). */
export function distinctOrderReportGroupIdExpression() {
  return {
    marketplace: '$marketplace',
    orderKey: distinctOrderReportKeyExpression(),
  } as const;
}

/** Pipeline stages: match → one doc per distinct order group → count. */
export function countDistinctOrderReportKeysStages(
  match: Record<string, unknown>,
): PipelineStage[] {
  return [
    { $match: match },
    {
      $group: {
        _id: distinctOrderReportGroupIdExpression(),
      },
    },
    { $count: 'count' },
  ];
}

/** Pipeline stages: match → one doc per (marketplace, order key) → count per marketplace. */
export function countDistinctOrderReportKeysByMarketplaceStages(
  match: Record<string, unknown>,
): PipelineStage[] {
  return [
    { $match: match },
    {
      $group: {
        _id: {
          marketplace: '$marketplace',
          orderKey: distinctOrderReportKeyExpression(),
        },
      },
    },
    {
      $group: {
        _id: '$_id.marketplace',
        totalCount: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        marketplaceId: '$_id',
        totalCount: 1,
      },
    },
    { $sort: { marketplaceId: 1 } },
  ];
}

/** Pipeline stages: match → one doc per (document type, marketplace, order key) → count per document type. */
export function countDistinctOrderReportKeysByDocumentTypeStages(
  match: Record<string, unknown>,
): PipelineStage[] {
  return [
    { $match: match },
    {
      $group: {
        _id: {
          documentType: { $ifNull: ['$documentType', 'Unknown'] },
          marketplace: '$marketplace',
          orderKey: distinctOrderReportKeyExpression(),
        },
      },
    },
    {
      $group: {
        _id: '$_id.documentType',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1, _id: 1 } },
  ];
}
