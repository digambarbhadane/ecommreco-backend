import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import * as XLSX from 'xlsx';
import { parseImportDate } from '../../utils/import-date.util';
import { coercePaymentNumber } from '../core/payment-row-coercion.util';
import type { AmazonPaymentMappedRow } from './amazon-payment.types';

const REQUIRED_HEADERS = [
  'settlement-id',
  'deposit-date',
  'transaction-type',
  'order-id',
  'amount-description',
  'amount',
] as const;

type RequiredHeader = (typeof REQUIRED_HEADERS)[number];

export type AmazonPaymentParseResult = {
  rows: AmazonPaymentMappedRow[];
  totalRawRows: number;
  blankRows: number;
  invalidRowCount: number;
  validationErrors: string[];
  sheetName: string;
  headers: string[];
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase();
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function stringValue(value: unknown, trim = true): string {
  const text = value === null || value === undefined ? '' : String(value);
  return trim ? text.trim() : text;
}

function buildValueFingerprint(values: unknown[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        values.map((value) =>
          value instanceof Date ? value.toISOString() : value,
        ),
      ),
    )
    .digest('hex');
}

@Injectable()
export class AmazonPaymentParser {
  parse(buffer: Buffer): AmazonPaymentParseResult {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,
        raw: true,
      });
    } catch (error) {
      throw new BadRequestException(
        `Could not read Amazon Payment Report: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException('Amazon Payment Report contains no sheets');
    }

    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    if (!matrix.length) {
      throw new BadRequestException('Amazon Payment Report is empty');
    }

    const rawHeaders = Array.isArray(matrix[0]) ? matrix[0] : [];
    const headerIndexes = this.resolveHeaderIndexes(rawHeaders);
    const rows: AmazonPaymentMappedRow[] = [];
    const validationErrors: string[] = [];
    const occurrenceByFingerprint = new Map<string, number>();
    let blankRows = 0;
    let currentSettlementId = '';
    let currentDepositDate: Date | string | undefined;

    for (let index = 1; index < matrix.length; index += 1) {
      const cells = Array.isArray(matrix[index]) ? matrix[index] : [];
      const sourceRowNumber = index + 1;
      const values = Object.fromEntries(
        REQUIRED_HEADERS.map((header) => [
          header,
          cells[headerIndexes[header]],
        ]),
      ) as Record<RequiredHeader, unknown>;

      if (REQUIRED_HEADERS.every((header) => isBlank(values[header]))) {
        blankRows += 1;
        continue;
      }

      const settlementCell = stringValue(values['settlement-id']);
      if (settlementCell) currentSettlementId = settlementCell;

      if (!isBlank(values['deposit-date'])) {
        currentDepositDate = this.parseDepositDate(
          values['deposit-date'],
          sourceRowNumber,
          validationErrors,
        );
      }

      const rowErrorCountBefore = validationErrors.length;
      if (!currentSettlementId) {
        validationErrors.push(
          `Row ${sourceRowNumber}: settlement-id is blank and no previous settlement-id is available`,
        );
      }
      if (currentDepositDate === undefined) {
        validationErrors.push(
          `Row ${sourceRowNumber}: deposit-date is blank and no previous deposit-date is available`,
        );
      }
      const amount = this.parseAmount(
        values.amount,
        sourceRowNumber,
        validationErrors,
      );
      if (
        validationErrors.length > rowErrorCountBefore ||
        currentDepositDate === undefined ||
        amount === undefined
      ) {
        continue;
      }

      const settlementId = currentSettlementId;
      const depositDate = currentDepositDate;
      const transactionType = stringValue(values['transaction-type']);
      const orderId = stringValue(values['order-id']);
      // Amazon's component label is reconciliation data. Preserve its text
      // exactly as represented by the Excel cell instead of normalizing it.
      const amountDescription = stringValue(
        values['amount-description'],
        false,
      );
      const fingerprint = buildValueFingerprint([
        settlementId,
        depositDate,
        transactionType,
        orderId,
        amountDescription,
        amount,
      ]);
      const occurrence = (occurrenceByFingerprint.get(fingerprint) ?? 0) + 1;
      occurrenceByFingerprint.set(fingerprint, occurrence);

      rows.push({
        settlementId,
        depositDate,
        transactionType,
        orderId,
        amountDescription,
        amount,
        rowKey: `${fingerprint}:${occurrence}`,
        sourceRowNumber,
      });
    }

    if (!rows.length) {
      const details = validationErrors.length
        ? `: ${validationErrors.slice(0, 10).join('; ')}`
        : '';
      throw new BadRequestException(
        `Amazon Payment Report contains no valid transaction rows${details}`,
      );
    }

    return {
      rows,
      totalRawRows: Math.max(0, matrix.length - 1),
      blankRows,
      invalidRowCount: new Set(
        validationErrors
          .map((error) => Number(error.match(/^Row (\d+):/)?.[1] ?? 0))
          .filter((rowNumber) => rowNumber > 0),
      ).size,
      validationErrors,
      sheetName,
      headers: rawHeaders.map(normalizeHeader),
    };
  }

  private resolveHeaderIndexes(
    headers: unknown[],
  ): Record<RequiredHeader, number> {
    const normalized = headers.map(normalizeHeader);
    const missing = REQUIRED_HEADERS.filter(
      (header) => !normalized.includes(header),
    );
    if (missing.length) {
      throw new BadRequestException(
        `Amazon Payment Report is missing required columns: ${missing.join(', ')}`,
      );
    }

    return Object.fromEntries(
      REQUIRED_HEADERS.map((header) => [header, normalized.indexOf(header)]),
    ) as Record<RequiredHeader, number>;
  }

  private parseDepositDate(
    value: unknown,
    rowNumber: number,
    errors: string[],
  ): Date | string | undefined {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const raw = String(value ?? '').trim();
    const amazonUtc = raw.match(
      /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?\s*(?:UTC)?$/i,
    );
    if (amazonUtc) {
      const parsedAmazonDate = new Date(
        Date.UTC(
          Number(amazonUtc[3]),
          Number(amazonUtc[2]) - 1,
          Number(amazonUtc[1]),
          Number(amazonUtc[4] ?? 0),
          Number(amazonUtc[5] ?? 0),
          Number(amazonUtc[6] ?? 0),
        ),
      );
      if (
        parsedAmazonDate.getUTCFullYear() === Number(amazonUtc[3]) &&
        parsedAmazonDate.getUTCMonth() === Number(amazonUtc[2]) - 1 &&
        parsedAmazonDate.getUTCDate() === Number(amazonUtc[1])
      ) {
        return parsedAmazonDate;
      }
    }
    const isoDate = String(value ?? '')
      .trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDate) {
      const parsedIso = new Date(
        Date.UTC(
          Number(isoDate[1]),
          Number(isoDate[2]) - 1,
          Number(isoDate[3]),
        ),
      );
      if (
        parsedIso.getUTCFullYear() === Number(isoDate[1]) &&
        parsedIso.getUTCMonth() === Number(isoDate[2]) - 1 &&
        parsedIso.getUTCDate() === Number(isoDate[3])
      ) {
        return parsedIso;
      }
    }
    const parsed = parseImportDate(value);
    if (parsed) return parsed;
    errors.push(`Row ${rowNumber}: deposit-date is missing or invalid`);
    return undefined;
  }

  private parseAmount(
    value: unknown,
    rowNumber: number,
    errors: string[],
  ): number | undefined {
    const amount = coercePaymentNumber(value);
    if (amount !== undefined) return amount;

    const raw = String(value ?? '').trim();
    if (raw) {
      const isAccountingNegative = /^\(.*\)$/.test(raw);
      const normalized = raw
        .replace(/^\((.*)\)$/, '$1')
        .replace(/\b(?:INR|USD|EUR|GBP)\b/gi, '')
        .replace(/[₹$€£,\s]/g, '')
        .trim();
      if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) {
        const parsed = Number(normalized);
        if (Number.isFinite(parsed)) {
          return isAccountingNegative ? -Math.abs(parsed) : parsed;
        }
      }
    }

    const received = raw ? ` (received "${raw.slice(0, 80)}")` : '';
    errors.push(`Row ${rowNumber}: amount is missing or invalid${received}`);
    return undefined;
  }
}
