import { Injectable, Logger } from '@nestjs/common';
import type {
  PaymentUploadContext,
  PaymentUploadSummary,
} from '../core/payment-upload-summary.types';
import type { AmazonPaymentInsertPayload } from './amazon-payment.types';
import { AmazonPaymentParser } from './amazon-payment.parser';
import { AmazonPaymentRepository } from './amazon-payment.repository';
import { SettlementService } from '../../../settlement/settlement.service';
import type {
  NormalizedTransaction,
  SettlementCalculationRole,
} from '../../../settlement/schemas/normalized-transaction.schema';

export type AmazonPaymentProcessInput = PaymentUploadContext & {
  buffer: Buffer;
};

@Injectable()
export class AmazonPaymentService {
  private readonly logger = new Logger(AmazonPaymentService.name);

  constructor(
    private readonly parser: AmazonPaymentParser,
    private readonly repository: AmazonPaymentRepository,
    private readonly settlementService: SettlementService,
  ) {}

  async processUpload(
    input: AmazonPaymentProcessInput,
  ): Promise<PaymentUploadSummary> {
    const started = Date.now();
    const parsed = this.parser.parse(input.buffer);
    const uploadedAt = new Date();
    const rows = parsed.rows.map((row) => ({
      ...row,
      sellerId: input.sellerId,
      gstId: input.gstId,
      gstin: input.gstin,
      marketplace: input.marketplace,
      reportMonth: input.reportMonth,
      uploadId: input.uploadId,
      uploadedFileName: input.uploadedFileName,
      sheetName: parsed.sheetName,
      uploadedAt,
    }));
    const writeResult = await this.repository.saveRows(
      rows,
      input.duplicateStrategy,
    );
    const normalized = rows
      .filter((row) => String(row.orderId ?? '').trim())
      .map((row) => this.normalizeTransaction(row))
      .filter(
        (row) =>
          row.calculationRole !== 'sale' && row.calculationRole !== 'return',
      );
    await this.settlementService.replaceNormalizedUpload(
      input.uploadId,
      normalized,
    );

    const summary: PaymentUploadSummary = {
      totalRows: parsed.totalRawRows,
      parsedRows: parsed.rows.length,
      insertedRows: writeResult.inserted,
      updatedRows: writeResult.updated,
      skippedRows: parsed.blankRows,
      duplicateRows: writeResult.duplicateRows,
      invalidRows: parsed.invalidRowCount,
      validationErrors: parsed.validationErrors.map((reason) => {
        const rowNumber = Number(reason.match(/^Row (\d+):/)?.[1] ?? 0);
        return {
          rowNumber,
          column: 'Amazon Payment Report',
          reason,
        };
      }),
      processingTimeMs: Date.now() - started,
      sheetName: parsed.sheetName,
    };

    this.logger.log(
      `Amazon payment upload ${input.uploadId}: parsed=${summary.parsedRows} inserted=${summary.insertedRows} updated=${summary.updatedRows} blank=${parsed.blankRows} invalid=${summary.invalidRows} (${summary.processingTimeMs}ms)`,
    );
    if (parsed.validationErrors.length) {
      this.logger.warn(
        `Amazon payment upload ${input.uploadId} skipped malformed rows: ${parsed.validationErrors.slice(0, 20).join('; ')}`,
      );
    }
    return summary;
  }

  private normalizeTransaction(
    row: AmazonPaymentInsertPayload,
  ): NormalizedTransaction {
    const description = String(row.amountDescription ?? '').trim();
    const haystack = `${row.transactionType} ${description}`
      .trim()
      .toLowerCase();
    const role = this.resolveRole(haystack, description);
    const category = this.resolveCategory(description.toLowerCase(), role);
    return {
      sellerId: row.sellerId,
      gstId: row.gstId,
      gstin: row.gstin,
      marketplace: 'amazon',
      settlementId: row.settlementId,
      settlementDate: new Date(row.depositDate),
      orderId: row.orderId,
      transactionType: row.transactionType || 'transaction',
      transactionCategory: category,
      transactionName: description || row.transactionType || 'Transaction',
      calculationRole: role,
      amount: Number(row.amount ?? 0),
      currency: 'INR',
      contributesToReceived: true,
      disputed: false,
      sourceType: 'amazon-payment',
      sourceId: row.rowKey,
      uploadId: row.uploadId,
      reportMonth: row.reportMonth,
      metadata: { sourceRowNumber: row.sourceRowNumber },
    };
  }

  private resolveRole(
    haystack: string,
    description: string,
  ): SettlementCalculationRole {
    const isSaleComponent = /principal|product tax/.test(
      description.toLowerCase(),
    );
    if (isSaleComponent && /refund|return/.test(haystack)) return 'return';
    if (isSaleComponent) return 'sale';
    if (/claim|reimbursement/.test(haystack)) return 'adjustment';
    return 'expense';
  }

  private resolveCategory(
    value: string,
    role: SettlementCalculationRole,
  ): string {
    if (role === 'sale') return 'Sales';
    if (role === 'return') return 'Returns';
    const categories: Array<[RegExp, string]> = [
      [/commission/, 'Commission'],
      [/shipping|postage|logistics|easy ship/, 'Shipping'],
      [/advert|sponsored|servicefee|service fee/, 'Advertising'],
      [/\btds\b/, 'TDS'],
      [/\btcs\b/, 'TCS'],
      [/\bgst\b|\bigst\b|\bcgst\b|\bsgst\b/, 'GST'],
      [/storage/, 'Storage'],
      [/penalty/, 'Penalty'],
      [/claim/, 'Claims'],
      [/reimbursement/, 'Reimbursement'],
      [/promotion|promo|discount/, 'Promotion'],
      [/adjustment/, 'Adjustment'],
      [/fee|charge/, 'Marketplace Fee'],
    ];
    return categories.find(([pattern]) => pattern.test(value))?.[1] ?? 'Others';
  }
}
