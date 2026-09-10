import { createHash } from 'crypto';
import { parseGstinFromCell } from '../../config/importMappings/gst-column.util';
import {
  MYNTRA_PG_REVERSE_FIELD_CATALOG,
  MYNTRA_PG_SETTLEMENT_COLUMN_KEY_PATTERN,
  type MyntraPgFieldDefinition,
  type MyntraPgFieldType,
} from '../../config/importMappings/myntra-pg-reverse.mapping';
import { coercePaymentNumber } from '../core/payment-row-coercion.util';
import { parseImportDate } from '../../utils/import-date.util';

/** Normalize Excel header to a stable snake_case field key. */
export function normalizeMyntraPgFieldKey(header: string): string {
  return String(header ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function coerceMyntraPgCellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text) return null;
  const asNumber = coercePaymentNumber(value);
  if (asNumber !== null && /^-?\d+(\.\d+)?$/.test(text.replace(/,/g, ''))) {
    return asNumber;
  }
  const asDate = parseImportDate(value);
  if (asDate) return asDate;
  return text;
}

export function mapRawRowToMyntraPgRowData(
  headers: string[],
  cells: unknown[],
): Record<string, unknown> {
  const rowData: Record<string, unknown> = {};
  for (let index = 0; index < headers.length; index += 1) {
    const key = normalizeMyntraPgFieldKey(headers[index]);
    if (!key) continue;
    const coerced = coerceMyntraPgCellValue(cells[index]);
    if (coerced !== null && coerced !== undefined && coerced !== '') {
      rowData[key] = coerced;
    }
  }
  return rowData;
}

export function pickString(
  rowData: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = rowData[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

export function pickNumber(
  rowData: Record<string, unknown>,
  ...keys: string[]
): number {
  for (const key of keys) {
    const num = coercePaymentNumber(rowData[key]);
    if (num !== undefined) return num;
  }
  return 0;
}

export function pickDate(
  rowData: Record<string, unknown>,
  ...keys: string[]
): Date | string | undefined {
  for (const key of keys) {
    const parsed = parseImportDate(rowData[key]);
    if (parsed) return parsed;
  }
  return undefined;
}

export function extractSellerGstin(rowData: Record<string, unknown>): string {
  return parseGstinFromCell(rowData.seller_gstn) ?? '';
}

export function coerceFieldByType(
  value: unknown,
  type: MyntraPgFieldType,
): unknown {
  if (value === null || value === undefined || value === '') return undefined;
  if (type === 'number') {
    const num = coercePaymentNumber(value);
    return num === undefined ? undefined : num;
  }
  if (type === 'date') {
    const parsed = parseImportDate(value);
    return parsed ?? undefined;
  }
  const text = String(value).trim();
  return text || undefined;
}

export function applyMyntraPgFieldCatalogAliases(
  rowData: Record<string, unknown>,
  catalog: MyntraPgFieldDefinition[],
): Record<string, unknown> {
  const out = { ...rowData };
  for (const field of catalog) {
    if (
      out[field.key] !== undefined &&
      out[field.key] !== null &&
      out[field.key] !== ''
    ) {
      continue;
    }
    for (const alias of field.aliases ?? []) {
      const normalized = normalizeMyntraPgFieldKey(alias);
      const value = out[normalized];
      if (value !== undefined && value !== null && value !== '') {
        out[field.key] = value;
        break;
      }
    }
  }
  return out;
}

/** Coerce known reverse columns and preserve dynamic settlement / extra columns. */
export function buildTypedMyntraPgReverseRowData(
  rowData: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = applyMyntraPgFieldCatalogAliases(
    rowData,
    MYNTRA_PG_REVERSE_FIELD_CATALOG,
  );
  const catalogKeys = new Set(
    MYNTRA_PG_REVERSE_FIELD_CATALOG.map((field) => field.key),
  );
  const typed: Record<string, unknown> = {};

  for (const field of MYNTRA_PG_REVERSE_FIELD_CATALOG) {
    const coerced = coerceFieldByType(normalized[field.key], field.type);
    if (coerced !== undefined) {
      typed[field.key] = coerced;
    }
  }

  for (const [key, value] of Object.entries(normalized)) {
    if (catalogKeys.has(key) || typed[key] !== undefined) continue;
    if (MYNTRA_PG_SETTLEMENT_COLUMN_KEY_PATTERN.test(key)) {
      const num = coercePaymentNumber(value);
      if (num !== undefined) typed[key] = num;
      continue;
    }
    const coerced = coerceMyntraPgCellValue(value);
    if (coerced !== null && coerced !== undefined && coerced !== '') {
      typed[key] = coerced;
    }
  }

  return typed;
}

export function extractMyntraPgSettlementColumns(
  rowData: Record<string, unknown>,
): Record<string, number> {
  const settlementColumns: Record<string, number> = {};
  for (const [key, value] of Object.entries(rowData)) {
    if (!MYNTRA_PG_SETTLEMENT_COLUMN_KEY_PATTERN.test(key)) continue;
    const num = coercePaymentNumber(value);
    if (num !== undefined) settlementColumns[key] = num;
  }
  return settlementColumns;
}

export function promoteMyntraPgReverseTopLevelFields(
  rowData: Record<string, unknown>,
): Record<string, unknown> {
  return {
    returnId: pickString(rowData, 'return_id'),
    returnDate: pickDate(rowData, 'return_date'),
    packingDate: pickDate(rowData, 'packing_date'),
    deliveryDate: pickDate(rowData, 'delivery_date'),
    invoiceNumber: pickString(rowData, 'invoice_number'),
    packetId: pickString(rowData, 'packet_id'),
    hsnCode: pickString(rowData, 'hsn_code'),
    ecommercePortalName: pickString(rowData, 'ecommerce_portal_name'),
    sellerProductAmount: pickNumber(rowData, 'seller_product_amount'),
    postpaidAmount: pickNumber(rowData, 'postpaid_amount'),
    prepaidAmount: pickNumber(rowData, 'prepaid_amount'),
    mrp: pickNumber(rowData, 'mrp'),
    totalDiscountAmount: pickNumber(rowData, 'total_discount_amount'),
    taxableAmount: pickNumber(rowData, 'taxable_amount'),
    igstAmount: pickNumber(rowData, 'igst_amount'),
    cgstAmount: pickNumber(rowData, 'cgst_amount'),
    sgstAmount: pickNumber(rowData, 'sgst_amount'),
    tcsAmount: pickNumber(rowData, 'tcs_amount'),
    tdsAmount: pickNumber(rowData, 'tds_amount'),
    totalCommission: pickNumber(rowData, 'total_commission'),
    totalLogisticsDeduction: pickNumber(rowData, 'total_logistics_deduction'),
    customerPaidAmt: pickNumber(rowData, 'customer_paid_amt'),
    totalSettlement: pickNumber(rowData, 'total_settlement'),
    amountPendingSettlement: pickNumber(rowData, 'amount_pending_settlement'),
    prepaidPayment: pickNumber(rowData, 'prepaid_payment'),
    postpaidPayment: pickNumber(rowData, 'postpaid_payment'),
    sellerName: pickString(rowData, 'seller_name'),
    myntraGstn: pickString(rowData, 'myntra_gstn'),
    sellerTier: pickString(rowData, 'seller_tier'),
    settlementColumns: extractMyntraPgSettlementColumns(rowData),
  };
}

export function buildMyntraPgRowKey(
  reportKind: 'forward' | 'reverse',
  rowData: Record<string, unknown>,
  sourceRowNumber: number,
): string {
  const orderReleaseId = pickString(
    rowData,
    'order_release_id',
    'seller_order_id',
  );
  const orderLineId = pickString(rowData, 'order_line_id');
  const returnId = pickString(rowData, 'return_id');
  const sku = pickString(rowData, 'sku_code');
  if (reportKind === 'reverse' && (returnId || orderReleaseId || orderLineId)) {
    return `${reportKind}|${orderReleaseId}|${orderLineId}|${returnId}|${sku}|${sourceRowNumber}`;
  }
  if (orderReleaseId || orderLineId) {
    return `${reportKind}|${orderReleaseId}|${orderLineId}|${sku}|${sourceRowNumber}`;
  }
  return createHash('sha256')
    .update(JSON.stringify({ reportKind, sourceRowNumber, rowData }))
    .digest('hex');
}

export function rowHasMeaningfulData(
  rowData: Record<string, unknown>,
): boolean {
  return Object.values(rowData).some(
    (value) =>
      value !== null && value !== undefined && String(value).trim() !== '',
  );
}
