import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, PipelineStage } from 'mongoose';
import { chunkArray } from '../../../common/utils/mongo-batch.util';
import type { PaymentDuplicateStrategy } from '../core/payment-upload-summary.types';
import {
  AmazonPaymentTransaction,
  AmazonPaymentTransactionDocument,
} from './schemas/amazon-payment-transaction.schema';
import type { AmazonPaymentInsertPayload } from './amazon-payment.types';
import type { AmazonAggregatedSettlementBucket } from './amazon-payment-analytics.mapper';

export type AmazonPaymentWriteResult = {
  inserted: number;
  updated: number;
  skipped: number;
  duplicateRows: number;
};

/**
 * Mirrors {@link classifyAmazonPaymentLine} for Mongo `$addFields`.
 * Keep in sync with the TypeScript classifier — do not diverge patterns.
 */
const AMAZON_LINE_KIND_EXPR = {
  $let: {
    vars: {
      desc: {
        $toLower: { $trim: { input: { $ifNull: ['$amountDescription', ''] } } },
      },
      type: {
        $toLower: { $trim: { input: { $ifNull: ['$transactionType', ''] } } },
      },
    },
    in: {
      $let: {
        vars: {
          haystack: { $concat: ['$$type', ' ', '$$desc'] },
          isSaleComponent: {
            $regexMatch: {
              input: '$$desc',
              regex: 'principal|product tax',
            },
          },
        },
        in: {
          $switch: {
            branches: [
              {
                case: {
                  $and: [
                    '$$isSaleComponent',
                    {
                      $regexMatch: {
                        input: '$$haystack',
                        regex: 'refund|return',
                      },
                    },
                  ],
                },
                then: 'return',
              },
              { case: '$$isSaleComponent', then: 'sale' },
              {
                case: {
                  $regexMatch: { input: '$$haystack', regex: 'commission' },
                },
                then: 'commission',
              },
              {
                case: {
                  $regexMatch: { input: '$$haystack', regex: '\\btcs\\b' },
                },
                then: 'tcs',
              },
              {
                case: {
                  $regexMatch: { input: '$$haystack', regex: '\\btds\\b' },
                },
                then: 'tds',
              },
              {
                case: {
                  $or: [
                    {
                      $regexMatch: {
                        input: '$$desc',
                        regex:
                          'shipping|postage|logistics|easy ship|storage|penalty|fee|charge|fba|fulfillment|closing|advert|sponsored|servicefee|service fee|promotion|promo|discount',
                      },
                    },
                    {
                      $regexMatch: {
                        input: '$$haystack',
                        regex:
                          'shipping|postage|logistics|easy ship|storage|penalty|fee|charge|fba|fulfillment|closing|advert|sponsored|servicefee|service fee',
                      },
                    },
                  ],
                },
                then: 'fee',
              },
            ],
            default: 'other',
          },
        },
      },
    },
  },
};

@Injectable()
export class AmazonPaymentRepository {
  constructor(
    @InjectModel(AmazonPaymentTransaction.name)
    private readonly model: Model<AmazonPaymentTransactionDocument>,
  ) {}

  async saveRows(
    rows: AmazonPaymentInsertPayload[],
    duplicateStrategy: PaymentDuplicateStrategy = 'update',
  ): Promise<AmazonPaymentWriteResult> {
    if (!rows.length) {
      return { inserted: 0, updated: 0, skipped: 0, duplicateRows: 0 };
    }

    if (duplicateStrategy === 'skip') {
      return this.insertMissingRows(rows);
    }

    const uploadId = String(rows[0]?.uploadId ?? '').trim();
    if (!uploadId) {
      return {
        inserted: 0,
        updated: 0,
        skipped: rows.length,
        duplicateRows: 0,
      };
    }

    return this.replaceByUploadId(uploadId, rows);
  }

  async replaceByUploadId(
    uploadId: string,
    rows: AmazonPaymentInsertPayload[],
  ): Promise<AmazonPaymentWriteResult> {
    const session = await this.model.db.startSession();
    let replacedCount = 0;
    try {
      await session.withTransaction(async () => {
        replacedCount = await this.model
          .countDocuments({ uploadId })
          .session(session)
          .exec();
        await this.model.deleteMany({ uploadId }).session(session).exec();
        if (rows.length) {
          const deduped = new Map<string, AmazonPaymentInsertPayload>();
          for (const row of rows) {
            deduped.set(row.rowKey, row);
          }
          const uniqueRows = [...deduped.values()];
          await this.deleteConflictingRowKeys(uniqueRows, session);
          await this.model.insertMany(uniqueRows, { ordered: false, session });
        }
      });
    } finally {
      await session.endSession();
    }

    return {
      inserted: Math.max(0, rows.length - replacedCount),
      updated: Math.min(rows.length, replacedCount),
      skipped: 0,
      duplicateRows: 0,
    };
  }

  async deleteByUploadId(uploadId: string): Promise<number> {
    const result = await this.model.deleteMany({ uploadId }).exec();
    return result.deletedCount ?? 0;
  }

  async deleteByScope(input: {
    sellerIds: string[];
    marketplace: string;
    reportMonth?: string;
  }): Promise<number> {
    const result = await this.model
      .deleteMany({
        sellerId: { $in: input.sellerIds },
        marketplace: input.marketplace,
        reportMonth: input.reportMonth ?? null,
      })
      .exec();
    return result.deletedCount ?? 0;
  }

  async findBySeller(query: {
    sellerIds: string[];
    gstin?: string;
    paymentDateFrom?: string;
    paymentDateTo?: string;
    search?: string;
    orderId?: string;
    limit?: number;
    /** Skip Mongo sort — analytics sorts order-wise in memory after enrichment. */
    skipSort?: boolean;
  }): Promise<AmazonPaymentTransaction[]> {
    const filter = this.buildSellerFilter(query);
    const limit = Math.min(Math.max(1, query.limit ?? 100_000), 200_000);
    // Analytics only needs mapper fields — projecting cuts BSON transfer for
    // large sellers (tens of thousands of component rows).
    let findQuery = this.model.find(filter).select({
      _id: 1,
      settlementId: 1,
      depositDate: 1,
      transactionType: 1,
      orderId: 1,
      amountDescription: 1,
      amount: 1,
      gstin: 1,
      reportMonth: 1,
      rowKey: 1,
    });
    if (!query.skipSort) {
      findQuery = findQuery.sort({
        depositDate: -1,
        orderId: 1,
        settlementId: 1,
      });
    }
    return findQuery.limit(limit).lean().exec() as Promise<
      AmazonPaymentTransaction[]
    >;
  }

  /**
   * Classify + sum Amazon settlement components in Mongo so Order Wise Payments
   * transfers ~one row per (orderId, settlementId) instead of every line item.
   * Classification mirrors {@link classifyAmazonPaymentLine}; financial rules
   * match {@link mapAmazonPaymentComponentsToAnalyticsRows}.
   */
  async findAggregatedForAnalytics(query: {
    sellerIds: string[];
    gstin?: string;
    paymentDateFrom?: string;
    paymentDateTo?: string;
    search?: string;
    orderId?: string;
  }): Promise<AmazonAggregatedSettlementBucket[]> {
    const filter = this.buildSellerFilter(query);
    const pipeline: PipelineStage[] = [
      { $match: filter },
      // Prefer later reportMonth when the same rowKey was re-imported (mapper parity).
      { $sort: { reportMonth: 1 } },
      {
        $group: {
          _id: {
            $cond: [
              {
                $gt: [
                  { $strLenCP: { $ifNull: ['$rowKey', ''] } },
                  0,
                ],
              },
              '$rowKey',
              { $toString: '$_id' },
            ],
          },
          doc: { $last: '$$ROOT' },
        },
      },
      { $replaceRoot: { newRoot: '$doc' } },
      { $addFields: { kind: AMAZON_LINE_KIND_EXPR } },
      {
        $group: {
          _id: {
            orderId: '$orderId',
            settlementId: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $ifNull: ['$settlementId', ''] }, ''] },
                    { $eq: ['$settlementId', null] },
                  ],
                },
                'unknown',
                '$settlementId',
              ],
            },
          },
          saleAmount: {
            $sum: { $cond: [{ $eq: ['$kind', 'sale'] }, '$amount', 0] },
          },
          refundAbs: {
            $sum: {
              $cond: [
                { $eq: ['$kind', 'return'] },
                { $abs: '$amount' },
                0,
              ],
            },
          },
          commission: {
            $sum: {
              $cond: [{ $eq: ['$kind', 'commission'] }, '$amount', 0],
            },
          },
          tcs: {
            $sum: { $cond: [{ $eq: ['$kind', 'tcs'] }, '$amount', 0] },
          },
          tds: {
            $sum: { $cond: [{ $eq: ['$kind', 'tds'] }, '$amount', 0] },
          },
          otherFees: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$kind', 'fee'] },
                    {
                      $and: [
                        { $eq: ['$kind', 'other'] },
                        { $ne: ['$amount', 0] },
                      ],
                    },
                    { $eq: ['$kind', 'tcs'] },
                    { $eq: ['$kind', 'tds'] },
                  ],
                },
                '$amount',
                0,
              ],
            },
          },
          bankSettlementValue: { $sum: '$amount' },
          gstin: { $first: '$gstin' },
          reportMonth: { $first: '$reportMonth' },
          depositDate: { $first: '$depositDate' },
          idSeed: { $first: '$_id' },
          feeLines: {
            $push: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$kind', 'fee'] },
                    {
                      $and: [
                        { $eq: ['$kind', 'other'] },
                        { $ne: ['$amount', 0] },
                      ],
                    },
                  ],
                },
                {
                  amountDescription: '$amountDescription',
                  amount: '$amount',
                },
                '$$REMOVE',
              ],
            },
          },
        },
      },
    ];

    const rows = await this.model
      .aggregate(pipeline)
      .allowDiskUse(true)
      .exec();

    return rows.map((row: {
      _id?: { orderId?: string; settlementId?: string };
      saleAmount?: number;
      refundAbs?: number;
      commission?: number;
      tcs?: number;
      tds?: number;
      otherFees?: number;
      bankSettlementValue?: number;
      gstin?: string;
      reportMonth?: string;
      depositDate?: Date | string;
      idSeed?: { toString(): string } | string;
      feeLines?: Array<{ amountDescription?: string; amount?: number }>;
    }) => ({
      orderId: String(row._id?.orderId ?? ''),
      settlementId: String(row._id?.settlementId ?? 'unknown'),
      saleAmount: Number(row.saleAmount ?? 0),
      refundAbs: Number(row.refundAbs ?? 0),
      commission: Number(row.commission ?? 0),
      tcs: Number(row.tcs ?? 0),
      tds: Number(row.tds ?? 0),
      otherFees: Number(row.otherFees ?? 0),
      bankSettlementValue: Number(row.bankSettlementValue ?? 0),
      gstin: row.gstin,
      reportMonth: row.reportMonth,
      depositDate: row.depositDate,
      idSeed: row.idSeed,
      feeLines: Array.isArray(row.feeLines) ? row.feeLines : [],
    }));
  }

  async countBySeller(query: {
    sellerIds: string[];
    gstin?: string;
  }): Promise<number> {
    return this.model.countDocuments(this.buildSellerFilter(query)).exec();
  }

  async hasDataForSeller(query: {
    sellerIds: string[];
    gstin?: string;
  }): Promise<boolean> {
    const doc = await this.model.exists(this.buildSellerFilter(query));
    return Boolean(doc);
  }

  private buildSellerFilter(query: {
    sellerIds: string[];
    gstin?: string;
    paymentDateFrom?: string;
    paymentDateTo?: string;
    search?: string;
    orderId?: string;
  }): Record<string, unknown> {
    const filter: Record<string, unknown> = {
      sellerId: { $in: query.sellerIds },
      // Order Wise Payments requires an order id to attach settlement components.
      orderId: { $exists: true, $nin: [null, ''] },
    };

    if (query.gstin) {
      filter.gstin = query.gstin.trim().toUpperCase();
    }

    // Do NOT filter by marketplace string — stored values are often seller-link ObjectIds.
    const from = String(query.paymentDateFrom ?? '').trim();
    const to = String(query.paymentDateTo ?? '').trim();
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) {
        const d = new Date(from);
        if (!Number.isNaN(d.getTime())) range.$gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (!Number.isNaN(d.getTime())) {
          d.setHours(23, 59, 59, 999);
          range.$lte = d;
        }
      }
      if (Object.keys(range).length) filter.depositDate = range;
    }

    const orderId = String(query.orderId ?? '').trim();
    if (orderId) {
      filter.orderId = orderId;
    }

    const search = String(query.search ?? '').trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { orderId: regex },
        { settlementId: regex },
        { amountDescription: regex },
        { transactionType: regex },
      ];
    }

    return filter;
  }

  private async deleteConflictingRowKeys(
    rows: AmazonPaymentInsertPayload[],
    session?: ClientSession,
  ) {
    if (!rows.length) return;
    const first = rows[0];
    const conflictFilter = {
      sellerId: first.sellerId,
      marketplace: first.marketplace,
      reportMonth: first.reportMonth ?? null,
    };
    const rowKeys = rows.map((row) => row.rowKey);
    for (const batch of chunkArray(rowKeys)) {
      let query = this.model.deleteMany({
        ...conflictFilter,
        rowKey: { $in: batch },
      });
      if (session) {
        query = query.session(session);
      }
      await query.exec();
    }
  }

  private async insertMissingRows(
    rows: AmazonPaymentInsertPayload[],
  ): Promise<AmazonPaymentWriteResult> {
    const ops = rows.map((row) => ({
      updateOne: {
        filter: {
          sellerId: row.sellerId,
          marketplace: row.marketplace,
          reportMonth: row.reportMonth ?? null,
          rowKey: row.rowKey,
        },
        update: { $setOnInsert: row },
        upsert: true,
      },
    }));
    const result = await this.model.bulkWrite(ops, { ordered: false });
    const inserted = result.upsertedCount ?? 0;
    return {
      inserted,
      updated: 0,
      skipped: rows.length - inserted,
      duplicateRows: 0,
    };
  }
}
