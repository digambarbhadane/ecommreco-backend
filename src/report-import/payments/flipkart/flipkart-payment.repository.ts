import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { PaymentDuplicateStrategy } from '../core/payment-upload-summary.types';
import {
  FlipkartPaymentReport,
  FlipkartPaymentReportDocument,
} from './schemas/flipkart-payment-report.schema';
import type { FlipkartPaymentUpsertPayload } from './flipkart-payment.types';

export type FlipkartPaymentBulkUpsertResult = {
  inserted: number;
  updated: number;
  skipped: number;
  duplicateRows: number;
};

export type FlipkartPaymentListQuery = {
  sellerId?: string;
  sellerIds?: string[];
  gstin?: string;
  marketplace?: string;
  reportMonth?: string;
  paymentDateFrom?: string;
  paymentDateTo?: string;
  invoiceId?: string;
  orderId?: string;
  neftId?: string;
  search?: string;
  skip?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
};

@Injectable()
export class FlipkartPaymentRepository {
  constructor(
    @InjectModel(FlipkartPaymentReport.name)
    private readonly model: Model<FlipkartPaymentReportDocument>,
  ) {}

  async bulkUpsert(
    rows: FlipkartPaymentUpsertPayload[],
    duplicateStrategy: PaymentDuplicateStrategy = 'update',
  ): Promise<FlipkartPaymentBulkUpsertResult> {
    if (!rows.length) {
      return { inserted: 0, updated: 0, skipped: 0, duplicateRows: 0 };
    }

    const orderKeys = rows.map(
      (row) =>
        `${row.sellerId}::${row.marketplace}::${row.orderId}::${row.reportMonth ?? ''}`,
    );
    const duplicateRows = orderKeys.length - new Set(orderKeys).size;

    if (duplicateStrategy === 'skip') {
      const existing = await this.model
        .find({
          $or: rows.map((row) => ({
            sellerId: row.sellerId,
            marketplace: row.marketplace,
            orderId: row.orderId,
            reportMonth: row.reportMonth ?? null,
          })),
        })
        .select({ orderId: 1, sellerId: 1, marketplace: 1, reportMonth: 1 })
        .lean()
        .exec();

      const existingKeys = new Set(
        existing.map(
          (doc) =>
            `${doc.sellerId}::${doc.marketplace}::${doc.orderId}::${doc.reportMonth ?? ''}`,
        ),
      );

      const toInsert = rows.filter(
        (row) =>
          !existingKeys.has(
            `${row.sellerId}::${row.marketplace}::${row.orderId}::${row.reportMonth ?? ''}`,
          ),
      );

      if (toInsert.length) {
        await this.model.insertMany(toInsert, { ordered: false });
      }

      return {
        inserted: toInsert.length,
        updated: 0,
        skipped: rows.length - toInsert.length,
        duplicateRows,
      };
    }

    const ops = rows.map((row) => ({
      updateOne: {
        filter: {
          sellerId: row.sellerId,
          marketplace: row.marketplace,
          orderId: row.orderId,
          reportMonth: row.reportMonth ?? null,
        },
        update: { $set: row },
        upsert: true,
      },
    }));

    const result = await this.model.bulkWrite(ops, { ordered: false });
    return {
      inserted: result.upsertedCount ?? 0,
      updated: result.modifiedCount ?? 0,
      skipped: 0,
      duplicateRows,
    };
  }

  async findByOrderId(
    sellerId: string,
    orderId: string,
    marketplace?: string,
  ): Promise<FlipkartPaymentReportDocument | null> {
    const filter: Record<string, unknown> = {
      sellerId,
      orderId,
    };
    if (marketplace) filter.marketplace = marketplace;
    return this.model.findOne(filter).lean().exec();
  }

  async findBySeller(query: FlipkartPaymentListQuery) {
    const filter = this.buildFilter(query);
    const skip = Math.max(0, query.skip ?? 0);
    const limit = Math.min(Math.max(1, query.limit ?? 50), 500);
    const sortField = query.sortBy?.trim() || 'paymentDate';
    const sortDir = query.sortOrder === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> = { [sortField]: sortDir };
    if (sortField !== 'orderId') {
      sort.orderId = 1;
    }

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { data, total, skip, limit };
  }

  async countByFilter(
    query: Pick<
      FlipkartPaymentListQuery,
      'sellerId' | 'sellerIds' | 'gstin' | 'marketplace' | 'reportMonth' | 'paymentDateFrom' | 'paymentDateTo' | 'search'
    >,
  ): Promise<number> {
    return this.model.countDocuments(this.buildFilter(query)).exec();
  }

  async aggregateAnalyticsSummary(
    query: Pick<
      FlipkartPaymentListQuery,
      'sellerId' | 'sellerIds' | 'gstin' | 'marketplace' | 'reportMonth' | 'paymentDateFrom' | 'paymentDateTo'
    >,
  ): Promise<{
    totalRows: number;
    totalSettlementAmount: number;
    uniqueNeftCount: number;
    rowsWithNeftType: number;
    byNeftType: Array<{ paymentMode: string; count: number; settlement: number }>;
  }> {
    const filter = this.buildFilter(query);
    const facetResult = await this.model
      .aggregate<{
        totals: Array<{
          totalRows: number;
          totalSettlementAmount: number;
          uniqueNeftCount: number;
          rowsWithNeftType: number;
        }>;
        byNeftType: Array<{ _id: string; count: number; settlement: number }>;
      }>([
        { $match: filter },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  totalRows: { $sum: 1 },
                  totalSettlementAmount: {
                    $sum: { $ifNull: ['$bankSettlementValue', 0] },
                  },
                  uniqueNeftCount: {
                    $addToSet: {
                      $trim: { input: { $ifNull: ['$neftId', ''] } },
                    },
                  },
                  rowsWithNeftType: {
                    $sum: {
                      $cond: [
                        {
                          $gt: [
                            {
                              $strLenCP: {
                                $trim: { input: { $ifNull: ['$neftType', ''] } },
                              },
                            },
                            0,
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  totalRows: 1,
                  totalSettlementAmount: 1,
                  rowsWithNeftType: 1,
                  uniqueNeftCount: {
                    $size: {
                      $filter: {
                        input: '$uniqueNeftCount',
                        as: 'neft',
                        cond: { $gt: [{ $strLenCP: '$$neft' }, 0] },
                      },
                    },
                  },
                },
              },
            ],
            byNeftType: [
              {
                $group: {
                  _id: {
                    $trim: { input: { $ifNull: ['$neftType', 'Unknown'] } },
                  },
                  count: { $sum: 1 },
                  settlement: {
                    $sum: { $ifNull: ['$bankSettlementValue', 0] },
                  },
                },
              },
              { $sort: { count: -1, _id: 1 } },
            ],
          },
        },
      ])
      .exec();

    const facet = facetResult[0] ?? { totals: [], byNeftType: [] };
    const totals = facet.totals[0] ?? {
      totalRows: 0,
      totalSettlementAmount: 0,
      uniqueNeftCount: 0,
      rowsWithNeftType: 0,
    };

    return {
      totalRows: Number(totals.totalRows ?? 0),
      totalSettlementAmount: Number(totals.totalSettlementAmount ?? 0),
      uniqueNeftCount: Number(totals.uniqueNeftCount ?? 0),
      rowsWithNeftType: Number(totals.rowsWithNeftType ?? 0),
      byNeftType: (facet.byNeftType ?? []).map((item) => ({
        paymentMode: String(item._id || 'Unknown'),
        count: Number(item.count ?? 0),
        settlement: Number(item.settlement ?? 0),
      })),
    };
  }

  async deleteByUploadId(uploadId: string): Promise<number> {
    const result = await this.model.deleteMany({ uploadId }).exec();
    return result.deletedCount ?? 0;
  }

  async listForImportRowEnrichment(query: {
    sellerId: string;
    gstin: string;
    marketplace: string;
    reportMonth: string;
    uploadId: string;
  }): Promise<
    Array<{
      orderId: string;
      bankSettlementValue?: number;
      neftId?: string;
      paymentDate?: string;
    }>
  > {
    return this.model
      .find({
        sellerId: query.sellerId,
        gstin: query.gstin.trim().toUpperCase(),
        marketplace: query.marketplace,
        reportMonth: query.reportMonth,
        uploadId: query.uploadId,
      })
      .select({
        orderId: 1,
        bankSettlementValue: 1,
        neftId: 1,
        paymentDate: 1,
      })
      .lean()
      .exec();
  }

  async aggregateSettlementByNeft(
    query: Pick<
      FlipkartPaymentListQuery,
      'sellerId' | 'sellerIds' | 'gstin' | 'marketplace' | 'reportMonth'
    >,
  ): Promise<
    Array<{
      neftId: string;
      bankSettlementTotal: number;
      salesCount: number;
      returnsCount: number;
    }>
  > {
    const match = this.buildFilter(query);

    return this.model
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: { $trim: { input: { $ifNull: ['$neftId', ''] } } },
            bankSettlementTotal: { $sum: { $ifNull: ['$bankSettlementValue', 0] } },
            salesCount: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $gt: [{ $ifNull: ['$saleAmount', 0] }, 0] },
                      { $gt: [{ $ifNull: ['$bankSettlementValue', 0] }, 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            returnsCount: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $gt: [{ $ifNull: ['$refund', 0] }, 0] },
                      {
                        $regexMatch: {
                          input: { $toUpper: { $ifNull: ['$returnType', ''] } },
                          regex: 'RETURN|RTO|REFUND',
                        },
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $match: { _id: { $ne: '' } } },
        { $sort: { bankSettlementTotal: -1 } },
        {
          $project: {
            _id: 0,
            neftId: '$_id',
            bankSettlementTotal: 1,
            salesCount: 1,
            returnsCount: 1,
          },
        },
      ])
      .exec();
  }

  private buildFilter(
    query: Pick<
      FlipkartPaymentListQuery,
      | 'sellerId'
      | 'sellerIds'
      | 'gstin'
      | 'marketplace'
      | 'reportMonth'
      | 'paymentDateFrom'
      | 'paymentDateTo'
      | 'orderId'
      | 'invoiceId'
      | 'neftId'
      | 'search'
    >,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    const sellerIds =
      query.sellerIds?.filter(Boolean) ??
      (query.sellerId ? [query.sellerId] : []);
    if (sellerIds.length === 1) {
      filter.sellerId = sellerIds[0];
    } else if (sellerIds.length > 1) {
      filter.sellerId = { $in: sellerIds };
    }
    if (query.gstin) filter.gstin = query.gstin.trim().toUpperCase();
    if (query.marketplace) filter.marketplace = query.marketplace;
    if (query.reportMonth) filter.reportMonth = query.reportMonth;
    if (query.orderId) filter.orderId = query.orderId;
    if (query.invoiceId) filter.invoiceId = query.invoiceId;
    if (query.neftId) filter.neftId = query.neftId;
    if (query.paymentDateFrom || query.paymentDateTo) {
      const paymentDate: Record<string, string> = {};
      if (query.paymentDateFrom) {
        paymentDate.$gte = query.paymentDateFrom;
      }
      if (query.paymentDateTo) {
        paymentDate.$lte = query.paymentDateTo;
      }
      filter.paymentDate = paymentDate;
    }
    const search = String(query.search ?? '').trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { orderId: { $regex: escaped, $options: 'i' } },
        { neftId: { $regex: escaped, $options: 'i' } },
        { invoiceId: { $regex: escaped, $options: 'i' } },
        { sellerSku: { $regex: escaped, $options: 'i' } },
      ];
    }
    return filter;
  }
}
