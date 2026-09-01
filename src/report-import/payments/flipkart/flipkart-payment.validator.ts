import type { PaymentValidationError } from '../core/payment-upload-summary.types';
import type { FlipkartPaymentMappedRow } from './flipkart-payment.types';
import { normalizePaymentHeader } from '../core/payment-header-normalizer.util';
import { FLIPKART_PAYMENT_HEADER_ENTRIES } from './flipkart-payment-header.mapper';

const REQUIRED_FIELDS: Array<{
  field: keyof FlipkartPaymentMappedRow;
  column: string;
  reason: string;
}> = [
  { field: 'orderId', column: 'Order ID', reason: 'Order ID is required' },
  {
    field: 'paymentDate',
    column: 'Payment Date',
    reason: 'Payment Date is required',
  },
  {
    field: 'sellerSku',
    column: 'Seller SKU',
    reason: 'Seller SKU is required',
  },
  { field: 'quantity', column: 'Quantity', reason: 'Quantity is required' },
];

export function validateFlipkartPaymentRow(
  row: Partial<FlipkartPaymentMappedRow>,
  rowNumber: number,
): PaymentValidationError[] {
  const errors: PaymentValidationError[] = [];
  for (const rule of REQUIRED_FIELDS) {
    const value = row[rule.field];
    if (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && !value.trim())
    ) {
      errors.push({
        rowNumber,
        column: rule.column,
        reason: rule.reason,
      });
    }
  }
  return errors;
}

export function validateFlipkartPaymentHeaders(headers: string[]): void {
  const normalized = new Set(headers.map((h) => normalizePaymentHeader(h)));
  const orderIdAliases = FLIPKART_PAYMENT_HEADER_ENTRIES.filter(
    (e) => e.field === 'orderId',
  ).map((e) => normalizePaymentHeader(e.excelLabel));
  const hasOrderId = orderIdAliases.some((alias) => normalized.has(alias));
  if (!hasOrderId) {
    throw new Error('Payment report is missing required column: Order ID');
  }
}

export function normalizeFlipkartPaymentOrderId(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '');
}
