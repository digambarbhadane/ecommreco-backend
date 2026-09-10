import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { PaymentDuplicateStrategy } from '../../core/payment-upload-summary.types';
import {
  FLIPKART_PAYMENT_SECONDARY_SHEETS,
  type FlipkartPaymentSecondarySheetDef,
  type FlipkartPaymentSecondarySheetKind,
} from './flipkart-payment-sheet-kinds';
import type { FlipkartPaymentSecondaryMeta } from './schemas/flipkart-payment-secondary-base';
import {
  FlipkartPaymentMpFeeRebate,
  FlipkartPaymentMpFeeRebateDocument,
} from './schemas/mp-fee-rebate.schema';
import {
  FlipkartPaymentNonOrderSpf,
  FlipkartPaymentNonOrderSpfDocument,
} from './schemas/non-order-spf.schema';
import {
  FlipkartPaymentStorageRecall,
  FlipkartPaymentStorageRecallDocument,
} from './schemas/storage-recall.schema';
import {
  FlipkartPaymentValueAddedServices,
  FlipkartPaymentValueAddedServicesDocument,
} from './schemas/value-added-services.schema';
import {
  FlipkartPaymentGoogleAdsServices,
  FlipkartPaymentGoogleAdsServicesDocument,
} from './schemas/google-ads-services.schema';
import {
  FlipkartPaymentAds,
  FlipkartPaymentAdsDocument,
} from './schemas/ads.schema';
import {
  FlipkartPaymentTcsRecovery,
  FlipkartPaymentTcsRecoveryDocument,
} from './schemas/tcs-recovery.schema';
import {
  FlipkartPaymentTds,
  FlipkartPaymentTdsDocument,
} from './schemas/tds.schema';

export type SecondaryUpsertPayload = Record<string, unknown> &
  FlipkartPaymentSecondaryMeta;

export type SecondaryBulkUpsertResult = {
  inserted: number;
  updated: number;
  skipped: number;
  duplicateRows: number;
};

export type SecondarySettlementByNeftQuery = {
  sellerId?: string;
  sellerIds?: string[];
  gstin?: string;
  marketplace?: string;
  reportMonth?: string;
  paymentDateFrom?: string;
  paymentDateTo?: string;
};

export type SecondarySettlementByNeftRow = {
  neftId: string;
  totals: Record<FlipkartPaymentSecondarySheetKind, number>;
  counts: Record<FlipkartPaymentSecondarySheetKind, number>;
};

export type SecondaryListByNeftIdsQuery = {
  sellerId?: string;
  sellerIds?: string[];
  gstin?: string;
  marketplace?: string;
  neftIds: string[];
};

type SecondaryModel = Model<
  | FlipkartPaymentMpFeeRebateDocument
  | FlipkartPaymentNonOrderSpfDocument
  | FlipkartPaymentStorageRecallDocument
  | FlipkartPaymentValueAddedServicesDocument
  | FlipkartPaymentGoogleAdsServicesDocument
  | FlipkartPaymentAdsDocument
  | FlipkartPaymentTcsRecoveryDocument
  | FlipkartPaymentTdsDocument
>;

@Injectable()
export class FlipkartPaymentSecondaryRepository {
  private readonly modelsByKind: Record<
    FlipkartPaymentSecondarySheetKind,
    SecondaryModel
  >;

  constructor(
    @InjectModel(FlipkartPaymentMpFeeRebate.name)
    mpFeeRebateModel: Model<FlipkartPaymentMpFeeRebateDocument>,
    @InjectModel(FlipkartPaymentNonOrderSpf.name)
    nonOrderSpfModel: Model<FlipkartPaymentNonOrderSpfDocument>,
    @InjectModel(FlipkartPaymentStorageRecall.name)
    storageRecallModel: Model<FlipkartPaymentStorageRecallDocument>,
    @InjectModel(FlipkartPaymentValueAddedServices.name)
    valueAddedServicesModel: Model<FlipkartPaymentValueAddedServicesDocument>,
    @InjectModel(FlipkartPaymentGoogleAdsServices.name)
    googleAdsServicesModel: Model<FlipkartPaymentGoogleAdsServicesDocument>,
    @InjectModel(FlipkartPaymentAds.name)
    adsModel: Model<FlipkartPaymentAdsDocument>,
    @InjectModel(FlipkartPaymentTcsRecovery.name)
    tcsRecoveryModel: Model<FlipkartPaymentTcsRecoveryDocument>,
    @InjectModel(FlipkartPaymentTds.name)
    tdsModel: Model<FlipkartPaymentTdsDocument>,
  ) {
    this.modelsByKind = {
      mpFeeRebate: mpFeeRebateModel,
      nonOrderSpf: nonOrderSpfModel,
      storageRecall: storageRecallModel,
      valueAddedServices: valueAddedServicesModel,
      googleAdsServices: googleAdsServicesModel,
      ads: adsModel,
      tcsRecovery: tcsRecoveryModel,
      tds: tdsModel,
    };
  }

  private getModel(kind: FlipkartPaymentSecondarySheetKind): SecondaryModel {
    return this.modelsByKind[kind];
  }

  async bulkUpsert(
    kind: FlipkartPaymentSecondarySheetKind,
    rows: SecondaryUpsertPayload[],
    duplicateStrategy: PaymentDuplicateStrategy = 'update',
  ): Promise<SecondaryBulkUpsertResult> {
    if (!rows.length) {
      return { inserted: 0, updated: 0, skipped: 0, duplicateRows: 0 };
    }

    // Replace month-scoped rows on update so every sheet line is stored cleanly
    // (avoids silent upsert/rowKey collisions leaving collections empty/partial).
    if (duplicateStrategy === 'update') {
      return this.replaceSheetRows(kind, rows);
    }

    const model = this.getModel(kind);

    const dedupeKeys = rows.map(
      (row) =>
        `${row.sellerId}::${row.marketplace}::${row.rowKey}::${row.reportMonth ?? ''}`,
    );
    const duplicateRows = dedupeKeys.length - new Set(dedupeKeys).size;

    const existing = await model
      .find({
        $or: rows.map((row) => ({
          sellerId: row.sellerId,
          marketplace: row.marketplace,
          rowKey: row.rowKey,
          reportMonth: row.reportMonth ?? null,
        })),
      })
      .select({ sellerId: 1, marketplace: 1, rowKey: 1, reportMonth: 1 })
      .lean()
      .exec();

    const existingKeys = new Set(
      (existing as unknown as Array<Record<string, unknown>>).map(
        (doc) =>
          `${doc.sellerId}::${doc.marketplace}::${doc.rowKey}::${doc.reportMonth ?? ''}`,
      ),
    );

    const toInsert = rows.filter(
      (row) =>
        !existingKeys.has(
          `${row.sellerId}::${row.marketplace}::${row.rowKey}::${row.reportMonth ?? ''}`,
        ),
    );

    if (toInsert.length) {
      await model.insertMany(toInsert, { ordered: false });
    }

    return {
      inserted: toInsert.length,
      updated: 0,
      skipped: rows.length - toInsert.length,
      duplicateRows,
    };
  }

  /**
   * Delete existing rows for the same seller / marketplace / month,
   * then insert every line from the current workbook.
   */
  private async replaceSheetRows(
    kind: FlipkartPaymentSecondarySheetKind,
    rows: SecondaryUpsertPayload[],
  ): Promise<SecondaryBulkUpsertResult> {
    const model = this.getModel(kind);
    const scopes = new Map<
      string,
      { sellerId: string; marketplace: string; reportMonth?: string }
    >();
    for (const row of rows) {
      const key = `${row.sellerId}::${row.marketplace}::${row.reportMonth ?? ''}`;
      if (!scopes.has(key)) {
        scopes.set(key, {
          sellerId: row.sellerId,
          marketplace: row.marketplace,
          reportMonth: row.reportMonth,
        });
      }
    }

    for (const scope of scopes.values()) {
      const filter: Record<string, unknown> = {
        sellerId: scope.sellerId,
        marketplace: scope.marketplace,
      };
      if (scope.reportMonth) {
        filter.reportMonth = scope.reportMonth;
      }
      await model.deleteMany(filter).exec();
    }

    // Guarantee unique rowKeys within the batch.
    const prepared = rows.map((row, index) => ({
      ...row,
      rowKey: `${String(row.rowKey || 'row')}::batch::${index}`,
    }));

    try {
      await model.insertMany(prepared, { ordered: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Partial insert can still succeed with ordered:false duplicate errors.
      if (!/E11000|duplicate key/i.test(message)) {
        throw error;
      }
    }

    const inserted = await model.countDocuments({
      uploadId: prepared[0]?.uploadId,
    });

    return {
      inserted: inserted || prepared.length,
      updated: 0,
      skipped: 0,
      duplicateRows: 0,
    };
  }

  async sumSettlementByNeft(
    query: SecondarySettlementByNeftQuery,
  ): Promise<SecondarySettlementByNeftRow[]> {
    const totalsByNeft = new Map<string, Record<string, number>>();
    const countsByNeft = new Map<string, Record<string, number>>();

    const emptyBucket = (): Record<string, number> => {
      const bucket: Record<string, number> = {};
      for (const def of FLIPKART_PAYMENT_SECONDARY_SHEETS) bucket[def.kind] = 0;
      return bucket;
    };

    const ensureNeft = (neftId: string) => {
      if (!totalsByNeft.has(neftId)) {
        totalsByNeft.set(neftId, emptyBucket());
        countsByNeft.set(neftId, emptyBucket());
      }
    };

    const sheetRows = await Promise.all(
      FLIPKART_PAYMENT_SECONDARY_SHEETS.map(async (def) => {
        const model = this.getModel(def.kind);
        const filter = this.buildFilter(query, def);
        const rows = await model
          .aggregate<{ _id: string; total: number; count: number }>([
            { $match: filter },
            {
              $group: {
                _id: { $trim: { input: { $ifNull: ['$neftId', ''] } } },
                total: { $sum: { $ifNull: ['$settlementValue', 0] } },
                count: { $sum: 1 },
              },
            },
            { $match: { _id: { $ne: '' } } },
          ])
          .exec();
        return { def, rows };
      }),
    );

    for (const { def, rows } of sheetRows) {
      for (const row of rows) {
        const neftId = row._id;
        ensureNeft(neftId);
        totalsByNeft.get(neftId)![def.kind] = Number(row.total ?? 0);
        countsByNeft.get(neftId)![def.kind] = Number(row.count ?? 0);
      }
    }

    return Array.from(totalsByNeft.keys())
      .sort()
      .map((neftId) => ({
        neftId,
        totals: totalsByNeft.get(neftId) as Record<
          FlipkartPaymentSecondarySheetKind,
          number
        >,
        counts: countsByNeft.get(neftId) as Record<
          FlipkartPaymentSecondarySheetKind,
          number
        >,
      }));
  }

  async listByNeftIds(
    query: SecondaryListByNeftIdsQuery,
  ): Promise<
    Record<FlipkartPaymentSecondarySheetKind, Array<Record<string, unknown>>>
  > {
    const result = {} as Record<
      FlipkartPaymentSecondarySheetKind,
      Array<Record<string, unknown>>
    >;

    const neftIds = query.neftIds.filter(Boolean);
    if (!neftIds.length) {
      for (const def of FLIPKART_PAYMENT_SECONDARY_SHEETS)
        result[def.kind] = [];
      return result;
    }

    const baseFilter = this.buildFilter(query);

    await Promise.all(
      FLIPKART_PAYMENT_SECONDARY_SHEETS.map(async (def) => {
        const model = this.getModel(def.kind);
        const docs = await model
          .find({ ...baseFilter, neftId: { $in: neftIds } })
          .limit(2000)
          .lean()
          .exec();
        result[def.kind] = docs as unknown as Array<Record<string, unknown>>;
      }),
    );

    return result;
  }

  async listByKind(
    kind: FlipkartPaymentSecondarySheetKind,
    query: {
      sellerId?: string;
      sellerIds?: string[];
      gstin?: string;
      marketplace?: string;
      neftId?: string;
      paymentDateFrom?: string;
      paymentDateTo?: string;
      search?: string;
      limit?: number;
      skip?: number;
    },
  ): Promise<{ data: Array<Record<string, unknown>>; total: number }> {
    const model = this.getModel(kind);
    const filter = this.buildFilter(query);
    if (query.neftId) filter.neftId = String(query.neftId).trim();
    const search = String(query.search ?? '').trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { neftId: { $regex: escaped, $options: 'i' } },
        { serviceName: { $regex: escaped, $options: 'i' } },
        { campaignTransactionId: { $regex: escaped, $options: 'i' } },
        { claimId: { $regex: escaped, $options: 'i' } },
        { orderId: { $regex: escaped, $options: 'i' } },
        { transactionId: { $regex: escaped, $options: 'i' } },
        { refId: { $regex: escaped, $options: 'i' } },
      ];
    }

    const limit = Math.min(Math.max(1, query.limit ?? 50), 500);
    const skip = Math.max(0, query.skip ?? 0);

    const [data, total] = await Promise.all([
      model
        .find(filter)
        .sort({ paymentDate: -1, neftId: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      model.countDocuments(filter).exec(),
    ]);

    return {
      data: data as unknown as Array<Record<string, unknown>>,
      total,
    };
  }

  private buildFilter(
    query: {
      sellerId?: string;
      sellerIds?: string[];
      gstin?: string;
      marketplace?: string;
      reportMonth?: string;
      paymentDateFrom?: string;
      paymentDateTo?: string;
    },
    def?: FlipkartPaymentSecondarySheetDef,
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

    const hasPaymentDateField = !def || Boolean(def.fields.paymentDate);
    if (hasPaymentDateField && (query.paymentDateFrom || query.paymentDateTo)) {
      const paymentDate: Record<string, string> = {};
      if (query.paymentDateFrom) paymentDate.$gte = query.paymentDateFrom;
      if (query.paymentDateTo) paymentDate.$lte = query.paymentDateTo;
      filter.paymentDate = paymentDate;
    }

    return filter;
  }
}
