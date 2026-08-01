import type { PaymentValidationError } from './payment-upload-summary.types';

export type ParsedPaymentWorkbookMeta = {
  sheetName: string;
  headers: string[];
  /** Extra sheet lines folded into an existing Order ID by summing amounts. */
  mergedDuplicateCount?: number;
};

export type PaymentParserResult<TRow> = {
  rows: TRow[];
  meta: ParsedPaymentWorkbookMeta;
  validationErrors: PaymentValidationError[];
  invalidRowCount: number;
  totalRawRows: number;
};

export interface PaymentParser<TRow> {
  parse(buffer: Buffer, uploadedFileName: string): PaymentParserResult<TRow>;
  validateHeaders(headers: string[]): void;
  normalize(headers: string[]): string[];
  map(
    rawRow: Record<string, unknown>,
    rowNumber: number,
  ): { row: TRow | null; errors: PaymentValidationError[] };
}
