import type { ParsedSheetRow } from '../services/mapping.service';
import { isAmazonCountableReturnTransaction } from './amazon-analytics.util';

export type AmazonReturnSubType = 'customer_return' | 'rto' | 'na';

export type AmazonReturnDetails = {
  typeOfReturn?: string;
  amazonReturnSubType?: AmazonReturnSubType;
  returnReason?: string;
};

export function normalizeAmazonOrderId(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function amazonOrderIdLookupKey(value: unknown): string {
  return normalizeAmazonOrderId(value).toLowerCase();
}

/** Map Amazon return report labels to normalized return buckets. */
export function classifyAmazonReturnReportType(
  returnType?: string | null,
): AmazonReturnSubType | null {
  const raw = String(returnType ?? '').trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  const compact = upper.replace(/[^A-Z0-9]/g, '');

  if (
    compact === 'CRETURNS' ||
    upper === 'C-RETURNS' ||
    upper === 'C RETURNS' ||
    /\bC[\s-]?RETURNS?\b/.test(upper)
  ) {
    return 'customer_return';
  }

  if (upper.includes('AMAZON CS') || compact === 'AMAZONCS') {
    return 'customer_return';
  }

  if (upper === 'REJECTED' || upper === 'UNDELIVERED') {
    return 'rto';
  }

  return null;
}

export function resolveAmazonReturnDetails(
  returnTypeRaw: string,
  orderId: string,
): AmazonReturnDetails {
  const returnType = String(returnTypeRaw ?? '').trim();
  const subType = classifyAmazonReturnReportType(returnType);

  if (subType === 'customer_return') {
    return {
      typeOfReturn: 'Customer Return',
      amazonReturnSubType: 'customer_return',
    };
  }

  if (subType === 'rto') {
    return {
      typeOfReturn: 'RTO',
      amazonReturnSubType: 'rto',
    };
  }

  if (!normalizeAmazonOrderId(orderId) && returnType) {
    return {
      typeOfReturn: '#N/A',
      amazonReturnSubType: 'na',
    };
  }

  if (returnType) {
    return {
      typeOfReturn: returnType,
      amazonReturnSubType: 'na',
    };
  }

  return {};
}

export function isAmazonReturnTransaction(
  documentType?: string | null,
  voucherType?: string | null,
): boolean {
  const raw = `${documentType ?? ''} ${voucherType ?? ''}`.trim().toUpperCase();
  if (!raw) return false;
  if (/\bCANCEL/.test(raw)) return true;
  if (/\bREFUND/.test(raw)) return true;
  if (/\bRETURN\b/.test(raw) || /\bRTO\b/.test(raw)) return true;
  return false;
}

export function buildAmazonReturnDetailsByOrderId(
  rows: ParsedSheetRow[],
  mapRow: (row: ParsedSheetRow) => AmazonReturnDetails,
  getOrderId: (row: ParsedSheetRow) => string,
): Map<string, AmazonReturnDetails> {
  const index = new Map<string, AmazonReturnDetails>();
  for (const row of rows) {
    const orderId = getOrderId(row);
    if (!orderId) continue;
    const key = amazonOrderIdLookupKey(orderId);
    index.set(key, mapRow(row));
  }
  return index;
}

export function lookupAmazonReturnDetails(
  returnByOrder: Map<string, AmazonReturnDetails>,
  orderId: unknown,
): AmazonReturnDetails | undefined {
  const key = amazonOrderIdLookupKey(orderId);
  if (!key) return undefined;
  return returnByOrder.get(key);
}

export function applyAmazonReturnDetailsToRow<
  T extends AmazonReturnDetails,
>(row: T, details?: AmazonReturnDetails | null): T {
  if (!details) return row;
  return {
    ...row,
    ...(details.typeOfReturn ? { typeOfReturn: details.typeOfReturn } : {}),
    ...(details.amazonReturnSubType
      ? { amazonReturnSubType: details.amazonReturnSubType }
      : {}),
    ...(details.returnReason ? { returnReason: details.returnReason } : {}),
  };
}

/** Stamp B2C Refund/Return rows so summary counts them even without a return report match. */
export function applyAmazonReturnTransactionDefaults<
  T extends AmazonReturnDetails & {
    documentType?: string;
    voucherType?: string;
    amazonMtrSource?: 'b2b' | 'b2c';
    customerGstNo?: string;
  },
>(row: T): T {
  if (
    !isAmazonCountableReturnTransaction(
      row.documentType,
      row.voucherType,
      row.amazonMtrSource,
      row.customerGstNo,
    )
  ) {
    return row;
  }
  if (row.amazonReturnSubType) {
    return row;
  }
  const label = String(row.documentType ?? row.voucherType ?? 'Refund').trim();
  return {
    ...row,
    typeOfReturn: row.typeOfReturn || label || 'Refund',
    amazonReturnSubType: 'na',
  };
}
