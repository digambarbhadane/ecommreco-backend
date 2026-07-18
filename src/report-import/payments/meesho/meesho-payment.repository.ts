import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { MeeshoPaymentImportMeta } from './schemas/meesho-payment-meta';
import type { MeeshoPaymentSheetKind } from './meesho-payment-sheet-kinds';
import {
  MeeshoOrderPayments,
  MeeshoOrderPaymentsDocument,
} from './schemas/order-payments.schema';
import { MeeshoAdsCost, MeeshoAdsCostDocument } from './schemas/ads-cost.schema';
import {
  MeeshoReferralPayments,
  MeeshoReferralPaymentsDocument,
} from './schemas/referral-payments.schema';
import {
  MeeshoCompensationRecovery,
  MeeshoCompensationRecoveryDocument,
} from './schemas/compensation-recovery.schema';
import type { MeeshoOrderPaymentsMappedRow } from './meesho-payment-order.mapper';

export type MeeshoPaymentInsertScope = {
  sellerId: string;
  marketplace: string;
  reportMonth?: string;
  importId: string;
};

export type MeeshoPaymentSheetInsertResult = {
  inserted: number;
  failed: number;
};

export type MeeshoPaymentBulkInsertResult = {
  orderPayments: MeeshoPaymentSheetInsertResult;
  adsCost: MeeshoPaymentSheetInsertResult;
  referralPayments: MeeshoPaymentSheetInsertResult;
  compensationRecovery: MeeshoPaymentSheetInsertResult;
};

type SheetPayload = Record<string, unknown>;

@Injectable()
export class MeeshoPaymentRepository {
  private readonly logger = new Logger(MeeshoPaymentRepository.name);

  constructor(
    @InjectModel(MeeshoOrderPayments.name)
    private readonly orderPaymentsModel: Model<MeeshoOrderPaymentsDocument>,
    @InjectModel(MeeshoAdsCost.name)
    private readonly adsCostModel: Model<MeeshoAdsCostDocument>,
    @InjectModel(MeeshoReferralPayments.name)
    private readonly referralPaymentsModel: Model<MeeshoReferralPaymentsDocument>,
    @InjectModel(MeeshoCompensationRecovery.name)
    private readonly compensationRecoveryModel: Model<MeeshoCompensationRecoveryDocument>,
  ) {}

  private modelForKind(kind: MeeshoPaymentSheetKind): Model<unknown> {
    switch (kind) {
      case 'orderPayments':
        return this.orderPaymentsModel;
      case 'adsCost':
        return this.adsCostModel;
      case 'referralPayments':
        return this.referralPaymentsModel;
      case 'compensationRecovery':
        return this.compensationRecoveryModel;
      default:
        throw new Error(`Unknown Meesho payment sheet kind: ${kind}`);
    }
  }

  private buildMeta(
    meta: Omit<MeeshoPaymentImportMeta, 'marketplace' | 'sheetName'>,
    sheetName: string,
  ): Omit<MeeshoPaymentImportMeta, 'sellerId' | 'importId' | 'marketplace'> & {
    marketplace: 'meesho';
    sheetName: string;
  } {
    return {
      marketplace: 'meesho',
      importedAt: meta.importedAt,
      gstId: meta.gstId,
      gstin: meta.gstin,
      reportMonth: meta.reportMonth,
      uploadedFileName: meta.uploadedFileName,
      sheetName,
    };
  }

  private toObjectIds(meta: {
    sellerId: string;
    importId: string;
  }): {
    sellerId: Types.ObjectId;
    importId: Types.ObjectId;
  } {
    return {
      sellerId: new Types.ObjectId(meta.sellerId),
      importId: new Types.ObjectId(meta.importId),
    };
  }

  async deleteImportScope(scope: MeeshoPaymentInsertScope): Promise<void> {
    const filter: Record<string, unknown> = {
      sellerId: new Types.ObjectId(scope.sellerId),
      marketplace: 'meesho',
    };
    if (scope.reportMonth) {
      filter.reportMonth = scope.reportMonth;
    }

    await Promise.all(
      (['orderPayments', 'adsCost', 'referralPayments', 'compensationRecovery'] as const).map(
        (kind) => this.modelForKind(kind).deleteMany(filter).exec(),
      ),
    );
  }

  async bulkInsertAll(
    scope: MeeshoPaymentInsertScope,
    metaBase: Omit<MeeshoPaymentImportMeta, 'marketplace' | 'sheetName'>,
    data: {
      orderPayments: MeeshoOrderPaymentsMappedRow[];
      adsCost: Record<string, string | number | Date | null>[];
      referralPayments: Record<string, string | number | Date | null>[];
      compensationRecovery: Record<string, string | number | Date | null>[];
    },
    sheetNames: Partial<Record<MeeshoPaymentSheetKind, string>>,
  ): Promise<MeeshoPaymentBulkInsertResult> {
    await this.deleteImportScope(scope);

    const ids = this.toObjectIds({
      sellerId: metaBase.sellerId,
      importId: metaBase.importId,
    });

    const result: MeeshoPaymentBulkInsertResult = {
      orderPayments: await this.insertSheet(
        'orderPayments',
        data.orderPayments.map((row) => ({
          ...row,
          ...this.buildMeta(metaBase, sheetNames.orderPayments ?? 'Order Payments'),
          ...ids,
          marketplace: 'meesho',
        })),
      ),
      adsCost: await this.insertSheet(
        'adsCost',
        data.adsCost.map((row) => ({
          ...row,
          ...this.buildMeta(metaBase, sheetNames.adsCost ?? 'Ads Cost'),
          ...ids,
          marketplace: 'meesho',
        })),
      ),
      referralPayments: await this.insertSheet(
        'referralPayments',
        data.referralPayments.map((row) => ({
          ...row,
          ...this.buildMeta(
            metaBase,
            sheetNames.referralPayments ?? 'Referral Payments',
          ),
          ...ids,
          marketplace: 'meesho',
        })),
      ),
      compensationRecovery: await this.insertSheet(
        'compensationRecovery',
        data.compensationRecovery.map((row) => ({
          ...row,
          ...this.buildMeta(
            metaBase,
            sheetNames.compensationRecovery ?? 'Compensation and Recovery',
          ),
          ...ids,
          marketplace: 'meesho',
        })),
      ),
    };

    return result;
  }

  private async insertSheet(
    kind: MeeshoPaymentSheetKind,
    rows: SheetPayload[],
  ): Promise<MeeshoPaymentSheetInsertResult> {
    if (!rows.length) {
      return { inserted: 0, failed: 0 };
    }

    const model = this.modelForKind(kind);
    try {
      const inserted = await model.insertMany(rows, { ordered: false });
      return { inserted: inserted.length, failed: 0 };
    } catch (error) {
      const bulkError = error as {
        insertedDocs?: unknown[];
        writeErrors?: unknown[];
        message?: string;
      };
      const insertedCount = bulkError.insertedDocs?.length ?? 0;
      const failedCount =
        bulkError.writeErrors?.length ?? Math.max(0, rows.length - insertedCount);
      if (insertedCount > 0 || /E11000|duplicate key/i.test(String(bulkError.message))) {
        return { inserted: insertedCount || rows.length - failedCount, failed: failedCount };
      }
      throw error;
    }
  }
}
