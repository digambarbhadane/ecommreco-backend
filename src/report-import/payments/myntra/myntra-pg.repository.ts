import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { chunkArray } from '../../../common/utils/mongo-batch.util';
import type { PaymentDuplicateStrategy } from '../core/payment-upload-summary.types';
import {
  MyntraPgSettlementRow,
  MyntraPgSettlementDocument,
} from './schemas/myntra-pg-settlement.schema';
import type { MyntraPgInsertPayload } from './myntra-pg.types';
import type {
  PaymentNeftSummaryRow,
  PaymentSheetBreakdownItem,
} from '../../utils/payment-summary.aggregation';

export type MyntraPgPaymentMonthSummary = {
  rows: PaymentNeftSummaryRow[];
  sheetBreakdown: PaymentSheetBreakdownItem[];
};

export type MyntraPgWriteResult = {
  inserted: number;
  updated: number;
  skipped: number;
  duplicateRows: number;
};

export type MyntraPgPayoutQuery = {
  sellerIds: string[];
  gstin?: string;
  marketplace?: string;
  paymentDateFrom?: string;
  paymentDateTo?: string;
};

export type MyntraPgPayoutByNeftRow = {
  neftId: string;
  marketplace: string;
  paymentDate: string;
  bankSettlementTotal: number;
  orderCount: number;
  salesCount: number;
  returnsCount: number;
  sheetTotals: {
    'pg-forward': number;
    'pg-reverse': number;
  };
  sheetCounts: {
    'pg-forward': number;
    'pg-reverse': number;
  };
};

@Injectable()
export class MyntraPgRepository {
  constructor(
    @InjectModel(MyntraPgSettlementRow.name)
    private readonly model: Model<MyntraPgSettlementDocument>,
  ) {}

  async saveRows(
    rows: MyntraPgInsertPayload[],
    duplicateStrategy: PaymentDuplicateStrategy = 'update',
  ): Promise<MyntraPgWriteResult> {
    if (!rows.length) {
      return { inserted: 0, updated: 0, skipped: 0, duplicateRows: 0 };
    }
    if (duplicateStrategy === 'skip') {
      return this.insertMissingRows(rows);
    }
    const uploadId = String(rows[0]?.uploadId ?? '').trim();
    if (!uploadId) {
      return { inserted: 0, updated: 0, skipped: rows.length, duplicateRows: 0 };
    }
    return this.replaceByUploadId(uploadId, rows);
  }

  async deleteByUploadId(
    uploadId: string,
    reportKind?: 'forward' | 'reverse',
  ): Promise<void> {
    const filter: Record<string, unknown> = { uploadId };
    if (reportKind) {
      filter.reportKind = reportKind;
    }
    await this.model.deleteMany(filter).exec();
  }

  async replaceByUploadId(
    uploadId: string,
    rows: MyntraPgInsertPayload[],
  ): Promise<MyntraPgWriteResult> {
    const session = await this.model.db.startSession();
    let replacedCount = 0;
    const reportKind = rows[0]?.reportKind;
    const scopeFilter: Record<string, unknown> = { uploadId };
    if (reportKind) {
      scopeFilter.reportKind = reportKind;
    }
    try {
      await session.withTransaction(async () => {
        replacedCount = await this.model
          .countDocuments(scopeFilter)
          .session(session)
          .exec();
        await this.model.deleteMany(scopeFilter).session(session).exec();
        if (rows.length) {
          const deduped = new Map<string, MyntraPgInsertPayload>();
          for (const row of rows) {
            deduped.set(row.rowKey, row);
          }
          const uniqueRows = [...deduped.values()];
          await this.deleteConflictingRowKeys(uniqueRows, session);
          for (const batch of chunkArray(uniqueRows, 500)) {
            await this.model.insertMany(batch, { ordered: false, session });
          }
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

  async deleteByScope(scope: {
    sellerIds: string[];
    marketplace: string;
    reportMonth: string;
    reportKind?: 'forward' | 'reverse';
  }) {
    const filter: Record<string, unknown> = {
      sellerId: { $in: scope.sellerIds },
      marketplace: scope.marketplace,
      reportMonth: scope.reportMonth,
    };
    if (scope.reportKind) {
      filter.reportKind = scope.reportKind;
    }
    await this.model.deleteMany(filter).exec();
  }

  async summarizePaymentForMonth(query: {
    sellerIds: string[];
    gstin?: string;
    marketplace: string;
    reportMonth: string;
  }): Promise<MyntraPgPaymentMonthSummary> {
    const match: Record<string, unknown> = {
      sellerId: { $in: query.sellerIds },
      marketplace: query.marketplace,
      reportMonth: query.reportMonth,
    };
    const gstin = query.gstin?.trim().toUpperCase();
    if (gstin) {
      match.gstin = gstin;
    }

    const utrExpr = {
      $trim: {
        input: {
          $ifNull: [
            '$rowData.bank_utr_no_prepaid_payment',
            {
              $ifNull: [
                '$rowData.bank_utr_no_postpaid_payment',
                {
                  $ifNull: [
                    '$rowData.bank_utr_no_prepaid_comm_deduction',
                    {
                      $ifNull: [
                        '$rowData.bank_utr_no_postpaid_comm_deduction',
                        '',
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    };

    const paymentDateExpr = {
      $ifNull: [
        '$rowData.settlement_date_prepaid_payment',
        {
          $ifNull: [
            '$rowData.settlement_date_postpaid_payment',
            '$settlementDate',
          ],
        },
      ],
    };

    const amountExpr = {
      $ifNull: [
        '$totalActualSettlement',
        {
          $ifNull: [
            '$totalSettlement',
            { $ifNull: ['$rowData.total_actual_settlement', 0] },
          ],
        },
      ],
    };

    const [byUtr, byKind] = await Promise.all([
      this.model
        .aggregate<{
          neftNo: string;
          paymentDate?: Date | string;
          bankSettlementTotal: number;
          salesCount: number;
          returnsCount: number;
        }>([
          { $match: match },
          {
            $group: {
              _id: utrExpr,
              paymentDate: { $max: paymentDateExpr },
              bankSettlementTotal: { $sum: amountExpr },
              salesCount: {
                $sum: {
                  $cond: [{ $eq: ['$reportKind', 'forward'] }, 1, 0],
                },
              },
              returnsCount: {
                $sum: {
                  $cond: [{ $eq: ['$reportKind', 'reverse'] }, 1, 0],
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              neftNo: {
                $cond: [{ $eq: ['$_id', ''] }, 'Unassigned UTR', '$_id'],
              },
              paymentDate: 1,
              bankSettlementTotal: 1,
              salesCount: 1,
              returnsCount: 1,
            },
          },
          { $sort: { bankSettlementTotal: -1, neftNo: 1 } },
        ])
        .exec(),
      this.model
        .aggregate<{
          _id: 'forward' | 'reverse';
          count: number;
          total: number;
        }>([
          { $match: match },
          {
            $group: {
              _id: '$reportKind',
              count: { $sum: 1 },
              total: { $sum: amountExpr },
            },
          },
        ])
        .exec(),
    ]);

    const sheetBreakdown: PaymentSheetBreakdownItem[] = [];
    for (const item of byKind) {
      if (item._id === 'forward') {
        sheetBreakdown.push({
          kind: 'pg-forward',
          label: 'PG Forward Settled',
          total: Number(item.total ?? 0),
          count: Number(item.count ?? 0),
        });
      } else if (item._id === 'reverse') {
        sheetBreakdown.push({
          kind: 'pg-reverse',
          label: 'PG Reverse Settled',
          total: Number(item.total ?? 0),
          count: Number(item.count ?? 0),
        });
      }
    }

    const rows: PaymentNeftSummaryRow[] = byUtr.map((row) => ({
      neftNo: row.neftNo,
      paymentDate:
        row.paymentDate instanceof Date
          ? row.paymentDate.toISOString()
          : row.paymentDate
            ? String(row.paymentDate)
            : undefined,
      bankSettlementTotal: Number(row.bankSettlementTotal ?? 0),
      salesCount: Number(row.salesCount ?? 0),
      returnsCount: Number(row.returnsCount ?? 0),
      orderTotal: Number(row.bankSettlementTotal ?? 0),
    }));

    return { rows, sheetBreakdown };
  }

  async countByFilter(query: {
    sellerIds: string[];
    gstin?: string;
    marketplace?: string;
  }): Promise<number> {
    const match = this.buildPayoutMatch(query);
    return this.model.countDocuments(match).exec();
  }

  async aggregatePayoutsByNeft(
    query: MyntraPgPayoutQuery,
  ): Promise<MyntraPgPayoutByNeftRow[]> {
    const match = this.buildPayoutMatch(query);
    const utrExpr = this.buildUtrExpression();
    const paymentDateExpr = this.buildPaymentDateExpression();
    const amountExpr = this.buildAmountExpression();

    const rows = await this.model
      .aggregate<{
        neftId: string;
        marketplace: string;
        paymentDate?: Date | string;
        bankSettlementTotal: number;
        forwardTotal: number;
        reverseTotal: number;
        forwardCount: number;
        reverseCount: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: utrExpr,
            marketplace: { $first: { $ifNull: ['$marketplace', 'myntra'] } },
            paymentDate: { $max: paymentDateExpr },
            bankSettlementTotal: { $sum: amountExpr },
            forwardTotal: {
              $sum: {
                $cond: [{ $eq: ['$reportKind', 'forward'] }, amountExpr, 0],
              },
            },
            reverseTotal: {
              $sum: {
                $cond: [{ $eq: ['$reportKind', 'reverse'] }, amountExpr, 0],
              },
            },
            forwardCount: {
              $sum: {
                $cond: [{ $eq: ['$reportKind', 'forward'] }, 1, 0],
              },
            },
            reverseCount: {
              $sum: {
                $cond: [{ $eq: ['$reportKind', 'reverse'] }, 1, 0],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            neftId: {
              $cond: [{ $eq: ['$_id', ''] }, 'Unassigned UTR', '$_id'],
            },
            marketplace: 1,
            paymentDate: 1,
            bankSettlementTotal: 1,
            forwardTotal: 1,
            reverseTotal: 1,
            forwardCount: 1,
            reverseCount: 1,
          },
        },
        { $sort: { bankSettlementTotal: -1, neftId: 1 } },
      ])
      .exec();

    return rows.map((row) => ({
      neftId: String(row.neftId ?? 'Unassigned UTR'),
      marketplace: String(row.marketplace ?? query.marketplace ?? 'myntra'),
      paymentDate:
        row.paymentDate instanceof Date
          ? row.paymentDate.toISOString()
          : String(row.paymentDate ?? ''),
      bankSettlementTotal: Number(row.bankSettlementTotal ?? 0),
      orderCount: Number(row.forwardCount ?? 0),
      salesCount: Number(row.forwardCount ?? 0),
      returnsCount: Number(row.reverseCount ?? 0),
      sheetTotals: {
        'pg-forward': Number(row.forwardTotal ?? 0),
        'pg-reverse': Number(row.reverseTotal ?? 0),
      },
      sheetCounts: {
        'pg-forward': Number(row.forwardCount ?? 0),
        'pg-reverse': Number(row.reverseCount ?? 0),
      },
    }));
  }

  async findRowsByNeft(query: {
    sellerIds: string[];
    marketplace?: string;
    gstin?: string;
    neftId: string;
    limit?: number;
  }): Promise<Array<Record<string, unknown>>> {
    const match = this.buildPayoutMatch(query);
    const utrExpr = this.buildUtrExpression();
    const neftId = String(query.neftId ?? '').trim();
    if (neftId && neftId !== 'Unassigned UTR') {
      match.$expr = { $eq: [utrExpr, neftId] };
    } else if (neftId === 'Unassigned UTR') {
      match.$expr = {
        $or: [
          { $eq: [utrExpr, ''] },
          { $eq: [utrExpr, null] },
        ],
      };
    }

    const rows = await this.model
      .find(match)
      .sort({ reportKind: 1, sourceRowNumber: 1 })
      .limit(Math.min(query.limit ?? 10_000, 100_000))
      .lean()
      .exec();

    return rows.map((row) => ({
      reportKind: row.reportKind,
      orderReleaseId: row.orderReleaseId,
      orderLineId: row.orderLineId,
      returnId: row.returnId,
      skuCode: row.skuCode,
      returnType: row.returnType,
      totalActualSettlement: row.totalActualSettlement,
      totalSettlement: row.totalSettlement,
      settlementDate: row.settlementDate,
      ...row.rowData,
    }));
  }

  private buildPayoutMatch(query: {
    sellerIds: string[];
    gstin?: string;
    marketplace?: string;
    paymentDateFrom?: string;
    paymentDateTo?: string;
  }): Record<string, unknown> {
    const match: Record<string, unknown> = {
      sellerId: { $in: query.sellerIds },
    };
    if (query.gstin) {
      match.gstin = query.gstin.trim().toUpperCase();
    }
    if (query.marketplace) {
      match.marketplace = query.marketplace;
    }
    const dateRange = this.buildPaymentDateRange(
      query.paymentDateFrom,
      query.paymentDateTo,
    );
    if (dateRange) {
      match.settlementDate = dateRange;
    }
    return match;
  }

  private buildPaymentDateRange(
    from?: string,
    to?: string,
  ): Record<string, Date> | undefined {
    const start = from ? new Date(from) : null;
    const end = to ? new Date(to) : null;
    const filter: Record<string, Date> = {};
    if (start && !Number.isNaN(start.getTime())) filter.$gte = start;
    if (end && !Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      filter.$lte = end;
    }
    return Object.keys(filter).length ? filter : undefined;
  }

  private buildUtrExpression() {
    return {
      $trim: {
        input: {
          $ifNull: [
            '$rowData.bank_utr_no_prepaid_payment',
            {
              $ifNull: [
                '$rowData.bank_utr_no_postpaid_payment',
                {
                  $ifNull: [
                    '$rowData.bank_utr_no_prepaid_comm_deduction',
                    {
                      $ifNull: [
                        '$rowData.bank_utr_no_postpaid_comm_deduction',
                        {
                          $ifNull: [
                            '$rowData.bank_utr_no_prepaid_logistics_deduction',
                            '$rowData.bank_utr_no_postpaid_logistics_deduction',
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    };
  }

  private buildPaymentDateExpression() {
    return {
      $ifNull: [
        '$rowData.settlement_date_postpaid_payment',
        {
          $ifNull: [
            '$rowData.settlement_date_prepaid_payment',
            {
              $ifNull: [
                '$rowData.settlement_date_postpaid_comm_deduction',
                {
                  $ifNull: [
                    '$rowData.settlement_date_prepaid_comm_deduction',
                    '$settlementDate',
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  private buildAmountExpression() {
    return {
      $ifNull: [
        '$totalActualSettlement',
        {
          $ifNull: [
            '$totalSettlement',
            { $ifNull: ['$rowData.total_actual_settlement', 0] },
          ],
        },
      ],
    };
  }

  private async insertMissingRows(
    rows: MyntraPgInsertPayload[],
  ): Promise<MyntraPgWriteResult> {
    let inserted = 0;
    let duplicateRows = 0;
    for (const batch of chunkArray(rows, 500)) {
      try {
        const result = await this.model.insertMany(batch, { ordered: false });
        inserted += result.length;
      } catch (error) {
        const writeErrors = (error as { writeErrors?: Array<{ code?: number }> })
          ?.writeErrors;
        if (!writeErrors?.length) throw error;
        duplicateRows += writeErrors.filter((item) => item.code === 11000).length;
        inserted += batch.length - duplicateRows;
      }
    }
    return {
      inserted,
      updated: 0,
      skipped: 0,
      duplicateRows,
    };
  }

  private async deleteConflictingRowKeys(
    rows: MyntraPgInsertPayload[],
    session: ClientSession,
  ) {
    const keys = rows.map((row) => row.rowKey);
    if (!keys.length) return;
    const sample = rows[0];
    await this.model
      .deleteMany({
        sellerId: sample.sellerId,
        marketplace: sample.marketplace,
        reportMonth: sample.reportMonth,
        reportKind: sample.reportKind,
        rowKey: { $in: keys },
        uploadId: { $ne: sample.uploadId },
      })
      .session(session)
      .exec();
  }
}
