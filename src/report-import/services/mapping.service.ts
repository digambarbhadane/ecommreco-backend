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
  customerGstNo?: string;
  buyerName?: string;
  returnInvoiceDate?: string;
  typeOfReturn?: string;
  subType?: string;
  returnQty?: number;
  returnReason?: string;
  detailedReturnReason?: string;
};

/** Column names used as order key across Meesho reports (matched after normalizeHeader). */
export const MEESHO_ORDER_ID_ALIASES = [
  'sub_order_num',
  'Order ID',
  'Sub Order No',
  'Order Number',
] as const;

/** Sales Revenue Packed B2C — join key and invoice fields */
export const MYNTRA_SALES_ORDER_ID_ALIASES = [
  'Sale_Order_Code',
  'sale_order_code',
] as const;

/** GSTR Report Packed — join key on order_id */
export const MYNTRA_GSTR_ORDER_ID_ALIASES = ['order_id'] as const;

/** MDirect Orders Report — join key on order_release_id */
export const MYNTRA_MDIRECT_ORDER_ID_ALIASES = ['order_release_id'] as const;

/** GSTR Report RTO — join key on order_id */
export const MYNTRA_GSTR_RTO_ORDER_ID_ALIASES = ['order_id'] as const;

/** GSTR Report RT — join key on shipment_id (matches Sale_Order_Code) */
export const MYNTRA_GSTR_RT_ORDER_ID_ALIASES = ['shipment_id'] as const;

/** @deprecated Use MYNTRA_GSTR_RTO_ORDER_ID_ALIASES or MYNTRA_GSTR_RT_ORDER_ID_ALIASES */
export const MYNTRA_GSTR_RETURN_ORDER_ID_ALIASES = [
  ...MYNTRA_GSTR_RTO_ORDER_ID_ALIASES,
] as const;

/** MDirect Returns Report — join key */
export const MYNTRA_MDIRECT_RETURNS_ORDER_ID_ALIASES = [
  'order_release_id',
  'order_id',
] as const;

export const MYNTRA_DOCUMENT_TYPE_RTO = 'RTO Return';
export const MYNTRA_DOCUMENT_TYPE_CUSTOMER_RETURN = 'Customer Return';

/** @deprecated Use file-specific aliases above */
export const MYNTRA_ORDER_ID_ALIASES = [
  ...MYNTRA_SALES_ORDER_ID_ALIASES,
  ...MYNTRA_GSTR_ORDER_ID_ALIASES,
  ...MYNTRA_MDIRECT_ORDER_ID_ALIASES,
] as const;

export const normalizeStateName = (value?: string): string => {
  if (!value) return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ');
};

export const getRowCell = (
  row: ParsedSheetRow,
  ...aliases: string[]
): unknown => {
  const aliasSet = new Set(aliases.map((item) => normalizeHeader(item)));
  const entry = Object.entries(row).find(
    ([key]) =>
      !key.startsWith('__') && aliasSet.has(normalizeHeader(key)),
  );
  return entry?.[1];
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

const AMAZON_MAPPINGS: MappingConfig[] = [
  {
    source: ['Seller Gstin', 'Seller GSTIN', 'GST NO'],
    target: 'sellerGSTIN',
    transform: normalizeGstin,
  },
  { source: ['Order Id', 'Order ID'], target: 'orderID', transform: asString },
  { source: ['Sku', 'SKU'], target: 'skuID', transform: asString },
  { source: ['Hsn/sac', 'HSN Code'], target: 'hsnCode', transform: asString },
  {
    source: ['Transaction Type'],
    target: 'voucherType',
    transform: asString,
  },
  {
    source: ['Transaction Type'],
    target: 'documentType',
    transform: asString,
  },
  {
    source: ['Payment Method', 'Payment Mode', 'Payment Method Code'],
    target: 'paymentMode',
    transform: asString,
  },
  {
    source: ['Fulfillment Channel', 'Fullfilment Channel', 'Fulfilment Type'],
    target: 'fulfilmentType',
    transform: asString,
  },
  { source: ['Quantity'], target: 'quantity', transform: asNumber },
  {
    source: ['Invoice Amount'],
    target: 'invoiceAmount',
    transform: asNumber,
  },
  {
    source: ['Tax Exclusive Gross', 'Taxable Amount', 'Taxable Value'],
    target: 'taxableAmount',
    transform: asNumber,
  },
  { source: ['Igst Rate', 'IGST Rate'], target: 'igstRate', transform: asNumber },
  { source: ['Igst Tax', 'IGST Amount'], target: 'igstAmount', transform: asNumber },
  { source: ['Cgst Rate', 'CGST Rate'], target: 'cgstRate', transform: asNumber },
  { source: ['Cgst Tax', 'CGST Amount'], target: 'cgstAmount', transform: asNumber },
  { source: ['Sgst Rate', 'SGST Rate'], target: 'sgstRate', transform: asNumber },
  { source: ['Sgst Tax', 'SGST Amount'], target: 'sgstAmount', transform: asNumber },
  {
    source: ['Invoice Number', 'Invoice No'],
    target: 'invoiceNo',
    transform: asString,
  },
  { source: ['Invoice Date'], target: 'invoiceDate', transform: asDate },
  {
    source: ['Ship To Postal Code', 'Pincode'],
    target: 'pincode',
    transform: asString,
  },
  {
    source: ['Ship To State', 'State Name'],
    target: 'stateName',
    transform: asString,
  },
  {
    source: ['Customer Bill To Gstid', 'Customer GST No'],
    target: 'customerGstNo',
    transform: asString,
  },
  {
    source: ['Buyer Name'],
    target: 'buyerName',
    transform: asString,
  },
];

/** GSTR Report Packed Excel headers → database fields */
const MYNTRA_GSTR_MAPPINGS: MappingConfig[] = [
  { source: ['seller_gstin'], target: 'sellerGSTIN', transform: normalizeGstin },
  {
    source: [...MYNTRA_GSTR_ORDER_ID_ALIASES, ...MYNTRA_SALES_ORDER_ID_ALIASES],
    target: 'orderID',
    transform: asString,
  },
  { source: ['payment_method'], target: 'paymentMode', transform: asString },
  { source: ['seller_type'], target: 'fulfilmentType', transform: asString },
  { source: ['quantity'], target: 'quantity', transform: asNumber },
  { source: ['seller_price'], target: 'invoiceAmount', transform: asNumber },
  { source: ['base_value'], target: 'taxableAmount', transform: asNumber },
  { source: ['igst_rate'], target: 'igstRate', transform: asNumber },
  { source: ['igst_amt'], target: 'igstAmount', transform: asNumber },
  { source: ['cgst_rate'], target: 'cgstRate', transform: asNumber },
  { source: ['cgst_amt'], target: 'cgstAmount', transform: asNumber },
  { source: ['sgst_rate'], target: 'sgstRate', transform: asNumber },
  { source: ['sgst_amt'], target: 'sgstAmount', transform: asNumber },
  {
    source: ['customer_delivery_state_code'],
    target: 'stateName',
    transform: asString,
  },
];

/** MDirect Orders Report Excel headers → database fields */
const MYNTRA_MDIRECT_MAPPINGS: MappingConfig[] = [
  { source: ['seller_sku_code'], target: 'skuID', transform: asString },
];

/** MDirect Returns Report Excel headers → database fields */
const MYNTRA_MDIRECT_RETURNS_MAPPINGS: MappingConfig[] = [
  { source: ['return_mode'], target: 'returnReason', transform: asString },
  {
    source: ['return_reason'],
    target: 'detailedReturnReason',
    transform: asString,
  },
];

/** Sales Revenue Packed B2C Excel headers → database fields */
const MYNTRA_SALES_REVENUE_MAPPINGS: MappingConfig[] = [
  {
    source: [...MYNTRA_SALES_ORDER_ID_ALIASES],
    target: 'orderID',
    transform: asString,
  },
  { source: ['Invoice_Number', 'invoice_number'], target: 'invoiceNo', transform: asString },
  { source: ['Packing_Date', 'packing_date'], target: 'invoiceDate', transform: asDate },
];

const MEESHO_TCS_SALES_MAPPINGS: MappingConfig[] = [
  { source: ['gstin', 'GST NO'], target: 'sellerGSTIN', transform: normalizeGstin },
  {
    source: [...MEESHO_ORDER_ID_ALIASES],
    target: 'orderID',
    transform: asString,
  },
  { source: ['hsn_code', 'HSN Code'], target: 'hsnCode', transform: asString },
  { source: ['quantity', 'Quantity'], target: 'quantity', transform: asNumber },
  {
    source: ['total_invoice_value', 'Invoice Amount'],
    target: 'invoiceAmount',
    transform: asNumber,
  },
  {
    source: ['total_taxable_sale_value', 'Taxable Amount'],
    target: 'taxableAmount',
    transform: asNumber,
  },
  { source: ['gst_rate', 'IGST Rate'], target: 'igstRate', transform: asNumber },
  { source: ['tax_amount', 'IGST Amount'], target: 'igstAmount', transform: asNumber },
  {
    source: ['order_date', 'Invoice Date'],
    target: 'invoiceDate',
    transform: asDate,
  },
  {
    source: ['end_customer_state_new', 'State Name'],
    target: 'stateName',
    transform: asString,
  },
];

@Injectable()
export class MappingService {
  mapMeeshoTcsSalesRow(
    row: ParsedSheetRow,
    sellerState?: string,
  ): NormalizedImportRow {
    const mapped = this.mapRow(row, 'sales', MEESHO_TCS_SALES_MAPPINGS);
    if (!mapped.documentType) {
      mapped.documentType = 'SALE';
    }

    const sellerStateNorm = normalizeStateName(sellerState);
    const customerStateNorm = normalizeStateName(mapped.stateName);
    const isIntraState =
      sellerStateNorm.length > 0 &&
      customerStateNorm.length > 0 &&
      sellerStateNorm === customerStateNorm;

    if (isIntraState) {
      const igstRate = mapped.igstRate;
      const igstAmount = mapped.igstAmount;
      if (typeof igstRate === 'number' && Number.isFinite(igstRate)) {
        mapped.cgstRate = igstRate / 2;
        mapped.sgstRate = igstRate / 2;
      }
      if (typeof igstAmount === 'number' && Number.isFinite(igstAmount)) {
        mapped.cgstAmount = igstAmount / 2;
        mapped.sgstAmount = igstAmount / 2;
      }
    } else {
      mapped.cgstRate = undefined;
      mapped.cgstAmount = undefined;
      mapped.sgstRate = undefined;
      mapped.sgstAmount = undefined;
    }

    return mapped;
  }

  enrichMeeshoFromOrderReport(
    mapped: NormalizedImportRow,
    orderRow?: ParsedSheetRow,
  ): NormalizedImportRow {
    if (!orderRow) return mapped;
    const sku = asString(getRowCell(orderRow, 'SKU', 'SKU ID'));
    const documentType = asString(
      getRowCell(orderRow, 'Reason for Credit Entry', 'Document Type'),
    );
    if (sku) mapped.skuID = sku;
    if (documentType) mapped.documentType = documentType;
    return mapped;
  }

  enrichMeeshoFromTcsSalesReturn(
    mapped: NormalizedImportRow,
    returnRow?: ParsedSheetRow,
  ): NormalizedImportRow {
    if (!returnRow) return mapped;
    const returnInvoiceDate = asDate(
      getRowCell(returnRow, 'cancel_return_date', 'Return Invoice Date'),
    );
    if (returnInvoiceDate) mapped.returnInvoiceDate = returnInvoiceDate;
    return mapped;
  }

  enrichMeeshoFromReturnReport(
    mapped: NormalizedImportRow,
    returnRow?: ParsedSheetRow,
  ): NormalizedImportRow {
    if (!returnRow) return mapped;
    const typeOfReturn = asString(getRowCell(returnRow, 'Type of Return'));
    const subType = asString(getRowCell(returnRow, 'Sub Type'));
    const returnQty = asNumber(getRowCell(returnRow, 'Qty', 'Return Qty'));
    const returnReason = asString(getRowCell(returnRow, 'Return Reason'));
    const detailedReturnReason = asString(
      getRowCell(returnRow, 'Detailed Return Reason'),
    );
    if (typeOfReturn) mapped.typeOfReturn = typeOfReturn;
    if (subType) mapped.subType = subType;
    if (returnQty !== undefined) mapped.returnQty = returnQty;
    if (returnReason) mapped.returnReason = returnReason;
    if (detailedReturnReason) mapped.detailedReturnReason = detailedReturnReason;
    return mapped;
  }

  mapSalesRow(row: ParsedSheetRow): NormalizedImportRow {
    return this.mapRow(row, 'sales', SALES_MAPPINGS);
  }

  mapCashbackRow(row: ParsedSheetRow): NormalizedImportRow {
    return this.mapRow(row, 'cashback', CASHBACK_MAPPINGS);
  }

  mapAmazonRow(row: ParsedSheetRow): NormalizedImportRow {
    return this.mapRow(row, 'sales', AMAZON_MAPPINGS);
  }

  mapMyntraSalesRow(
    salesRow: ParsedSheetRow,
    mDirectRow?: ParsedSheetRow,
    gstrRow?: ParsedSheetRow,
    options?: {
      isRtoReturn?: boolean;
      isCustomerReturn?: boolean;
      mDirectReturnsRow?: ParsedSheetRow;
    },
  ): NormalizedImportRow {
    const base = gstrRow
      ? this.mapRow(gstrRow, 'sales', MYNTRA_GSTR_MAPPINGS)
      : ({ reportType: 'sales' as const, documentType: 'SALE' });
    if (mDirectRow) {
      const fromMdirect = this.mapRow(mDirectRow, 'sales', MYNTRA_MDIRECT_MAPPINGS);
      if (fromMdirect.skuID) base.skuID = fromMdirect.skuID;
    }
    const fromSales = this.mapRow(salesRow, 'sales', MYNTRA_SALES_REVENUE_MAPPINGS);
    if (fromSales.orderID) base.orderID = fromSales.orderID;
    if (fromSales.invoiceNo) base.invoiceNo = fromSales.invoiceNo;
    if (fromSales.invoiceDate) base.invoiceDate = fromSales.invoiceDate;
    if (options?.isRtoReturn) {
      base.documentType = MYNTRA_DOCUMENT_TYPE_RTO;
      base.typeOfReturn = MYNTRA_DOCUMENT_TYPE_RTO;
    } else if (options?.isCustomerReturn) {
      base.documentType = MYNTRA_DOCUMENT_TYPE_CUSTOMER_RETURN;
      base.typeOfReturn = MYNTRA_DOCUMENT_TYPE_CUSTOMER_RETURN;
    } else if (!base.documentType) {
      base.documentType = 'SALE';
    }
    if (options?.mDirectReturnsRow) {
      return this.enrichMyntraFromReturns(base, options.mDirectReturnsRow);
    }
    return base;
  }

  enrichMyntraFromReturns(
    mapped: NormalizedImportRow,
    returnsRow: ParsedSheetRow,
  ): NormalizedImportRow {
    const fromReturns = this.mapRow(
      returnsRow,
      'sales',
      MYNTRA_MDIRECT_RETURNS_MAPPINGS,
    );
    if (fromReturns.returnReason) mapped.returnReason = fromReturns.returnReason;
    if (fromReturns.detailedReturnReason) {
      mapped.detailedReturnReason = fromReturns.detailedReturnReason;
    }
    return mapped;
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
