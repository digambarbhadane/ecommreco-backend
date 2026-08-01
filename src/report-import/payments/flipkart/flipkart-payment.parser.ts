import { BadRequestException, Injectable } from '@nestjs/common';
import { FileParserService } from '../../services/file-parser.service';
import type { PaymentParser, PaymentParserResult } from '../core/payment-parser.interface';
import type { PaymentValidationError } from '../core/payment-upload-summary.types';
import { mapFlipkartPaymentRawRow } from './flipkart-payment-header.mapper';
import {
  mergeFlipkartPaymentRowsByOrderId,
  buildFlipkartPaymentMergeKey,
  normalizeFlipkartPaymentNeftId,
} from './flipkart-payment-merge.util';
import type { FlipkartPaymentMappedRow } from './flipkart-payment.types';
import {
  normalizeFlipkartPaymentOrderId,
  validateFlipkartPaymentHeaders,
  validateFlipkartPaymentRow,
} from './flipkart-payment.validator';
import { normalizePaymentHeader } from '../core/payment-header-normalizer.util';
import type { FlipkartPaymentSecondarySheetKind } from './sheets/flipkart-payment-sheet-kinds';

export type FlipkartPaymentSecondaryParsedSheet = {
  kind: FlipkartPaymentSecondarySheetKind;
  sheetName: string;
  rows: Record<string, unknown>[];
};

export type FlipkartPaymentMultiSheetParseResult = PaymentParserResult<FlipkartPaymentMappedRow> & {
  secondarySheets: FlipkartPaymentSecondaryParsedSheet[];
  missingSheetLabels: string[];
};

@Injectable()
export class FlipkartPaymentParser
  implements PaymentParser<FlipkartPaymentMappedRow>
{
  constructor(private readonly fileParser: FileParserService) {}

  parse(buffer: Buffer, uploadedFileName: string): PaymentParserResult<FlipkartPaymentMappedRow> {
    const multi = this.parseAllSheets(buffer, uploadedFileName);
    const { secondarySheets: _s, missingSheetLabels: _m, ...rest } = multi;
    return rest;
  }

  parseAllSheets(
    buffer: Buffer,
    uploadedFileName: string,
  ): FlipkartPaymentMultiSheetParseResult {
    void uploadedFileName;
    const workbook = this.fileParser.parseFlipkartPaymentAllSheetsWorkbook(buffer);
    this.validateHeaders(workbook.orders.headers);

    const validationErrors: PaymentValidationError[] = [];
    let invalidRowCount = 0;
    let mergedDuplicateCount = 0;
    const rowsByOrderNeft = new Map<string, FlipkartPaymentMappedRow>();

    for (const rawRow of workbook.orders.rows) {
      const rowNumber = Number(rawRow.__rowNumber ?? 0);
      const mappedPartial = mapFlipkartPaymentRawRow(rawRow);
      const orderId = normalizeFlipkartPaymentOrderId(mappedPartial.orderId);
      if (!orderId) {
        invalidRowCount += 1;
        validationErrors.push({
          rowNumber,
          column: 'Order ID',
          reason: 'Order ID is missing or empty',
        });
        continue;
      }

      const neftId = normalizeFlipkartPaymentNeftId(mappedPartial.neftId);
      const mapped: FlipkartPaymentMappedRow = {
        ...mappedPartial,
        orderId,
        neftId,
      };

      const rowErrors = validateFlipkartPaymentRow(mapped, rowNumber);
      if (rowErrors.length) {
        invalidRowCount += 1;
        validationErrors.push(...rowErrors);
        continue;
      }

      const mergeKey = buildFlipkartPaymentMergeKey(orderId, neftId);
      const existing = rowsByOrderNeft.get(mergeKey);
      if (existing) {
        rowsByOrderNeft.set(
          mergeKey,
          mergeFlipkartPaymentRowsByOrderId(existing, mapped),
        );
        mergedDuplicateCount += 1;
        continue;
      }

      rowsByOrderNeft.set(mergeKey, mapped);
    }

    const rows = [...rowsByOrderNeft.values()];

    return {
      rows,
      meta: {
        sheetName: workbook.orders.sheetName || 'Orders',
        headers: this.normalize(workbook.orders.headers),
        mergedDuplicateCount,
      },
      validationErrors,
      invalidRowCount,
      totalRawRows: workbook.orders.rows.length,
      secondarySheets: workbook.secondary.map((sheet) => ({
        kind: sheet.kind,
        sheetName: sheet.sheetName,
        rows: sheet.rows as Record<string, unknown>[],
      })),
      missingSheetLabels: workbook.missingSheetLabels,
    };
  }

  validateHeaders(headers: string[]): void {
    try {
      validateFlipkartPaymentHeaders(headers);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid payment report headers',
      );
    }
  }

  normalize(headers: string[]): string[] {
    return headers.map((header) => normalizePaymentHeader(header));
  }

  map(
    rawRow: Record<string, unknown>,
    rowNumber: number,
  ): { row: FlipkartPaymentMappedRow | null; errors: PaymentValidationError[] } {
    const mappedPartial = mapFlipkartPaymentRawRow(rawRow);
    const orderId = normalizeFlipkartPaymentOrderId(mappedPartial.orderId);
    if (!orderId) {
      return {
        row: null,
        errors: [
          {
            rowNumber,
            column: 'Order ID',
            reason: 'Order ID is missing or empty',
          },
        ],
      };
    }
    const mapped: FlipkartPaymentMappedRow = { ...mappedPartial, orderId };
    const errors = validateFlipkartPaymentRow(mapped, rowNumber);
    if (errors.length) {
      return { row: null, errors };
    }
    return { row: mapped, errors: [] };
  }
}
