import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ImportUpload } from '../schemas/import-upload.schema';
import { ImportRow } from '../schemas/import-row.schema';
import { ReconTransaction } from '../schemas/recon-transaction.schema';
import { ReconEvent } from '../schemas/recon-event.schema';
import { ReconAuditLog } from '../schemas/recon-audit-log.schema';
import { ReconAdjustment } from '../schemas/recon-adjustment.schema';

type RowAggregate = {
  _id: { canonicalKey: string; eventType: string };
  rowCount: number;
  quantity: number;
  invoiceAmount: number;
  settlementAmount: number;
  firstDate?: string;
  lastDate?: string;
  orderId?: string;
  skuId?: string;
  invoiceNo?: string;
};

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectModel(ImportUpload.name)
    private readonly uploadModel: Model<ImportUpload>,
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRow>,
    @InjectModel(ReconTransaction.name)
    private readonly transactionModel: Model<ReconTransaction>,
    @InjectModel(ReconEvent.name)
    private readonly eventModel: Model<ReconEvent>,
    @InjectModel(ReconAuditLog.name)
    private readonly auditModel: Model<ReconAuditLog>,
    @InjectModel(ReconAdjustment.name)
    private readonly adjustmentModel: Model<ReconAdjustment>,
  ) {}

  async enqueueForUpload(uploadId: string) {
    if (!uploadId) return;
    setImmediate(() => {
      void this.reconcileUpload(uploadId);
    });
  }

  async reconcileUpload(uploadId: string) {
    const upload = await this.uploadModel.findById(uploadId).lean().exec();
    if (!upload || upload.status !== 'completed') return;

    const agg = await this.rowModel
      .aggregate<RowAggregate>([
        { $match: { uploadId } },
        {
          $addFields: {
            docUpper: { $toUpper: { $ifNull: ['$documentType', ''] } },
            canonicalKey: {
              $ifNull: [
                '$orderID',
                {
                  $concat: [
                    'inv:',
                    { $ifNull: ['$invoiceNo', 'na'] },
                    '|sku:',
                    { $ifNull: ['$skuID', 'na'] },
                  ],
                },
              ],
            },
            eventType: {
              $switch: {
                branches: [
                  {
                    case: {
                      $or: [
                        {
                          $regexMatch: { input: '$docUpper', regex: 'RETURN' },
                        },
                        { $regexMatch: { input: '$docUpper', regex: 'RTO' } },
                      ],
                    },
                    then: 'return',
                  },
                  {
                    case: {
                      $regexMatch: { input: '$docUpper', regex: 'SALE' },
                    },
                    then: 'sale',
                  },
                  {
                    case: {
                      $gt: [{ $ifNull: ['$finalSettlementAmount', 0] }, 0],
                    },
                    then: 'settlement',
                  },
                ],
                default: 'unknown',
              },
            },
          },
        },
        {
          $group: {
            _id: { canonicalKey: '$canonicalKey', eventType: '$eventType' },
            rowCount: { $sum: 1 },
            quantity: { $sum: { $ifNull: ['$quantity', 0] } },
            invoiceAmount: { $sum: { $ifNull: ['$invoiceAmount', 0] } },
            settlementAmount: {
              $sum: { $ifNull: ['$finalSettlementAmount', 0] },
            },
            firstDate: { $min: '$invoiceDate' },
            lastDate: { $max: '$invoiceDate' },
            orderId: { $first: '$orderID' },
            skuId: { $first: '$skuID' },
            invoiceNo: { $first: '$invoiceNo' },
          },
        },
      ])
      .exec();

    if (!agg.length) return;

    const transactionOps: Array<Record<string, unknown>> = [];
    const eventOps: Array<Record<string, unknown>> = [];
    const adjustmentDocs: Array<Record<string, unknown>> = [];
    const byKey = new Map<string, Record<string, RowAggregate>>();
    const existingTransactions = await this.transactionModel
      .find({
        sellerId: String(upload.sellerId),
        marketplace: String(upload.marketplace),
        canonicalKey: { $in: agg.map((item) => item._id.canonicalKey) },
      })
      .lean()
      .exec();
    const existingByKey = new Map(
      existingTransactions.map((item) => [item.canonicalKey, item]),
    );

    for (const item of agg) {
      const key = item._id.canonicalKey;
      const eventType = item._id.eventType;
      if (!byKey.has(key)) byKey.set(key, {});
      byKey.get(key)![eventType] = item;

      eventOps.push({
        updateOne: {
          filter: {
            uploadId,
            canonicalKey: key,
            eventType,
          },
          update: {
            $setOnInsert: {
              sellerId: String(upload.sellerId),
              marketplace: String(upload.marketplace),
              reportMonth: upload.reportMonth,
              eventDate: item.lastDate,
              orderId: item.orderId,
              skuId: item.skuId,
              invoiceNo: item.invoiceNo,
              rowCount: item.rowCount,
              quantity: item.quantity,
              invoiceAmount: item.invoiceAmount,
              settlementAmount: item.settlementAmount,
            },
          },
          upsert: true,
        },
      });
    }

    for (const [canonicalKey, grouped] of byKey.entries()) {
      const sale = grouped.sale;
      const ret = grouped.return;
      const setl = grouped.settlement;
      const status = this.resolveStatus({
        hasSale: Boolean(sale),
        hasReturn: Boolean(ret),
        hasSettlement: Boolean(setl),
      });

      transactionOps.push({
        updateOne: {
          filter: {
            sellerId: String(upload.sellerId),
            marketplace: String(upload.marketplace),
            canonicalKey,
          },
          update: {
            $setOnInsert: {
              sellerId: String(upload.sellerId),
              gstId: String(upload.gstId),
              gstin: String(upload.gstin),
              marketplace: String(upload.marketplace),
              canonicalKey,
              orderId: sale?.orderId ?? ret?.orderId ?? setl?.orderId,
              skuId: sale?.skuId ?? ret?.skuId ?? setl?.skuId,
              invoiceNo: sale?.invoiceNo ?? ret?.invoiceNo ?? setl?.invoiceNo,
              firstReportMonth: upload.reportMonth,
            },
            $set: {
              lastReportMonth: upload.reportMonth,
              firstEventDate:
                sale?.firstDate ?? ret?.firstDate ?? setl?.firstDate,
              lastEventDate: setl?.lastDate ?? ret?.lastDate ?? sale?.lastDate,
              status,
              lastReconciledUploadId: uploadId,
            },
            $inc: {
              totalSalesRows: sale?.rowCount ?? 0,
              totalReturnRows: ret?.rowCount ?? 0,
              totalSalesQty: sale?.quantity ?? 0,
              totalReturnQty: ret?.quantity ?? 0,
              totalSalesAmount: sale?.invoiceAmount ?? 0,
              totalReturnAmount: ret?.invoiceAmount ?? 0,
              totalSettlementAmount: setl?.settlementAmount ?? 0,
            },
          },
          upsert: true,
        },
      });

      const existing = existingByKey.get(canonicalKey);
      if (
        existing?.firstReportMonth &&
        upload.reportMonth &&
        existing.firstReportMonth !== upload.reportMonth &&
        ((ret?.rowCount ?? 0) > 0 || (setl?.settlementAmount ?? 0) > 0)
      ) {
        adjustmentDocs.push({
          sellerId: String(upload.sellerId),
          gstId: String(upload.gstId),
          marketplace: String(upload.marketplace),
          transactionKey: canonicalKey,
          sourceUploadId: uploadId,
          sourceReportMonth: upload.reportMonth,
          affectedReportMonth: existing.firstReportMonth,
          previousStatus: existing.status,
          updatedStatus: status,
          deltaSalesAmount: sale?.invoiceAmount ?? 0,
          deltaReturnAmount: ret?.invoiceAmount ?? 0,
          deltaSettlementAmount: setl?.settlementAmount ?? 0,
          deltaReturnRows: ret?.rowCount ?? 0,
        });
      }
    }

    if (eventOps.length) {
      await this.eventModel.bulkWrite(eventOps as any, { ordered: false });
    }
    if (transactionOps.length) {
      await this.transactionModel.bulkWrite(transactionOps as any, {
        ordered: false,
      });
    }
    if (adjustmentDocs.length) {
      await this.adjustmentModel.insertMany(adjustmentDocs, { ordered: false });
    }

    await this.auditModel.create({
      sellerId: String(upload.sellerId),
      marketplace: String(upload.marketplace),
      uploadId,
      reportMonth: upload.reportMonth,
      rowsProcessed: agg.reduce((sum, a) => sum + a.rowCount, 0),
      keysMatched: byKey.size,
      transactionsUpdated: transactionOps.length,
      eventsCreated: eventOps.length,
      updatedBy: upload.uploadedBy || 'system',
      reason: 'upload_reconciliation',
      metadata: {
        marketplace: upload.marketplace,
        gstId: upload.gstId,
        adjustments: adjustmentDocs.length,
      },
    });

    this.logger.log(
      `Reconciled upload=${uploadId} keys=${byKey.size} tx=${transactionOps.length}`,
    );
  }

  async getAdjustmentNotifications(query: {
    sellerId: string;
    gstId: string;
    marketplace: string;
    reportMonth?: string;
  }) {
    const filter: Record<string, unknown> = {
      sellerId: query.sellerId,
      gstId: query.gstId,
      marketplace: query.marketplace,
    };
    if (query.reportMonth) {
      filter.sourceReportMonth = query.reportMonth;
    }

    const rows = await this.adjustmentModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()
      .exec();

    const byMonth = new Map<string, { count: number; returns: number }>();
    for (const row of rows) {
      const key = row.affectedReportMonth;
      if (!byMonth.has(key)) byMonth.set(key, { count: 0, returns: 0 });
      const bucket = byMonth.get(key)!;
      bucket.count += 1;
      bucket.returns += row.deltaReturnRows ?? 0;
    }

    const alerts = [...byMonth.entries()].map(([month, data]) => ({
      affectedMonth: month,
      impactedTransactions: data.count,
      message: `${data.count} order(s) in ${month} received updates from later uploads.`,
      returnRowsLinked: data.returns,
    }));

    return {
      success: true,
      data: {
        alerts,
        totalAdjustments: rows.length,
      },
    };
  }

  async getTransactionLifecycle(query: {
    sellerId: string;
    marketplace: string;
    orderId?: string;
    canonicalKey?: string;
  }) {
    const orderId = String(query.orderId ?? '').trim();
    const canonicalKey = String(query.canonicalKey ?? '').trim();
    if (!orderId && !canonicalKey) {
      return { success: true, data: null };
    }

    const tx = await this.transactionModel
      .findOne({
        sellerId: query.sellerId,
        marketplace: query.marketplace,
        ...(canonicalKey ? { canonicalKey } : { orderId }),
      })
      .lean()
      .exec();
    if (!tx) return { success: true, data: null };

    const events = await this.eventModel
      .find({
        sellerId: query.sellerId,
        marketplace: query.marketplace,
        canonicalKey: tx.canonicalKey,
      })
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    return {
      success: true,
      data: {
        transaction: tx,
        events: events.map((e) => ({
          eventType: e.eventType,
          reportMonth: e.reportMonth,
          eventDate: e.eventDate,
          quantity: e.quantity,
          invoiceAmount: e.invoiceAmount,
          settlementAmount: e.settlementAmount,
        })),
      },
    };
  }

  async getDualModeSummary(query: {
    sellerId: string;
    gstId: string;
    marketplace: string;
    reportMonth: string;
    mode: 'accounting' | 'lifecycle';
  }) {
    if (query.mode === 'accounting') {
      const rows = await this.rowModel
        .aggregate<{
          _id: string;
          rowCount: number;
          invoiceAmount: number;
          settlementAmount: number;
        }>([
          {
            $match: {
              sellerId: query.sellerId,
              marketplace: query.marketplace,
              reportMonth: query.reportMonth,
            },
          },
          {
            $addFields: {
              docUpper: { $toUpper: { $ifNull: ['$documentType', ''] } },
            },
          },
          {
            $group: {
              _id: {
                $switch: {
                  branches: [
                    {
                      case: {
                        $or: [
                          {
                            $regexMatch: {
                              input: '$docUpper',
                              regex: 'RETURN',
                            },
                          },
                          { $regexMatch: { input: '$docUpper', regex: 'RTO' } },
                        ],
                      },
                      then: 'returns',
                    },
                    {
                      case: {
                        $regexMatch: { input: '$docUpper', regex: 'SALE' },
                      },
                      then: 'sales',
                    },
                  ],
                  default: 'other',
                },
              },
              rowCount: { $sum: 1 },
              invoiceAmount: { $sum: { $ifNull: ['$invoiceAmount', 0] } },
              settlementAmount: {
                $sum: { $ifNull: ['$finalSettlementAmount', 0] },
              },
            },
          },
        ])
        .exec();

      return {
        success: true,
        data: {
          mode: 'accounting',
          reportMonth: query.reportMonth,
          buckets: rows,
        },
      };
    }

    const rows = await this.transactionModel
      .find({
        sellerId: query.sellerId,
        gstId: query.gstId,
        marketplace: query.marketplace,
        firstReportMonth: { $lte: query.reportMonth },
        lastReportMonth: { $gte: query.reportMonth },
      })
      .select(
        'canonicalKey orderId status totalSalesRows totalReturnRows totalSalesAmount totalReturnAmount totalSettlementAmount',
      )
      .lean()
      .exec();

    return {
      success: true,
      data: {
        mode: 'lifecycle',
        reportMonth: query.reportMonth,
        totals: {
          transactions: rows.length,
          salesAmount: rows.reduce((s, r) => s + (r.totalSalesAmount ?? 0), 0),
          returnAmount: rows.reduce(
            (s, r) => s + (r.totalReturnAmount ?? 0),
            0,
          ),
          settlementAmount: rows.reduce(
            (s, r) => s + (r.totalSettlementAmount ?? 0),
            0,
          ),
        },
        transactions: rows,
      },
    };
  }

  private resolveStatus(input: {
    hasSale: boolean;
    hasReturn: boolean;
    hasSettlement: boolean;
  }) {
    if (input.hasSale && input.hasReturn && input.hasSettlement)
      return 'completed';
    if (!input.hasSale && input.hasReturn) return 'returned_only';
    if (input.hasSale && input.hasReturn) return 'returned';
    if (input.hasSettlement) return 'settlement_updated';
    if (input.hasSale) return 'delivered';
    return 'pending';
  }
}
