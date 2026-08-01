import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { PipelineStage } from 'mongoose';
import { Model } from 'mongoose';
import type { ListDisputesDto } from './dto/list-disputes.dto';
import type { ListSettlementsDto } from './dto/list-settlements.dto';
import {
  NormalizedTransaction,
  NormalizedTransactionDocument,
} from './schemas/normalized-transaction.schema';
import {
  buildDisputeCategoryMatch,
  disputeClassificationStages,
  disputeProjectionStage,
} from './utils/dispute-classification.util';
import {
  buildOrderDateMatch,
  buildSettlementMatch,
  settlementCalculationStages,
} from './utils/settlement-aggregation.util';
import { chunkArray } from '../common/utils/mongo-batch.util';
import { repairLegacyCorruptedDate } from '../common/utils/repair-legacy-date.util';

function repairRowDates<T extends { orderDate?: Date | string | null; invoiceDate?: Date | string | null; settlementDate?: Date | string | null }>(
  row: T,
): T {
  const next = { ...row };
  if (next.orderDate) {
    const repaired = repairLegacyCorruptedDate(next.orderDate);
    if (repaired) next.orderDate = repaired as T['orderDate'];
  }
  if (next.invoiceDate) {
    const repaired = repairLegacyCorruptedDate(next.invoiceDate);
    if (repaired) next.invoiceDate = repaired as T['invoiceDate'];
  }
  if (next.settlementDate) {
    const repaired = repairLegacyCorruptedDate(next.settlementDate);
    if (repaired) next.settlementDate = repaired as T['settlementDate'];
  }
  return next;
}

@Injectable()
export class SettlementRepository {
  constructor(
    @InjectModel(NormalizedTransaction.name)
    private readonly model: Model<NormalizedTransactionDocument>,
  ) {}

  private toSettlementQuery(
    query: ListDisputesDto | ListSettlementsDto,
  ): ListSettlementsDto {
    return {
      sellerId: query.sellerId,
      gstin: query.gstin,
      marketplace: query.marketplace,
      orderId: query.orderId,
      search: query.search,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    } as ListSettlementsDto;
  }

  async list(query: ListSettlementsDto, sellerAliases = [query.sellerId]) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 25)));
    const sortFields = new Set([
      'marketplace',
      'settlementId',
      'settlementDate',
      'orderDate',
      'orderId',
      'grossSale',
      'returns',
      'netSale',
      'expenses',
      'receivable',
      'received',
      'difference',
      'status',
    ]);
    const sortBy = sortFields.has(String(query.sortBy))
      ? String(query.sortBy)
      : 'orderDate';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const pipeline: PipelineStage[] = [
      {
        $match: {
          ...buildSettlementMatch(query),
          sellerId: { $in: sellerAliases },
        },
      },
      ...settlementCalculationStages(),
      ...(buildOrderDateMatch(query)
        ? [{ $match: buildOrderDateMatch(query)! }]
        : []),
      ...(query.status ? [{ $match: { status: query.status } }] : []),
      {
        $facet: {
          data: [
            { $sort: { [sortBy]: sortOrder, orderId: 1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
          ],
          meta: [{ $count: 'total' }],
        },
      },
    ];
    const [result] = await this.model
      .aggregate(pipeline)
      .allowDiskUse(true)
      .exec();
    return {
      data: (result?.data ?? []).map((row: Record<string, unknown>) =>
        repairRowDates(row),
      ),
      total: Number(result?.meta?.[0]?.total ?? 0),
      page,
      limit,
    };
  }

  async listDisputes(query: ListDisputesDto, sellerAliases = [query.sellerId]) {
    const settlementQuery = this.toSettlementQuery(query);
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 25)));
    const sortFields = new Set([
      'marketplace',
      'invoiceDate',
      'orderDate',
      'orderId',
      'receivable',
      'received',
      'amountDue',
      'difference',
      'ageDays',
      'disputeCategory',
      'status',
    ]);
    const sortBy = sortFields.has(String(query.sortBy))
      ? String(query.sortBy)
      : 'invoiceDate';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const categoryMatch = buildDisputeCategoryMatch(query.category);

    if (String(query.category ?? '').toLowerCase() === 'over_charges') {
      return { data: [], total: 0, page, limit };
    }

    const pipeline: PipelineStage[] = [
      {
        $match: {
          ...buildSettlementMatch(settlementQuery),
          sellerId: { $in: sellerAliases },
        },
      },
      ...settlementCalculationStages(),
      ...(buildOrderDateMatch(settlementQuery)
        ? [{ $match: buildOrderDateMatch(settlementQuery)! }]
        : []),
      ...disputeClassificationStages(),
      {
        $match:
          categoryMatch ??
          ({ isPayoutDifference: true } as Record<string, unknown>),
      },
      disputeProjectionStage(),
      {
        $facet: {
          data: [
            { $sort: { [sortBy]: sortOrder, orderId: 1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
          ],
          meta: [{ $count: 'total' }],
        },
      },
    ];
    const [result] = await this.model
      .aggregate(pipeline)
      .allowDiskUse(true)
      .exec();
    return {
      data: (result?.data ?? []).map((row: Record<string, unknown>) =>
        repairRowDates(row),
      ),
      total: Number(result?.meta?.[0]?.total ?? 0),
      page,
      limit,
    };
  }

  async disputeSummary(
    query: ListDisputesDto,
    sellerAliases = [query.sellerId],
  ) {
    const settlementQuery = this.toSettlementQuery(query);
    const pipeline: PipelineStage[] = [
      {
        $match: {
          ...buildSettlementMatch(settlementQuery),
          sellerId: { $in: sellerAliases },
        },
      },
      ...settlementCalculationStages(),
      ...(buildOrderDateMatch(settlementQuery)
        ? [{ $match: buildOrderDateMatch(settlementQuery)! }]
        : []),
      ...disputeClassificationStages(),
      {
        $group: {
          _id: null,
          dueCount: {
            $sum: {
              $cond: [{ $eq: ['$disputeCategory', 'due'] }, 1, 0],
            },
          },
          dueAmount: {
            $sum: {
              $cond: [{ $eq: ['$disputeCategory', 'due'] }, '$amountDue', 0],
            },
          },
          overdueCount: {
            $sum: {
              $cond: [{ $eq: ['$disputeCategory', 'overdue'] }, 1, 0],
            },
          },
          overdueAmount: {
            $sum: {
              $cond: [
                { $eq: ['$disputeCategory', 'overdue'] },
                '$amountDue',
                0,
              ],
            },
          },
          payoutDifferenceCount: {
            $sum: {
              $cond: ['$isPayoutDifference', 1, 0],
            },
          },
          payoutDifferenceAmount: {
            $sum: {
              $cond: ['$isPayoutDifference', '$amountDue', 0],
            },
          },
          overChargesCount: { $sum: 0 },
          overChargesAmount: { $sum: 0 },
        },
      },
      { $unset: '_id' },
    ];
    const [summary] = await this.model
      .aggregate(pipeline)
      .allowDiskUse(true)
      .exec();
    return {
      ...(summary ?? {
        dueCount: 0,
        dueAmount: 0,
        overdueCount: 0,
        overdueAmount: 0,
        payoutDifferenceCount: 0,
        payoutDifferenceAmount: 0,
        overChargesCount: 0,
        overChargesAmount: 0,
      }),
      overChargesPending: true,
      dueWindowDays: 30,
    };
  }

  async summary(query: ListSettlementsDto, sellerAliases = [query.sellerId]) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          ...buildSettlementMatch(query),
          sellerId: { $in: sellerAliases },
        },
      },
      ...settlementCalculationStages(),
      ...(buildOrderDateMatch(query)
        ? [{ $match: buildOrderDateMatch(query)! }]
        : []),
      ...(query.status ? [{ $match: { status: query.status } }] : []),
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          grossSales: { $sum: '$grossSale' },
          returns: { $sum: '$returns' },
          netSales: { $sum: '$netSale' },
          totalExpenses: { $sum: '$expenses' },
          receivable: { $sum: '$receivable' },
          received: { $sum: '$received' },
          difference: { $sum: '$difference' },
        },
      },
      { $unset: '_id' },
    ];
    const [summary] = await this.model
      .aggregate(pipeline)
      .allowDiskUse(true)
      .exec();
    return (
      summary ?? {
        totalOrders: 0,
        grossSales: 0,
        returns: 0,
        netSales: 0,
        totalExpenses: 0,
        receivable: 0,
        received: 0,
        difference: 0,
      }
    );
  }

  async findOrder(
    query: ListSettlementsDto,
    orderId: string,
    sellerAliases = [query.sellerId],
  ) {
    const match = {
      ...buildSettlementMatch({ ...query, orderId }),
      sellerId: { $in: sellerAliases },
      orderId,
    };
    const [calculation, transactions, expenseBreakdown] = await Promise.all([
      this.model
        .aggregate([
          { $match: match },
          ...settlementCalculationStages(),
          ...(buildOrderDateMatch(query)
            ? [{ $match: buildOrderDateMatch(query)! }]
            : []),
          { $limit: 1 },
        ])
        .allowDiskUse(true)
        .exec()
        .then((rows) => rows[0] ?? null),
      this.model
        .find(match)
        .sort({ settlementDate: 1, createdAt: 1 })
        .lean()
        .exec(),
      this.model
        .aggregate([
          {
            $match: {
              ...match,
              calculationRole: 'expense',
            },
          },
          {
            $group: {
              _id: '$transactionCategory',
              amount: { $sum: { $abs: '$amount' } },
              count: { $sum: 1 },
              transactions: {
                $push: {
                  name: '$transactionName',
                  amount: '$amount',
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              category: '$_id',
              amount: 1,
              count: 1,
              transactions: 1,
            },
          },
          { $sort: { amount: -1 } },
        ])
        .exec(),
    ]);
    return { calculation, transactions, expenseBreakdown };
  }

  exportCursor(query: ListSettlementsDto, sellerAliases = [query.sellerId]) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          ...buildSettlementMatch(query),
          sellerId: { $in: sellerAliases },
        },
      },
      ...settlementCalculationStages(),
      ...(buildOrderDateMatch(query)
        ? [{ $match: buildOrderDateMatch(query)! }]
        : []),
      ...(query.status ? [{ $match: { status: query.status } }] : []),
      { $sort: { orderDate: -1, orderId: 1 } },
    ];
    return this.model
      .aggregate(pipeline)
      .allowDiskUse(true)
      .cursor({ batchSize: 1000 });
  }

  async replaceUpload(
    uploadId: string,
    transactions: NormalizedTransaction[],
  ) {
    await this.model.deleteMany({ uploadId }).exec();
    if (!transactions.length) return { inserted: 0 };

    const deduped = new Map<string, NormalizedTransaction>();
    for (const txn of transactions) {
      deduped.set(txn.sourceId, { ...txn, uploadId });
    }
    const rows = [...deduped.values()];
    const first = rows[0]!;

    const conflictFilter = {
      sellerId: first.sellerId,
      marketplace: first.marketplace,
      ...(first.reportMonth ? { reportMonth: first.reportMonth } : {}),
      sourceType: first.sourceType,
    };
    const sourceIds = rows.map((row) => row.sourceId);
    for (const batch of chunkArray(sourceIds)) {
      await this.model
        .deleteMany({
          ...conflictFilter,
          sourceId: { $in: batch },
        })
        .exec();
    }

    await this.model.insertMany(rows, { ordered: false });
    return { inserted: rows.length };
  }

  async replaceScope(
    scope: {
      sellerId: string;
      marketplace: string;
      reportMonth?: string;
      sourceType: string;
    },
    transactions: NormalizedTransaction[],
  ) {
    await this.model
      .deleteMany({
        sellerId: scope.sellerId,
        marketplace: scope.marketplace,
        sourceType: scope.sourceType,
        ...(scope.reportMonth ? { reportMonth: scope.reportMonth } : {}),
      })
      .exec();
    if (!transactions.length) return { inserted: 0 };
    await this.model.insertMany(transactions, { ordered: false });
    return { inserted: transactions.length };
  }

  async deleteUpload(uploadId: string) {
    return this.model.deleteMany({ uploadId }).exec();
  }
}
