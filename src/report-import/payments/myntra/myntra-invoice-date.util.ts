import { repairDateToIso } from '../../../common/utils/repair-legacy-date.util';
import { asImportDateIso } from '../../utils/import-date.util';

/** Myntra GST sale rows that carry packing / invoice dates. */
const MYNTRA_SALE_DOCUMENT_TYPES = new Set(['SALE']);

export const MYNTRA_RTO_RETURN = 'RTO Return';
export const MYNTRA_CUSTOMER_RETURN = 'Customer Return';

/**
 * Resolve Myntra Invoice Date for Order Wise Payments (YYYY-MM-DD for display).
 *
 * Myntra GSTR stores `order_packed_date` as DD-MM-YYYY. Sales-revenue
 * `invoiceDate` is often an MDY-swapped ISO for ambiguous day/month values
 * (e.g. packed `06-10-2025` → invoiceDate `2025-06-10`). Prefer packing date
 * so the UI formats as DD-MM-YYYY without changing stored import rows.
 * Returns undefined for non-Myntra rows so other marketplaces stay untouched.
 */
export function resolveMyntraAnalyticsInvoiceDate(row: {
  documentType?: string;
  invoiceDate?: string;
  order_packed_date?: string;
  reportMonth?: string;
}): string | undefined {
  const docType = String(row.documentType ?? '').trim();
  if (!MYNTRA_SALE_DOCUMENT_TYPES.has(docType)) return undefined;

  const fromPacked = asImportDateIso(row.order_packed_date);
  if (fromPacked) return fromPacked;

  // DMY-aware parse — avoids new Date("06-12-2026") MDY reversal.
  return (
    asImportDateIso(row.invoiceDate) ??
    repairDateToIso(row.invoiceDate, row.reportMonth)
  );
}

/**
 * Myntra return transaction date for Order Wise Payments (YYYY-MM-DD).
 * RTO uses orderCancelDate; Customer Return uses frRefundedDate.
 */
export function resolveMyntraReturnTransactionDate(row: {
  documentType?: string;
  orderCancelDate?: string;
  frRefundedDate?: string;
  reportMonth?: string;
}): string | undefined {
  const docType = String(row.documentType ?? '').trim();
  if (docType === MYNTRA_RTO_RETURN) {
    return (
      asImportDateIso(row.orderCancelDate) ??
      repairDateToIso(row.orderCancelDate, row.reportMonth)
    );
  }
  if (docType === MYNTRA_CUSTOMER_RETURN) {
    return (
      asImportDateIso(row.frRefundedDate) ??
      repairDateToIso(row.frRefundedDate, row.reportMonth)
    );
  }
  return undefined;
}

/**
 * Order Report Invoice Date for Myntra rows (YYYY-MM-DD).
 * RTO → orderCancelDate; Customer Return (RT/Refunded) → frRefundedDate;
 * SALE → order_packed_date (then invoiceDate).
 * Returns undefined for non-Myntra document types.
 */
export function resolveMyntraOrderReportInvoiceDate(row: {
  documentType?: string;
  invoiceDate?: string;
  order_packed_date?: string;
  orderCancelDate?: string;
  frRefundedDate?: string;
  reportMonth?: string;
}): string | undefined {
  return (
    resolveMyntraReturnTransactionDate(row) ??
    resolveMyntraAnalyticsInvoiceDate(row)
  );
}
