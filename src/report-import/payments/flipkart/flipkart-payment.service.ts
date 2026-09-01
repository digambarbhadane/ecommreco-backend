import { Injectable, Logger } from '@nestjs/common';
import type {
  PaymentDuplicateStrategy,
  PaymentUploadContext,
  PaymentUploadSummary,
} from '../core/payment-upload-summary.types';
import { FlipkartPaymentParser } from './flipkart-payment.parser';
import { FlipkartPaymentRepository } from './flipkart-payment.repository';
import type { FlipkartPaymentUpsertPayload } from './flipkart-payment.types';
import { FlipkartPaymentSecondaryService } from './sheets/flipkart-payment-secondary.service';
import { SettlementService } from '../../../settlement/settlement.service';
import type { NormalizedTransaction } from '../../../settlement/schemas/normalized-transaction.schema';

export type FlipkartPaymentProcessInput = PaymentUploadContext & {
  buffer: Buffer;
  duplicateStrategy?: PaymentDuplicateStrategy;
};

export type FlipkartPaymentUploadSummary = PaymentUploadSummary & {
  missingSheetLabels?: string[];
  /** Distinct NEFT IDs touched by this upload (orders + secondary). */
  neftIds?: string[];
  secondarySheets?: Record<
    string,
    {
      parsedRows: number;
      inserted: number;
      updated: number;
      skipped: number;
      invalid: number;
      neftIds?: string[];
    }
  >;
};

@Injectable()
export class FlipkartPaymentService {
  private readonly logger = new Logger(FlipkartPaymentService.name);

  constructor(
    private readonly parser: FlipkartPaymentParser,
    private readonly repository: FlipkartPaymentRepository,
    private readonly secondaryService: FlipkartPaymentSecondaryService,
    private readonly settlementService: SettlementService,
  ) {}

  async processUpload(
    input: FlipkartPaymentProcessInput,
  ): Promise<FlipkartPaymentUploadSummary> {
    const started = Date.now();
    const duplicateStrategy = input.duplicateStrategy ?? 'update';

    const parsed = this.parser.parseAllSheets(
      input.buffer,
      input.uploadedFileName,
    );
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

    let secondarySheets: FlipkartPaymentUploadSummary['secondarySheets'];
    if (parsed.secondarySheets.length) {
      secondarySheets = await this.secondaryService.processSecondarySheets({
        sellerId: input.sellerId,
        gstId: input.gstId,
        gstin: input.gstin,
        marketplace: input.marketplace,
        reportMonth: input.reportMonth,
        uploadId: input.uploadId,
        uploadedFileName: input.uploadedFileName,
        duplicateStrategy,
        sheets: parsed.secondarySheets,
      });
    }

    await this.settlementService.replaceNormalizedScope(
      {
        sellerId: input.sellerId,
        marketplace: 'flipkart',
        reportMonth: input.reportMonth,
        sourceType: 'flipkart-payment',
      },
      payloads.flatMap((row) => this.normalizeTransactions(row)),
    );

    if (parsed.missingSheetLabels.length) {
      this.logger.warn(
        `Flipkart payment upload ${input.uploadId}: missing secondary sheets: ${parsed.missingSheetLabels.join(', ')}`,
      );
    }

    const orderNefts = payloads
      .map((row) => String(row.neftId ?? '').trim())
      .filter(Boolean);
    const secondaryNefts = Object.values(secondarySheets ?? {}).flatMap(
      (sheet) => sheet.neftIds ?? [],
    );
    const allNeftIds = [...new Set([...orderNefts, ...secondaryNefts])];

    const summary: FlipkartPaymentUploadSummary = {
      totalRows: parsed.totalRawRows,
      parsedRows: parsed.rows.length,
      insertedRows: upsertResult.inserted,
      updatedRows: upsertResult.updated,
      skippedRows: upsertResult.skipped,
      duplicateRows: upsertResult.duplicateRows,
      invalidRows: parsed.invalidRowCount,
      mergedDuplicateRows: parsed.meta.mergedDuplicateCount ?? 0,
      validationErrors: parsed.validationErrors.slice(0, 100),
      processingTimeMs: Date.now() - started,
      sheetName: parsed.meta.sheetName,
      missingSheetLabels: parsed.missingSheetLabels,
      secondarySheets,
      neftIds: allNeftIds,
    };

    this.logger.log(
      `Flipkart payment upload ${input.uploadId}: orders parsed=${summary.parsedRows} secondarySheets=${parsed.secondarySheets.length} secondaryRows=${parsed.secondarySheets.reduce((n, s) => n + s.rows.length, 0)} inserted=${summary.insertedRows} updated=${summary.updatedRows} invalid=${summary.invalidRows} (${summary.processingTimeMs}ms)`,
    );

    if (parsed.secondarySheets.length) {
      for (const sheet of parsed.secondarySheets) {
        const sheetSummary = secondarySheets?.[sheet.kind];
        this.logger.log(
          `Flipkart secondary ${sheet.kind} (${sheet.sheetName}): inputRows=${sheet.rows.length} parsed=${sheetSummary?.parsedRows ?? 0} inserted=${sheetSummary?.inserted ?? 0} invalid=${sheetSummary?.invalid ?? 0}`,
        );
      }
    } else if (parsed.missingSheetLabels.length) {
      this.logger.warn(
        `Flipkart payment upload ${input.uploadId}: no secondary sheets matched. Expected tabs like: ${parsed.missingSheetLabels.join(', ')}`,
      );
    }

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

  private normalizeTransactions(
    row: FlipkartPaymentUpsertPayload,
  ): NormalizedTransaction[] {
    const orderId = String(row.orderId ?? '').trim();
    if (!orderId) return [];
    const settlementId =
      String(row.neftId ?? '').trim() ||
      `UNSETTLED-${row.reportMonth ?? 'UNKNOWN'}`;
    const settlementDate = new Date(
      row.paymentDate ?? row.invoiceDate ?? row.orderDate ?? Date.now(),
    );
    const orderDateValue = row.orderDate ?? row.invoiceDate;
    const orderDate = orderDateValue ? new Date(orderDateValue) : undefined;
    const base = {
      sellerId: row.sellerId,
      gstId: row.gstId,
      gstin: row.gstin,
      marketplace: 'flipkart',
      settlementId,
      settlementDate,
      ...(orderDate && !Number.isNaN(orderDate.getTime()) ? { orderDate } : {}),
      orderId,
      currency: 'INR',
      disputed: false,
      sourceType: 'flipkart-payment',
      uploadId: row.uploadId,
      reportMonth: row.reportMonth,
      metadata: {
        orderItemId: row.orderItemId,
        invoiceId: row.invoiceId,
        sellerSku: row.sellerSku,
        quantity: row.quantity,
      },
    };
    const identity = `${orderId}:${row.orderItemId ?? ''}:${settlementId}`;
    const transactions: NormalizedTransaction[] = [];
    const add = (
      field: string,
      amount: number | undefined,
      transactionCategory: string,
      calculationRole: NormalizedTransaction['calculationRole'],
      contributesToReceived = false,
    ) => {
      const value = Number(amount ?? 0);
      if (!Number.isFinite(value) || value === 0) return;
      transactions.push({
        ...base,
        transactionType: calculationRole,
        transactionCategory,
        transactionName: field,
        calculationRole,
        amount: value,
        contributesToReceived,
        sourceId: `${identity}:${field}`,
      });
    };

    add('Commission', row.commission, 'Commission', 'expense');
    add('Fixed Fee', row.fixedFee, 'Fixed Fee', 'expense');
    add('Collection Fee', row.collectionFee, 'Collection Fee', 'expense');
    add('Pick and Pack Fee', row.pickAndPackFee, 'Logistics', 'expense');
    add('Shipping Fee', row.shippingFee, 'Shipping', 'expense');
    add('Reverse Shipping Fee', row.reverseShippingFee, 'Shipping', 'expense');
    add('TCS', row.tcs, 'TCS', 'expense');
    add('TDS', row.tds, 'TDS', 'expense');
    add('GST on Marketplace Fees', row.gstOnMarketplaceFees, 'GST', 'expense');
    add('Taxes', row.taxes, 'Tax', 'expense');
    add('Protection Fund', row.protectionFund, 'Protection Fund', 'expense');
    add(
      'Bank Settlement Value',
      row.bankSettlementValue,
      'Settlement Credit',
      'received',
      true,
    );
    return transactions;
  }
}
