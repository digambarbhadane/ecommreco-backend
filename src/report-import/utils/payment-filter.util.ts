/** Query-style match for find() / aggregate $match stages. */
export const HAS_PAYMENT_DATA_OR = [
  { finalSettlementAmount: { $exists: true, $ne: null } },
  { paymentDate: { $exists: true, $nin: [null, ''] } },
  { transactionId: { $exists: true, $nin: [null, ''] } },
  { paymentMode: { $exists: true, $nin: [null, ''] } },
] as const;

export const HAS_PAYMENT_DATA_MATCH = {
  $or: [...HAS_PAYMENT_DATA_OR],
} as const;

const nonEmptyString = (field: string) => ({
  $gt: [
    {
      $strLenCP: {
        $trim: { input: { $ifNull: [field, ''] } },
      },
    },
    0,
  ],
});

/** Aggregation expression for $cond (not valid inside $match). */
export const HAS_PAYMENT_DATA_EXPR = {
  $or: [
    { $ne: [{ $ifNull: ['$finalSettlementAmount', null] }, null] },
    nonEmptyString('$paymentDate'),
    nonEmptyString('$transactionId'),
    nonEmptyString('$paymentMode'),
  ],
};

export type PaymentFilterQuery = {
  hasPaymentData?: 'yes' | 'no';
  paymentDateFrom?: string;
  paymentDateTo?: string;
  paymentMode?: string;
};

export function applyPaymentFiltersToMongoFilter(
  filter: Record<string, unknown>,
  query: PaymentFilterQuery,
): void {
  if (query.hasPaymentData === 'yes') {
    appendAndClause(filter, HAS_PAYMENT_DATA_MATCH);
  } else if (query.hasPaymentData === 'no') {
    appendAndClause(filter, { $nor: HAS_PAYMENT_DATA_MATCH.$or });
  }

  const paymentMode = String(query.paymentMode ?? '').trim();
  if (paymentMode) {
    const escaped = paymentMode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.paymentMode = { $regex: escaped, $options: 'i' };
  }

  if (query.paymentDateFrom || query.paymentDateTo) {
    filter.paymentDate = {};
    if (query.paymentDateFrom) {
      (filter.paymentDate as Record<string, unknown>).$gte =
        query.paymentDateFrom;
    }
    if (query.paymentDateTo) {
      (filter.paymentDate as Record<string, unknown>).$lte = query.paymentDateTo;
    }
  }
}

function appendAndClause(
  filter: Record<string, unknown>,
  clause: Record<string, unknown>,
): void {
  if (Array.isArray(filter.$and)) {
    filter.$and.push(clause);
    return;
  }
  filter.$and = [clause];
}
