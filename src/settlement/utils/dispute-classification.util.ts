import type { PipelineStage } from 'mongoose';
import type { DisputeCategory } from '../dto/list-disputes.dto';

/** Days since invoice date for "due" vs "overdue". */
export const DISPUTE_DUE_WINDOW_DAYS = 30;
const TOLERANCE = 0.01;

/**
 * Classifies settlement order rows into dispute buckets.
 * - due: incomplete payment + invoice within 30 days
 * - overdue: incomplete payment + invoice older than 30 days
 * - payout_difference: incomplete payment (any age)
 * - over_charges: reserved (empty until logic is defined)
 */
export function disputeClassificationStages(
  asOf: Date = new Date(),
): PipelineStage[] {
  return [
    {
      $set: {
        invoiceDate: '$orderDate',
        amountDue: {
          $round: [
            {
              $max: [0, { $subtract: ['$receivable', '$received'] }],
            },
            2,
          ],
        },
        hasPayoutDifference: {
          $gt: [{ $subtract: ['$receivable', '$received'] }, TOLERANCE],
        },
        ageDays: {
          $cond: [
            { $ifNull: ['$orderDate', false] },
            {
              $floor: {
                $divide: [
                  { $subtract: [asOf, '$orderDate'] },
                  1000 * 60 * 60 * 24,
                ],
              },
            },
            null,
          ],
        },
      },
    },
    {
      $set: {
        disputeCategory: {
          $switch: {
            branches: [
              {
                case: { $eq: ['$hasPayoutDifference', false] },
                then: null,
              },
              {
                case: {
                  $and: [
                    { $ne: ['$ageDays', null] },
                    { $lte: ['$ageDays', DISPUTE_DUE_WINDOW_DAYS] },
                  ],
                },
                then: 'due',
              },
              {
                case: {
                  $and: [
                    { $ne: ['$ageDays', null] },
                    { $gt: ['$ageDays', DISPUTE_DUE_WINDOW_DAYS] },
                  ],
                },
                then: 'overdue',
              },
            ],
            // Incomplete payment but missing invoice date → treat as overdue risk
            default: 'overdue',
          },
        },
      },
    },
    {
      $set: {
        // All incomplete payments also belong to payout_difference.
        isPayoutDifference: '$hasPayoutDifference',
        isOverCharges: false,
      },
    },
  ];
}

export function buildDisputeCategoryMatch(
  category?: DisputeCategory | string,
): Record<string, unknown> | null {
  const value = String(category ?? 'all')
    .trim()
    .toLowerCase();
  if (!value || value === 'all') return null;
  if (value === 'due') return { disputeCategory: 'due' };
  if (value === 'overdue') return { disputeCategory: 'overdue' };
  if (value === 'payout_difference') {
    return { isPayoutDifference: true };
  }
  if (value === 'over_charges') {
    // Logic intentionally pending — never match rows yet.
    return { isOverCharges: true };
  }
  return null;
}

export function disputeProjectionStage(): PipelineStage {
  return {
    $project: {
      marketplace: 1,
      orderId: 1,
      invoiceDate: 1,
      orderDate: 1,
      ageDays: 1,
      disputeCategory: 1,
      isPayoutDifference: 1,
      currency: 1,
      grossSale: 1,
      returns: 1,
      netSale: 1,
      expenses: 1,
      receivable: 1,
      received: 1,
      amountDue: 1,
      difference: 1,
      status: 1,
      settlementId: 1,
      settlementDate: 1,
      transactionCount: 1,
    },
  };
}
