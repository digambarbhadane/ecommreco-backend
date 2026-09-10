import type { PipelineStage } from 'mongoose';
import type { ListSettlementsDto } from '../dto/list-settlements.dto';

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildSettlementMatch(
  query: Pick<
    ListSettlementsDto,
    | 'sellerId'
    | 'gstin'
    | 'marketplace'
    | 'settlementId'
    | 'settlementDate'
    | 'orderDate'
    | 'orderId'
    | 'search'
    | 'dateFrom'
    | 'dateTo'
  >,
): Record<string, unknown> {
  const match: Record<string, unknown> = {
    sellerId: query.sellerId.trim(),
    orderId: { $nin: ['', null] },
  };
  if (query.gstin) match.gstin = query.gstin.trim().toUpperCase();
  if (query.marketplace) {
    match.marketplace = query.marketplace.trim().toLowerCase();
  }
  if (query.settlementId) {
    match.settlementId = query.settlementId.trim();
  }
  if (query.orderId) match.orderId = query.orderId.trim();

  const search = String(query.search ?? '').trim();
  if (search) {
    const regex = { $regex: escapeRegex(search), $options: 'i' };
    match.$or = [
      { marketplace: regex },
      { settlementId: regex },
      { orderId: regex },
      { transactionCategory: regex },
      { transactionName: regex },
    ];
  }
  return match;
}

export function buildOrderDateMatch(
  query: Pick<
    ListSettlementsDto,
    'orderDate' | 'settlementDate' | 'dateFrom' | 'dateTo'
  >,
): Record<string, unknown> | null {
  const from = query.orderDate ?? query.settlementDate ?? query.dateFrom;
  const to = query.orderDate ?? query.settlementDate ?? query.dateTo;
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) {
      const start = new Date(from);
      if (!Number.isNaN(start.getTime())) range.$gte = start;
    }
    if (to) {
      const end = new Date(to);
      if (!Number.isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        range.$lte = end;
      }
    }
    if (Object.keys(range).length) return { orderDate: range };
  }
  return null;
}

export function settlementCalculationStages(): PipelineStage[] {
  return [
    {
      $group: {
        _id: {
          orderId: '$orderId',
          transactionCategory: '$transactionCategory',
        },
        marketplace: { $first: '$marketplace' },
        settlementIds: { $addToSet: '$settlementId' },
        settlementDate: { $max: '$settlementDate' },
        orderDate: {
          $max: {
            $cond: [
              { $eq: ['$calculationRole', 'sale'] },
              { $ifNull: ['$orderDate', '$settlementDate'] },
              null,
            ],
          },
        },
        fallbackOrderDate: {
          $max: { $ifNull: ['$orderDate', '$settlementDate'] },
        },
        currency: { $first: '$currency' },
        sellerSku: {
          $first: {
            $ifNull: [
              '$metadata.sellerSku',
              {
                $ifNull: [
                  '$metadata.skuId',
                  { $ifNull: ['$metadata.skuID', null] },
                ],
              },
            ],
          },
        },
        costPrice: {
          $sum: {
            $convert: {
              input: {
                $ifNull: [
                  '$metadata.costPrice',
                  { $ifNull: ['$metadata.cost', 0] },
                ],
              },
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
        },
        grossSale: {
          $sum: {
            $cond: [
              { $eq: ['$calculationRole', 'sale'] },
              { $abs: '$amount' },
              0,
            ],
          },
        },
        returns: {
          $sum: {
            $cond: [{ $eq: ['$calculationRole', 'return'] }, '$amount', 0],
          },
        },
        expenses: {
          $sum: {
            $cond: [
              { $eq: ['$calculationRole', 'expense'] },
              { $abs: '$amount' },
              0,
            ],
          },
        },
        adjustments: {
          $sum: {
            $cond: [{ $eq: ['$calculationRole', 'adjustment'] }, '$amount', 0],
          },
        },
        received: {
          $sum: {
            $cond: ['$contributesToReceived', '$amount', 0],
          },
        },
        disputed: { $max: { $cond: ['$disputed', 1, 0] } },
        transactionCount: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: '$_id.orderId',
        marketplace: { $first: '$marketplace' },
        settlementIdSets: { $push: '$settlementIds' },
        settlementDate: { $max: '$settlementDate' },
        orderDate: { $max: '$orderDate' },
        fallbackOrderDate: { $max: '$fallbackOrderDate' },
        currency: { $first: '$currency' },
        sellerSku: { $max: '$sellerSku' },
        costPrice: { $sum: '$costPrice' },
        grossSale: { $sum: '$grossSale' },
        returns: { $sum: '$returns' },
        expenses: { $sum: '$expenses' },
        adjustments: { $sum: '$adjustments' },
        received: { $sum: '$received' },
        disputed: { $max: '$disputed' },
        transactionCount: { $sum: '$transactionCount' },
        expenseBreakdown: {
          $push: {
            category: '$_id.transactionCategory',
            amount: '$expenses',
          },
        },
      },
    },
    {
      $set: {
        orderId: '$_id',
        orderDate: { $ifNull: ['$orderDate', '$fallbackOrderDate'] },
        invoiceDate: { $ifNull: ['$orderDate', '$fallbackOrderDate'] },
        settlementIds: {
          $reduce: {
            input: '$settlementIdSets',
            initialValue: [],
            in: { $setUnion: ['$$value', '$$this'] },
          },
        },
        netSale: { $subtract: ['$grossSale', '$returns'] },
        expenseBreakdown: {
          $filter: {
            input: '$expenseBreakdown',
            as: 'item',
            cond: { $ne: ['$$item.amount', 0] },
          },
        },
      },
    },
    {
      $set: {
        settlementId: { $arrayElemAt: ['$settlementIds', 0] },
        receivable: {
          $add: [{ $subtract: ['$netSale', '$expenses'] }, '$adjustments'],
        },
      },
    },
    {
      $set: {
        difference: { $subtract: ['$received', '$receivable'] },
      },
    },
    {
      $set: {
        status: {
          $switch: {
            branches: [
              { case: { $eq: ['$disputed', 1] }, then: 'disputed' },
              {
                // Net sale ≈ 0 and nothing received → fully offset / closed.
                case: {
                  $and: [
                    { $lte: [{ $abs: '$netSale' }, 0.01] },
                    { $eq: ['$received', 0] },
                  ],
                },
                then: 'matched',
              },
              {
                case: {
                  $and: [
                    { $eq: ['$received', 0] },
                    { $ne: ['$receivable', 0] },
                  ],
                },
                then: 'pending',
              },
              {
                case: { $lte: [{ $abs: '$difference' }, 0.01] },
                then: 'matched',
              },
              {
                case: { $lt: ['$difference', 0] },
                then: 'short_received',
              },
            ],
            default: 'excess_received',
          },
        },
      },
    },
    {
      $unset: ['_id', 'settlementIdSets', 'disputed', 'fallbackOrderDate'],
    },
  ];
}
