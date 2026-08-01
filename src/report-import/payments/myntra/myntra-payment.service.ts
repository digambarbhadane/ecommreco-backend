import { Injectable, Logger } from '@nestjs/common';
import { parseGstinFromCell } from '../../config/importMappings/gst-column.util';
import type {
  PaymentUploadContext,
  PaymentUploadSummary,
} from '../core/payment-upload-summary.types';
import { extractSellerGstin } from './myntra-pg-field.util';
import { MyntraPgParser } from './myntra-pg.parser';
import { MyntraPgRepository } from './myntra-pg.repository';
import type {
  MyntraPgInsertPayload,
  MyntraPgParsedRow,
  MyntraPgReportKind,
} from './myntra-pg.types';

export type MyntraPgProcessInput = PaymentUploadContext & {
  buffer: Buffer;
  reportKind: MyntraPgReportKind;
};

export type MyntraPgUploadSummary = PaymentUploadSummary & {
  forwardRows?: number;
  reverseRows?: number;
  gstSkippedRows?: number;
};

@Injectable()
export class MyntraPaymentService {
  private readonly logger = new Logger(MyntraPaymentService.name);

  constructor(
    private readonly parser: MyntraPgParser,
    private readonly repository: MyntraPgRepository,
  ) {}

  async processUpload(input: MyntraPgProcessInput): Promise<MyntraPgUploadSummary> {
    const started = Date.now();
    const parsed = this.parser.parse(
      input.buffer,
      input.reportKind,
      input.uploadedFileName,
    );
    const selectedGstin = parseGstinFromCell(input.gstin) ?? '';
    const filtered = this.filterRowsBySelectedGstin(parsed.rows, selectedGstin);
    const uploadedAt = new Date();
    const payloads: MyntraPgInsertPayload[] = filtered.rows.map((row) => ({
      ...row,
      sellerId: input.sellerId,
      gstId: input.gstId,
      gstin: input.gstin,
      marketplace: input.marketplace,
      reportMonth: input.reportMonth,
      uploadId: input.uploadId,
      uploadedFileName: input.uploadedFileName,
      uploadedAt,
      fieldKeys: parsed.fieldKeys,
    }));

    const writeResult = await this.repository.saveRows(
      payloads,
      input.duplicateStrategy ?? 'update',
    );

    const summary: MyntraPgUploadSummary = {
      totalRows: parsed.totalRawRows,
      parsedRows: payloads.length,
      insertedRows: writeResult.inserted,
      updatedRows: writeResult.updated,
      skippedRows: writeResult.skipped + filtered.skippedCount,
      duplicateRows: writeResult.duplicateRows,
      invalidRows: parsed.invalidRowCount,
      validationErrors: parsed.validationErrors.map((reason) => {
        const rowNumber = Number(reason.match(/Row (\d+):/)?.[1] ?? 0);
        return {
          rowNumber,
          column: `Myntra PG ${input.reportKind === 'forward' ? 'Forward' : 'Reverse'}`,
          reason,
        };
      }),
      processingTimeMs: Date.now() - started,
      sheetName: parsed.sheetName,
      gstSkippedRows: filtered.skippedCount,
      ...(input.reportKind === 'forward'
        ? { forwardRows: payloads.length }
        : { reverseRows: payloads.length }),
    };

    this.logger.log(
      `Myntra PG ${input.reportKind} upload ${input.uploadId}: parsed=${summary.parsedRows} inserted=${summary.insertedRows} gstSkipped=${filtered.skippedCount} invalid=${summary.invalidRows}`,
    );
    return summary;
  }

  private filterRowsBySelectedGstin(
    rows: MyntraPgParsedRow[],
    selectedGstin: string,
  ): { rows: MyntraPgParsedRow[]; skippedCount: number } {
    if (!selectedGstin) {
      return { rows, skippedCount: 0 };
    }
    const matching: MyntraPgParsedRow[] = [];
    let skippedCount = 0;
    for (const row of rows) {
      const rowGstin = extractSellerGstin(row.rowData) || parseGstinFromCell(row.sellerGstn);
      if (rowGstin && rowGstin !== selectedGstin) {
        skippedCount += 1;
        continue;
      }
      matching.push(row);
    }
    return { rows: matching, skippedCount };
  }
}
