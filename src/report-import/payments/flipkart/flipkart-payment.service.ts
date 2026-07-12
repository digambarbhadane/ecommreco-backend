import { Injectable, Logger } from '@nestjs/common';
import type {
  PaymentDuplicateStrategy,
  PaymentUploadContext,
  PaymentUploadSummary,
} from '../core/payment-upload-summary.types';
import { FlipkartPaymentParser } from './flipkart-payment.parser';
import { FlipkartPaymentRepository } from './flipkart-payment.repository';
import type { FlipkartPaymentUpsertPayload } from './flipkart-payment.types';

export type FlipkartPaymentProcessInput = PaymentUploadContext & {
  buffer: Buffer;
  duplicateStrategy?: PaymentDuplicateStrategy;
};

@Injectable()
export class FlipkartPaymentService {
  private readonly logger = new Logger(FlipkartPaymentService.name);

  constructor(
    private readonly parser: FlipkartPaymentParser,
    private readonly repository: FlipkartPaymentRepository,
  ) {}

  async processUpload(input: FlipkartPaymentProcessInput): Promise<PaymentUploadSummary> {
    const started = Date.now();
    const duplicateStrategy = input.duplicateStrategy ?? 'update';

    const parsed = this.parser.parse(input.buffer, input.uploadedFileName);
    const uploadedAt = new Date();

    const payloads: FlipkartPaymentUpsertPayload[] = parsed.rows.map((row) => ({
      ...row,
      marketplace: input.marketplace,
      sellerId: input.sellerId,
      gstId: input.gstId,
      gstin: input.gstin,
      reportMonth: input.reportMonth,
      reportType: 'payment',
      uploadedFileName: input.uploadedFileName,
      sheetName: parsed.meta.sheetName,
      uploadId: input.uploadId,
      uploadedAt,
    }));

    const upsertResult = await this.repository.bulkUpsert(
      payloads,
      duplicateStrategy,
    );

    const summary: PaymentUploadSummary = {
      totalRows: parsed.totalRawRows,
      parsedRows: parsed.rows.length,
      insertedRows: upsertResult.inserted,
      updatedRows: upsertResult.updated,
      skippedRows: upsertResult.skipped,
      duplicateRows: upsertResult.duplicateRows,
      invalidRows: parsed.invalidRowCount,
      validationErrors: parsed.validationErrors.slice(0, 100),
      processingTimeMs: Date.now() - started,
      sheetName: parsed.meta.sheetName,
    };

    this.logger.log(
      `Flipkart payment upload ${input.uploadId}: parsed=${summary.parsedRows} inserted=${summary.insertedRows} updated=${summary.updatedRows} invalid=${summary.invalidRows} (${summary.processingTimeMs}ms)`,
    );

    return summary;
  }

  async listPaymentsForImportRowEnrichment(query: {
    sellerId: string;
    gstin: string;
    marketplace: string;
    reportMonth: string;
    uploadId: string;
  }) {
    return this.repository.listForImportRowEnrichment(query);
  }

  /** Legacy enrichment fields for import_rows backward compatibility. */
  toImportRowEnrichment(row: FlipkartPaymentUpsertPayload) {
    return {
      finalSettlementAmount: row.bankSettlementValue,
      transactionId: row.neftId,
      paymentDate: row.paymentDate,
    };
  }
}
