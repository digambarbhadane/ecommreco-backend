import { Injectable } from '@nestjs/common';

export type ParsedSheetRow = {
  __sheetName: string;
  __rowNumber: number;
  [key: string]: unknown;
};

export type NormalizedImportRow = {
  reportType: 'sales' | 'cashback';
  sellerGSTIN?: string;
  orderID?: string;
  skuID?: string;
  hsnCode?: string;
  voucherType?: string;
  documentType: string;
  paymentMode?: string;
  fulfilmentType?: string;
  quantity?: number;
  invoiceAmount?: number;
  taxableAmount?: number;
  igstRate?: number;
  igstAmount?: number;
  cgstRate?: number;
  cgstAmount?: number;
  sgstRate?: number;
  sgstAmount?: number;
  invoiceNo?: string;
  buyerInvoiceDate?: string;
  invoiceDate?: string;
  pincode?: string;
  stateName?: string;
};

type MappingConfig = {
  source: string[];
  target: keyof NormalizedImportRow;
  transform?: (value: unknown, fullRow: ParsedSheetRow) => unknown;
};

export const normalizeHeader = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const asString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return undefined;
  }
  const str = String(value).trim();
  return str.length ? str : undefined;
};

const normalizeGstin = (value: unknown): string | undefined => {
  const str = asString(value)?.toUpperCase();
  return str;
};

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return undefined;
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return undefined;
  }
  const cleaned = String(value)
    .replace(/[,\s₹$]/g, '')
    .trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const asDate = (value: unknown): string | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;

  // Support values that include time like "31/03/2026 00:00:00".
  const extractedDateToken =
    raw.match(/\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/)?.[0] ?? raw;
  const normalized = extractedDateToken.replace(/\./g, '/').replace(/-/g, '/');
  const date = new Date(normalized);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);

  const parts = normalized.split('/').map((part) => Number(part));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    const [d, m, y] = parts;
    const inferredYear = y < 100 ? 2000 + y : y;
    const byDmy = new Date(Date.UTC(inferredYear, m - 1, d));
    if (!Number.isNaN(byDmy.getTime())) return byDmy.toISOString().slice(0, 10);
  }
  return undefined;
};

const SALES_MAPPINGS: MappingConfig[] = [
  {
    source: ['GST NO', 'Seller GSTIN'],
    target: 'sellerGSTIN',
    transform: normalizeGstin,
  },
  { source: ['Order ID'], target: 'orderID', transform: asString },
  { source: ['SKU ID', 'SKU'], target: 'skuID', transform: asString },
  { source: ['HSN Code'], target: 'hsnCode', transform: asString },
  {
    source: ['Voucher Type', 'Event Sub Type'],
    target: 'voucherType',
    transform: asString,
  },
  {
    source: ['Document Type', 'Event Type'],
    target: 'documentType',
    transform: asString,
  },
  {
    source: ['Payment Mode', 'Order Type'],
    target: 'paymentMode',
    transform: asString,
  },
  {
    source: ['Fulfilment Type'],
    target: 'fulfilmentType',
    transform: asString,
  },
  {
    source: ['Quantity', 'Item Quantity'],
    target: 'quantity',
    transform: asNumber,
  },
  {
    source: [
      'Invoice Amount',
      'Final Invoice Amount',
      'Final Invoice Amount (Price after discount+Shipping Charges)',
    ],
    target: 'invoiceAmount',
    transform: asNumber,
  },
  {
    source: ['Taxable Amount', 'Taxable Value'],
    target: 'taxableAmount',
    transform: asNumber,
  },
  { source: ['IGST Rate'], target: 'igstRate', transform: asNumber },
  { source: ['IGST Amount'], target: 'igstAmount', transform: asNumber },
  { source: ['CGST Rate'], target: 'cgstRate', transform: asNumber },
  { source: ['CGST Amount'], target: 'cgstAmount', transform: asNumber },
  {
    source: ['SGST Rate', 'UTGST Rate'],
    target: 'sgstRate',
    transform: asNumber,
  },
  {
    source: ['SGST Amount', 'UTGST Amount'],
    target: 'sgstAmount',
    transform: asNumber,
  },
  {
    source: ['Invoice No', 'Buyer Invoice ID'],
    target: 'invoiceNo',
    transform: asString,
  },
  {
    source: ['Buyer Invoice Date'],
    target: 'buyerInvoiceDate',
    transform: asDate,
  },
  {
    source: ['Buyer Invoice Date', 'Invoice Date'],
    target: 'invoiceDate',
    transform: asDate,
  },
  {
    source: [
      'Pincode',
      "Customer's Delivery Pincode",
      'Customer Delivery Pincode',
    ],
    target: 'pincode',
    transform: asString,
  },
  {
    source: [
      'State Name',
      "Customer's Delivery State",
      'Customer Delivery State',
    ],
    target: 'stateName',
    transform: asString,
  },
];

const CASHBACK_MAPPINGS: MappingConfig[] = [
  {
    source: ['GST NO', 'Seller GSTIN'],
    target: 'sellerGSTIN',
    transform: normalizeGstin,
  },
  { source: ['Order ID'], target: 'orderID', transform: asString },
  {
    source: ['Voucher Type', 'Document Type'],
    target: 'documentType',
    transform: asString,
  },
  {
    source: ['Document Type', 'Document Sub Type', 'Document SubType'],
    target: 'voucherType',
    transform: asString,
  },
  { source: ['Payment Mode'], target: 'paymentMode', transform: asString },
  { source: ['Invoice Amount'], target: 'invoiceAmount', transform: asNumber },
  {
    source: ['Taxable Amount', 'Taxable Value'],
    target: 'taxableAmount',
    transform: asNumber,
  },
  { source: ['IGST Rate'], target: 'igstRate', transform: asNumber },
  { source: ['IGST Amount'], target: 'igstAmount', transform: asNumber },
  { source: ['CGST Rate'], target: 'cgstRate', transform: asNumber },
  { source: ['CGST Amount'], target: 'cgstAmount', transform: asNumber },
  {
    source: ['SGST Rate', 'UTGST Rate'],
    target: 'sgstRate',
    transform: asNumber,
  },
  {
    source: ['SGST Amount', 'UTGST Amount'],
    target: 'sgstAmount',
    transform: asNumber,
  },
  {
    source: [
      'Invoice No',
      'Credit Note ID',
      'Debit Note ID',
      'Credit Note ID / Debit Note ID',
      'Credit Note ID/ Debit Note ID',
      'Credit Note ID/Debit Note ID',
    ],
    target: 'invoiceNo',
    transform: asString,
  },
  { source: ['Invoice Date'], target: 'invoiceDate', transform: asDate },
  {
    source: [
      'State Name',
      "Customer's Delivery State",
      'Customer Delivery State',
    ],
    target: 'stateName',
    transform: asString,
  },
];

@Injectable()
export class MappingService {
  mapSalesRow(row: ParsedSheetRow): NormalizedImportRow {
    return this.mapRow(row, 'sales', SALES_MAPPINGS);
  }

  mapCashbackRow(row: ParsedSheetRow): NormalizedImportRow {
    return this.mapRow(row, 'cashback', CASHBACK_MAPPINGS);
  }

  private mapRow(
    row: ParsedSheetRow,
    reportType: 'sales' | 'cashback',
    mappings: MappingConfig[],
  ): NormalizedImportRow {
    const mapped: NormalizedImportRow = { reportType, documentType: '' };
    const normalizedRowEntries = Object.entries(row).map(([key, value]) => ({
      key,
      keyNorm: normalizeHeader(key),
      value,
    }));
    mappings.forEach((config) => {
      const aliasList = config.source.map((item) => normalizeHeader(item));
      const currentValue = aliasList
        .map(
          (alias) =>
            normalizedRowEntries.find((entry) => entry.keyNorm === alias)
              ?.value,
        )
        .find((value) => value !== undefined && value !== null && value !== '');
      if (
        currentValue === undefined ||
        currentValue === null ||
        currentValue === ''
      )
        return;
      const value = config.transform
        ? config.transform(currentValue, row)
        : currentValue;
      if (value === undefined || value === null || value === '') return;
      mapped[config.target] = value as never;
    });
    if (!mapped.documentType) {
      mapped.documentType = reportType === 'sales' ? 'SALE' : 'CASHBACK';
    }
    return mapped;
  }
}
