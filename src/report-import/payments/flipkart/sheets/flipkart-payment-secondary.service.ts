import { Injectable, Logger } from '@nestjs/common';
import type {
  PaymentDuplicateStrategy,
  PaymentUploadContext,
} from '../../core/payment-upload-summary.types';
import { mapSecondarySheetRow } from './flipkart-payment-secondary.mapper';
import {
  FlipkartPaymentSecondaryRepository,
  type SecondaryUpsertPayload,
} from './flipkart-payment-secondary.repository';
import type { FlipkartPaymentSecondarySheetKind } from './flipkart-payment-sheet-kinds';

export type SecondarySheetInput = {
  kind: FlipkartPaymentSecondarySheetKind;
  sheetName: string;
  rows: Record<string, unknown>[];
};

export type ProcessSecondarySheetsInput = PaymentUploadContext & {
  uploadedFileName: string;
  sheets: SecondarySheetInput[];
  duplicateStrategy?: PaymentDuplicateStrategy;
};

export type SecondarySheetProcessResult = {
  parsedRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  invalid: number;
  neftIds: string[];
};

@Injectable()
export class FlipkartPaymentSecondaryService {
  private readonly logger = new Logger(FlipkartPaymentSecondaryService.name);

  constructor(
    private readonly repository: FlipkartPaymentSecondaryRepository,
  ) {}

  async processSecondarySheets(
    input: ProcessSecondarySheetsInput,
  ): Promise<
    Record<FlipkartPaymentSecondarySheetKind, SecondarySheetProcessResult>
  > {
    const duplicateStrategy = input.duplicateStrategy ?? 'update';
    const uploadedAt = new Date();
    const result = {} as Record<
      FlipkartPaymentSecondarySheetKind,
      SecondarySheetProcessResult
    >;

    for (const sheet of input.sheets) {
      let invalid = 0;
      const payloads: SecondaryUpsertPayload[] = [];

      // Stamp line indexes before mapping so Storage_Recall (and any sheet with
      // repeat NEFT IDs) never collapses to a single upsert key.
      const indexedRows = sheet.rows.map((rawRow, index) =>
        rawRow.__lineIndex == null ? { ...rawRow, __lineIndex: index } : rawRow,
      );

      for (const rawRow of indexedRows) {
        const mapped = mapSecondarySheetRow(sheet.kind, rawRow);
        if (!mapped) {
          invalid += 1;
          continue;
        }
        payloads.push({
          ...mapped.fields,
          rowKey: mapped.rowKey,
          marketplace: input.marketplace,
          sellerId: input.sellerId,
          gstId: input.gstId,
          gstin: input.gstin,
          reportMonth: input.reportMonth,
          reportType: 'payment',
          uploadedFileName: input.uploadedFileName,
          sheetName: sheet.sheetName,
          uploadId: input.uploadId,
          uploadedAt,
        } as SecondaryUpsertPayload);
      }

      const upsertResult = await this.repository.bulkUpsert(
        sheet.kind,
        payloads,
        duplicateStrategy,
      );

      result[sheet.kind] = {
        parsedRows: payloads.length,
        inserted: upsertResult.inserted,
        updated: upsertResult.updated,
        skipped: upsertResult.skipped,
        invalid,
        neftIds: [
          ...new Set(
            payloads
              .map((row) => String(row.neftId ?? '').trim())
              .filter(Boolean),
          ),
        ],
      };

      this.logger.log(
        `Flipkart secondary sheet ${sheet.kind} (${sheet.sheetName}) upload ${input.uploadId}: inputRows=${indexedRows.length} parsed=${payloads.length} inserted=${upsertResult.inserted} updated=${upsertResult.updated} invalid=${invalid}`,
      );
    }

    return result;
  }
}
