import { BadRequestException, Injectable } from '@nestjs/common';
import { FileParserService } from '../../services/file-parser.service';
import type { PaymentParser, PaymentParserResult } from '../core/payment-parser.interface';
import type { PaymentValidationError } from '../core/payment-upload-summary.types';
import { mapFlipkartPaymentRawRow } from './flipkart-payment-header.mapper';
import type { FlipkartPaymentMappedRow } from './flipkart-payment.types';
import {
  normalizeFlipkartPaymentOrderId,
  validateFlipkartPaymentHeaders,
  validateFlipkartPaymentRow,
} from './flipkart-payment.validator';
import { normalizePaymentHeader } from '../core/payment-header-normalizer.util';

@Injectable()
export class FlipkartPaymentParser
  implements PaymentParser<FlipkartPaymentMappedRow>
{
  constructor(private readonly fileParser: FileParserService) {}

  parse(buffer: Buffer, uploadedFileName: string): PaymentParserResult<FlipkartPaymentMappedRow> {
    void uploadedFileName;
    const workbook = this.fileParser.parseFlipkartPaymentWorkbook(buffer);
    this.validateHeaders(workbook.headers);

    const validationErrors: PaymentValidationError[] = [];
    let invalidRowCount = 0;
    const rows: FlipkartPaymentMappedRow[] = [];
    const seenOrderIds = new Set<string>();

    for (const rawRow of workbook.rows) {
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

      const mapped: FlipkartPaymentMappedRow = {
        ...mappedPartial,
        orderId,
      };

      const rowErrors = validateFlipkartPaymentRow(mapped, rowNumber);
      if (rowErrors.length) {
        invalidRowCount += 1;
        validationErrors.push(...rowErrors);
        continue;
      }

      if (seenOrderIds.has(orderId)) {
        const existingIndex = rows.findIndex((item) => item.orderId === orderId);
        if (existingIndex >= 0) {
          rows[existingIndex] = mapped;
        }
        continue;
      }

      seenOrderIds.add(orderId);
      rows.push(mapped);
    }

    return {
      rows,
      meta: {
        sheetName: String(rawRowSheetName(workbook.rows) ?? 'Orders'),
        headers: this.normalize(workbook.headers),
      },
      validationErrors,
      invalidRowCount,
      totalRawRows: workbook.rows.length,
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

function rawRowSheetName(
  rows: Array<{ __sheetName?: string }>,
): string | undefined {
  return rows[0]?.__sheetName;
}
