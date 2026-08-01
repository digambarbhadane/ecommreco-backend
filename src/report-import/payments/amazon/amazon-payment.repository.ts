import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { chunkArray } from '../../../common/utils/mongo-batch.util';
import type { PaymentDuplicateStrategy } from '../core/payment-upload-summary.types';
import {
  AmazonPaymentTransaction,
  AmazonPaymentTransactionDocument,
} from './schemas/amazon-payment-transaction.schema';
import type { AmazonPaymentInsertPayload } from './amazon-payment.types';

export type AmazonPaymentWriteResult = {
  inserted: number;
  updated: number;
  skipped: number;
  duplicateRows: number;
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
      return { inserted: 0, updated: 0, skipped: rows.length, duplicateRows: 0 };
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

  private async deleteConflictingRowKeys(
    rows: AmazonPaymentInsertPayload[],
    session?: ClientSession,
  ) {
    if (!rows.length) return;
    const first = rows[0]!;
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

