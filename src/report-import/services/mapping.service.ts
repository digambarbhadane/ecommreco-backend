import { Injectable } from '@nestjs/common';
import { amazonImportMapping } from '../config/importMappings/amazon.mapping';
import { flipkartImportMapping } from '../config/importMappings/flipkart.mapping';
import { headerMatchesExcelColumn } from '../config/importMappings/gst-column.util';
import {
  flipkartPaymentFieldMappings,
  type FlipkartPaymentFieldKey,
} from '../config/importMappings/flipkart-payment.mapping';
import {
  flipkartReturnFieldMappings,
  type FlipkartReturnFieldKey,
} from '../config/importMappings/flipkart-return.mapping';
import {
  amazonReturnFieldMappings,
  type AmazonReturnFieldKey,
} from '../config/importMappings/amazon-return.mapping';
import {
  resolveAmazonReturnDetails,
} from '../utils/amazon-return.util';
import {
  meeshoPaymentFieldMappings,
  type MeeshoPaymentFieldKey,
} from '../config/importMappings/meesho-payment.mapping';
import { normalizeHeader as normalizeHeaderUtil } from '../utils/header.util';
import { applyFlipkartInvoiceAmount } from '../utils/flipkart-invoice.util';
import {
  collectSellerRegistrationStateKeys,
  isSameIndianState,
  resolveIndianStateKey,
} from '../utils/gst-state.util';

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
  gstTransactionType?: 'intra' | 'inter';
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
  meeshoHasTcsReturn?: boolean;
  meeshoIsGrossSale?: boolean;
  meeshoIsPreviousMonthReturn?: boolean;
  meeshoReturnSubType?: 'cancellation' | 'rto' | 'customer_return' | 'na';
  amazonReturnSubType?: 'customer_return' | 'rto' | 'na';
  meeshoOrderStatus?: string;
  meeshoTcsReturnStatus?: string;
  /** Return line amounts from TCS Sales Return (kept separate from gross sales amounts on the row). */
  meeshoReturnInvoiceAmount?: number;
  meeshoReturnTaxableAmount?: number;
  meeshoReturnIgstAmount?: number;
  meeshoReturnCgstAmount?: number;
  meeshoReturnSgstAmount?: number;
  /** Meesho Order Payments sheet — matched on Sub Order No */
  liveOrderStatus?: string;
  transactionId?: string;
  paymentDate?: string;
  finalSettlementAmount?: number;
  priceType?: string;
  totalSaleAmountInclShippingGst?: number;
  totalSaleReturnAmountInclShippingGst?: number;
  fixedFeeInclGst?: number;
  warehousingFeeInclGst?: number;
  returnPremiumInclGst?: number;
  returnPremiumInclGstOfReturn?: number;
  meeshoCommissionPercentage?: number;
  meeshoCommissionInclGst?: number;
  meeshoGoldPlatformFeeInclGst?: number;
  meeshoMallPlatformFeeInclGst?: number;
  returnShippingChargeInclGst?: number;
  gstCompensationPrpShipping?: number;
  shippingChargeInclGst?: number;
  otherSupportServiceChargesExclGst?: number;
  waiversExclGst?: number;
  netOtherSupportServiceChargesExclGst?: number;
  gstOnNetOtherSupportServiceCharges?: number;
  paymentTcs?: number;
  tdsRatePercent?: number;
  tds?: number;
  compensation?: number;
  claims?: number;
  recovery?: number;
  compensationReason?: string;
  claimsReason?: string;
  recoveryReason?: string;
};

export type { MeeshoPaymentFieldKey };

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

/** GSTR Report Packed — primary join on order_id; also index alternate keys when present */
export const MYNTRA_GSTR_ORDER_ID_ALIASES = [
  'order_id',
  'order_release_id',
  'sale_order_code',
  'Sale_Order_Code',
  'shipment_id',
] as const;

/** MDirect Orders Report — join on order_release_id (matches Sale_Order_Code) */
export const MYNTRA_MDIRECT_ORDER_ID_ALIASES = [
  'order_release_id',
  'order_id',
  'sale_order_code',
  'Sale_Order_Code',
] as const;

/** GSTR Report RTO — match return rows to Sale_Order_Code when possible */
export const MYNTRA_GSTR_RTO_ORDER_ID_ALIASES = [
  'order_id',
  'shipment_id',
  'order_release_id',
  'sale_order_code',
] as const;

/** GSTR Report RT — join key on shipment_id (matches Sale_Order_Code) */
export const MYNTRA_GSTR_RT_ORDER_ID_ALIASES = [
  'shipment_id',
  'Shipment ID',
  'order_id',
  'Order ID',
] as const;

/** @deprecated Use MYNTRA_GSTR_RTO_ORDER_ID_ALIASES or MYNTRA_GSTR_RT_ORDER_ID_ALIASES */
export const MYNTRA_GSTR_RETURN_ORDER_ID_ALIASES = [
  ...MYNTRA_GSTR_RTO_ORDER_ID_ALIASES,
] as const;

/** MDirect Returns Report — join key (order_id only; not order_release_id) */
export const MYNTRA_MDIRECT_RETURNS_ORDER_ID_ALIASES = [
  'order_id',
  'Order ID',
  'Order Id',
  'Order Number',
  'Store Order Id',
] as const;

export const MYNTRA_DOCUMENT_TYPE_RTO = 'RTO Return';
export const MYNTRA_DOCUMENT_TYPE_CUSTOMER_RETURN = 'Customer Return';

/** @deprecated Use file-specific aliases above */
export const MYNTRA_ORDER_ID_ALIASES = [
  ...MYNTRA_SALES_ORDER_ID_ALIASES,
  ...MYNTRA_GSTR_ORDER_ID_ALIASES,
  ...MYNTRA_MDIRECT_ORDER_ID_ALIASES,
] as const;

export const normalizeStateName = (value?: string): string =>
  resolveIndianStateKey(value);

export const getRowCell = (
  row: ParsedSheetRow,
  ...aliases: string[]
): unknown => {
  const metaKeys = new Set(['__sheetName', '__rowNumber']);
  for (const alias of aliases) {
    for (const [key, value] of Object.entries(row)) {
      if (metaKeys.has(key)) continue;
      if (headerMatchesExcelColumn(key, alias)) {
        return value;
      }
    }
  }
  return undefined;
};

type MappingConfig = {
  source: string[];
  target: keyof NormalizedImportRow;
  transform?: (value: unknown, fullRow: ParsedSheetRow) => unknown;
};

export const normalizeHeader = normalizeHeaderUtil;

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
    source: [...flipkartImportMapping.gstin.excelColumns],
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
    source: [...flipkartImportMapping.gstin.excelColumns],
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
    source: [...amazonImportMapping.gstin.excelColumns],
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

// ─── exported types for fast header-map path ─────────────────────────────────

export type HeaderMapEntry = {
  target: keyof NormalizedImportRow;
  transform?: (value: unknown, row: ParsedSheetRow) => unknown;
};

/** Maps each actual sheet-column label → the first MappingConfig that matches it.
 *  Built once per file; used instead of per-row O(headers × aliases) scan. */
export type ColumnHeaderMap = Map<string, HeaderMapEntry>;

// ─────────────────────────────────────────────────────────────────────────────

/** GSTR Report Packed Excel headers → database fields */
const MYNTRA_GSTR_MAPPINGS: MappingConfig[] = [
  {
    source: ['seller_gstin', 'GST NO', 'GSTIN', 'Seller Gstin'],
    target: 'sellerGSTIN',
    transform: normalizeGstin,
  },
  {
    source: [...MYNTRA_GSTR_ORDER_ID_ALIASES, ...MYNTRA_SALES_ORDER_ID_ALIASES, 'Order ID'],
    target: 'orderID',
    transform: asString,
  },
  {
    source: ['payment_method', 'Payment Mode', 'Payment Method'],
    target: 'paymentMode',
    transform: asString,
  },
  {
    source: ['seller_type', 'Fulfilment Type', 'Fulfillment Type', 'Fulfilment Channel'],
    target: 'fulfilmentType',
    transform: asString,
  },
  { source: ['quantity', 'Quantity'], target: 'quantity', transform: asNumber },
  {
    source: ['seller_price', 'Invoice Amount'],
    target: 'invoiceAmount',
    transform: asNumber,
  },
  {
    source: ['base_value', 'Taxable Amount', 'Taxable Value'],
    target: 'taxableAmount',
    transform: asNumber,
  },
  { source: ['igst_rate', 'IGST Rate', 'Igst Rate'], target: 'igstRate', transform: asNumber },
  {
    source: ['igst_amt', 'IGST Amount', 'Igst Tax', 'Igst Amount'],
    target: 'igstAmount',
    transform: asNumber,
  },
  { source: ['cgst_rate', 'CGST Rate', 'Cgst Rate'], target: 'cgstRate', transform: asNumber },
  {
    source: ['cgst_amt', 'CGST Amount', 'Cgst Tax', 'Cgst Amount'],
    target: 'cgstAmount',
    transform: asNumber,
  },
  { source: ['sgst_rate', 'SGST Rate', 'Sgst Rate'], target: 'sgstRate', transform: asNumber },
  {
    source: ['sgst_amt', 'SGST Amount', 'Sgst Tax', 'Sgst Amount'],
    target: 'sgstAmount',
    transform: asNumber,
  },
  {
    source: ['customer_delivery_state_code', 'State Name', 'Ship To State'],
    target: 'stateName',
    transform: asString,
  },
];

/** MDirect Orders Report Excel headers → database fields */
const MYNTRA_MDIRECT_MAPPINGS: MappingConfig[] = [
  {
    source: ['seller_sku_code', 'SKU ID', 'SKU', 'Sku'],
    target: 'skuID',
    transform: asString,
  },
];

/** MDirect Returns Report Excel headers → database fields */
const MYNTRA_MDIRECT_RETURNS_MAPPINGS: MappingConfig[] = [
  {
    source: ['return_mode', 'Return Reason', 'Return Mode'],
    target: 'returnReason',
    transform: asString,
  },
  {
    source: ['return_reason', 'Detailed Return Reason', 'Return Reason Detail'],
    target: 'detailedReturnReason',
    transform: asString,
  },
];

/** Sales Revenue Packed B2C Excel headers → database fields */
const MYNTRA_SALES_REVENUE_MAPPINGS: MappingConfig[] = [
  {
    source: [...MYNTRA_SALES_ORDER_ID_ALIASES, 'Order ID', 'Order Id'],
    target: 'orderID',
    transform: asString,
  },
  {
    source: ['Invoice_Number', 'invoice_number', 'Invoice No', 'Invoice Number'],
    target: 'invoiceNo',
    transform: asString,
  },
  {
    source: ['Packing_Date', 'packing_date', 'Invoice Date'],
    target: 'invoiceDate',
    transform: asDate,
  },
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
  private readonly myntraGstrRowCache = new WeakMap<
    ParsedSheetRow,
    NormalizedImportRow
  >();
  private readonly myntraMdirectRowCache = new WeakMap<
    ParsedSheetRow,
    Pick<NormalizedImportRow, 'skuID'>
  >();
  private readonly myntraReturnsRowCache = new WeakMap<
    ParsedSheetRow,
    Pick<NormalizedImportRow, 'returnReason' | 'detailedReturnReason'>
  >();

  /**
   * Enforce GST component split using seller registration state vs customer state.
   * Intra-state => only CGST/SGST. Inter-state => only IGST.
   */
  normalizeTaxByState(
    mapped: NormalizedImportRow,
    sellerStates?: string | string[],
    sellerGstins?: string | string[],
  ): NormalizedImportRow {
    const states = Array.isArray(sellerStates)
      ? sellerStates
      : sellerStates
        ? [sellerStates]
        : [];
    const gstins = Array.isArray(sellerGstins)
      ? sellerGstins
      : sellerGstins
        ? [sellerGstins]
        : [];
    if (mapped.sellerGSTIN) {
      gstins.push(mapped.sellerGSTIN);
    }
    const sellerStateKeys = collectSellerRegistrationStateKeys(states, gstins);
    const canCompare =
      sellerStateKeys.size > 0 &&
      resolveIndianStateKey(mapped.stateName).length > 0;
    if (!canCompare) return mapped;

    const isIntraState = isSameIndianState(mapped.stateName, sellerStateKeys);

    if (isIntraState) {
      mapped.gstTransactionType = 'intra';
      const hasCgst =
        typeof mapped.cgstAmount === 'number' || typeof mapped.cgstRate === 'number';
      const hasSgst =
        typeof mapped.sgstAmount === 'number' || typeof mapped.sgstRate === 'number';

      if (!(hasCgst || hasSgst)) {
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
      }

      mapped.igstRate = undefined;
      mapped.igstAmount = undefined;
      return mapped;
    }

    mapped.gstTransactionType = 'inter';
    const hasIgst =
      typeof mapped.igstAmount === 'number' || typeof mapped.igstRate === 'number';
    if (!hasIgst) {
      const cgstRate = mapped.cgstRate;
      const sgstRate = mapped.sgstRate;
      const cgstAmount = mapped.cgstAmount;
      const sgstAmount = mapped.sgstAmount;
      if (
        typeof cgstRate === 'number' &&
        Number.isFinite(cgstRate) &&
        typeof sgstRate === 'number' &&
        Number.isFinite(sgstRate)
      ) {
        mapped.igstRate = cgstRate + sgstRate;
      }
      if (
        typeof cgstAmount === 'number' &&
        Number.isFinite(cgstAmount) &&
        typeof sgstAmount === 'number' &&
        Number.isFinite(sgstAmount)
      ) {
        mapped.igstAmount = cgstAmount + sgstAmount;
      }
    }

    mapped.cgstRate = undefined;
    mapped.cgstAmount = undefined;
    mapped.sgstRate = undefined;
    mapped.sgstAmount = undefined;
    return mapped;
  }

  mapMeeshoTcsSalesRow(
    row: ParsedSheetRow,
    sellerState?: string,
  ): NormalizedImportRow {
    const mapped = this.mapRow(row, 'sales', MEESHO_TCS_SALES_MAPPINGS);
    if (!mapped.documentType) {
      mapped.documentType = 'SALE';
    }
    return this.normalizeTaxByState(mapped, sellerState);
  }

  mapMeeshoTcsReturnRow(
    row: ParsedSheetRow,
    sellerState?: string,
  ): NormalizedImportRow {
    const mapped = this.mapRow(row, 'sales', MEESHO_TCS_SALES_MAPPINGS);
    mapped.documentType = 'RETURN';
    mapped.meeshoHasTcsReturn = true;
    const returnInvoiceDate = asDate(
      getRowCell(row, 'cancel_return_date', 'Return Invoice Date'),
    );
    if (returnInvoiceDate) {
      mapped.returnInvoiceDate = returnInvoiceDate;
      mapped.invoiceDate = returnInvoiceDate;
    }
    const typeOfReturn = asString(
      getRowCell(row, 'Type of Return', 'Return Type', 'type_of_return'),
    );
    const subType = asString(getRowCell(row, 'Sub Type', 'sub_type'));
    if (typeOfReturn) mapped.typeOfReturn = typeOfReturn;
    if (subType) mapped.subType = subType;
    return this.normalizeTaxByState(mapped, sellerState);
  }

  enrichMeeshoFromOrderReport(
    mapped: NormalizedImportRow,
    orderRow?: ParsedSheetRow,
  ): NormalizedImportRow {
    if (!orderRow) return mapped;
    const sku = asString(
      getRowCell(orderRow, 'SKU', 'SKU ID', 'sku'),
    );
    const orderStatus = asString(
      getRowCell(
        orderRow,
        'Status',
        'Order Status',
        'Live Order Status',
        'live order status',
        'Reason for Credit Entry',
        'reason for credit entry',
      ),
    );
    if (sku) mapped.skuID = sku;
    if (orderStatus) mapped.meeshoOrderStatus = orderStatus;
    return mapped;
  }

  enrichMeeshoFromTcsSalesReturn(
    mapped: NormalizedImportRow,
    returnRow?: ParsedSheetRow,
    sellerState?: string,
  ): NormalizedImportRow {
    if (!returnRow) return mapped;
    mapped.meeshoHasTcsReturn = true;
    const returnInvoiceDate = asDate(
      getRowCell(returnRow, 'cancel_return_date', 'Return Invoice Date'),
    );
    if (returnInvoiceDate) mapped.returnInvoiceDate = returnInvoiceDate;
    const tcsReturnStatus = asString(
      getRowCell(
        returnRow,
        'Status',
        'Return Status',
        'Order Status',
        'status',
      ),
    );
    if (tcsReturnStatus) mapped.meeshoTcsReturnStatus = tcsReturnStatus;
    const typeOfReturn = asString(
      getRowCell(returnRow, 'Type of Return', 'Return Type', 'type_of_return'),
    );
    const subType = asString(getRowCell(returnRow, 'Sub Type', 'sub_type'));
    if (typeOfReturn) mapped.typeOfReturn = typeOfReturn;
    if (subType) mapped.subType = subType;

    const returnMapped = this.mapMeeshoTcsReturnRow(returnRow, sellerState);
    if (returnMapped.invoiceAmount !== undefined) {
      mapped.meeshoReturnInvoiceAmount = returnMapped.invoiceAmount;
    }
    if (returnMapped.taxableAmount !== undefined) {
      mapped.meeshoReturnTaxableAmount = returnMapped.taxableAmount;
    }
    if (returnMapped.igstAmount !== undefined) {
      mapped.meeshoReturnIgstAmount = returnMapped.igstAmount;
    }
    if (returnMapped.cgstAmount !== undefined) {
      mapped.meeshoReturnCgstAmount = returnMapped.cgstAmount;
    }
    if (returnMapped.sgstAmount !== undefined) {
      mapped.meeshoReturnSgstAmount = returnMapped.sgstAmount;
    }
    if (returnMapped.quantity !== undefined) {
      mapped.returnQty = returnMapped.quantity;
    }

    return mapped;
  }

  enrichMeeshoFromLifecycleReturnReport(
    mapped: NormalizedImportRow,
    returnRow?: ParsedSheetRow,
  ): NormalizedImportRow {
    if (!returnRow) return mapped;
    const typeOfReturn = asString(
      getRowCell(returnRow, 'Type of Return', 'Return Type'),
    );
    const subType = asString(getRowCell(returnRow, 'Sub Type'));
    const returnQty = asNumber(getRowCell(returnRow, 'Qty', 'Return Qty'));
    const returnReason = asString(
      getRowCell(returnRow, 'Return Reason', 'Reason for Return'),
    );
    const detailedReturnReason = asString(
      getRowCell(returnRow, 'Detailed Return Reason', 'Detailed Return'),
    );
    if (typeOfReturn) mapped.typeOfReturn = typeOfReturn;
    if (subType) mapped.subType = subType;
    if (returnQty !== undefined) mapped.returnQty = returnQty;
    if (returnReason) mapped.returnReason = returnReason;
    if (detailedReturnReason) mapped.detailedReturnReason = detailedReturnReason;
    return mapped;
  }

  mapMeeshoPaymentFields(
    paymentRow: ParsedSheetRow,
  ): Pick<NormalizedImportRow, MeeshoPaymentFieldKey> {
    const numericTargets = new Set<MeeshoPaymentFieldKey>([
      'finalSettlementAmount',
      'totalSaleAmountInclShippingGst',
      'totalSaleReturnAmountInclShippingGst',
      'fixedFeeInclGst',
      'warehousingFeeInclGst',
      'returnPremiumInclGst',
      'returnPremiumInclGstOfReturn',
      'meeshoCommissionPercentage',
      'meeshoCommissionInclGst',
      'meeshoGoldPlatformFeeInclGst',
      'meeshoMallPlatformFeeInclGst',
      'returnShippingChargeInclGst',
      'gstCompensationPrpShipping',
      'shippingChargeInclGst',
      'otherSupportServiceChargesExclGst',
      'waiversExclGst',
      'netOtherSupportServiceChargesExclGst',
      'gstOnNetOtherSupportServiceCharges',
      'paymentTcs',
      'tdsRatePercent',
      'tds',
      'compensation',
      'claims',
      'recovery',
    ]);
    const dateTargets = new Set<MeeshoPaymentFieldKey>(['paymentDate']);
    const out = {} as Pick<NormalizedImportRow, MeeshoPaymentFieldKey>;

    for (const mapping of meeshoPaymentFieldMappings) {
      const raw = getRowCell(paymentRow, ...mapping.source);
      if (raw === undefined) continue;
      let value: string | number | undefined;
      if (dateTargets.has(mapping.target)) {
        value = asDate(raw);
      } else if (numericTargets.has(mapping.target)) {
        value = asNumber(raw);
      } else {
        value = asString(raw);
      }
      if (value !== undefined) {
        out[mapping.target] = value as never;
      }
    }
    return out;
  }

  mapFlipkartPaymentFields(
    paymentRow: ParsedSheetRow,
  ): Pick<NormalizedImportRow, FlipkartPaymentFieldKey> {
    const numericTargets = new Set<FlipkartPaymentFieldKey>(['finalSettlementAmount']);
    const dateTargets = new Set<FlipkartPaymentFieldKey>(['paymentDate']);
    const out = {} as Pick<NormalizedImportRow, FlipkartPaymentFieldKey>;

    for (const mapping of flipkartPaymentFieldMappings) {
      const raw = getRowCell(paymentRow, ...mapping.source);
      if (raw === undefined) continue;
      let value: string | number | undefined;
      if (dateTargets.has(mapping.target)) {
        value = asDate(raw);
      } else if (numericTargets.has(mapping.target)) {
        value = asNumber(raw);
      } else {
        value = asString(raw);
      }
      if (value !== undefined) {
        out[mapping.target] = value as never;
      }
    }
    return out;
  }

  mapFlipkartReturnFields(
    returnRow: ParsedSheetRow,
  ): Pick<
    NormalizedImportRow,
    FlipkartReturnFieldKey
  > {
    const out = {} as Pick<NormalizedImportRow, FlipkartReturnFieldKey>;

    for (const mapping of flipkartReturnFieldMappings) {
      const raw = getRowCell(returnRow, ...mapping.source);
      const value = asString(raw);
      if (value !== undefined) {
        out[mapping.target] = value as never;
      }
    }
    const hasOtherReturnDetail =
      Boolean(out.returnReason) || Boolean(out.detailedReturnReason);
    if (hasOtherReturnDetail && !out.typeOfReturn) {
      out.typeOfReturn = '#N/A';
    }
    return out;
  }

  mapAmazonReturnFields(
    returnRow: ParsedSheetRow,
  ): Pick<NormalizedImportRow, AmazonReturnFieldKey | 'amazonReturnSubType'> {
    let returnType = '';
    for (const mapping of amazonReturnFieldMappings) {
      const raw = getRowCell(returnRow, ...mapping.source);
      const value = asString(raw);
      if (value !== undefined) {
        returnType = value;
      }
    }

    const orderId = asString(
      getRowCell(returnRow, 'Order Id', 'Order ID', 'order_id', 'Order Number'),
    ) ?? '';

    return resolveAmazonReturnDetails(returnType, orderId);
  }

  enrichAmazonFromReturnReport(
    mapped: NormalizedImportRow,
    returnDetails?: Pick<
      NormalizedImportRow,
      'typeOfReturn' | 'amazonReturnSubType'
    > | null,
  ): NormalizedImportRow {
    if (!returnDetails) return mapped;
    return {
      ...mapped,
      ...(returnDetails.typeOfReturn
        ? { typeOfReturn: returnDetails.typeOfReturn }
        : {}),
      ...(returnDetails.amazonReturnSubType
        ? { amazonReturnSubType: returnDetails.amazonReturnSubType }
        : {}),
    };
  }

  enrichMeeshoFromPaymentReport(
    mapped: NormalizedImportRow,
    paymentRow?: ParsedSheetRow,
  ): NormalizedImportRow {
    if (!paymentRow) return mapped;
    return { ...mapped, ...this.mapMeeshoPaymentFields(paymentRow) };
  }

  mapSalesRow(row: ParsedSheetRow): NormalizedImportRow {
    return applyFlipkartInvoiceAmount(this.mapRow(row, 'sales', SALES_MAPPINGS));
  }

  mapCashbackRow(row: ParsedSheetRow): NormalizedImportRow {
    return applyFlipkartInvoiceAmount(
      this.mapRow(row, 'cashback', CASHBACK_MAPPINGS),
    );
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
    const base: NormalizedImportRow = gstrRow
      ? { ...this.getCachedMyntraGstrRow(gstrRow) }
      : { reportType: 'sales', documentType: 'SALE' };
    if (mDirectRow) {
      const skuID = this.getCachedMyntraMdirectSku(mDirectRow);
      if (skuID) base.skuID = skuID;
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
      const cached = this.getCachedMyntraReturnsFields(options.mDirectReturnsRow);
      if (cached.returnReason) base.returnReason = cached.returnReason;
      if (cached.detailedReturnReason) {
        base.detailedReturnReason = cached.detailedReturnReason;
      }
    }
    return base;
  }

  private getCachedMyntraGstrRow(gstrRow: ParsedSheetRow): NormalizedImportRow {
    const cached = this.myntraGstrRowCache.get(gstrRow);
    if (cached) return cached;
    const mapped = this.mapRow(gstrRow, 'sales', MYNTRA_GSTR_MAPPINGS);
    if (!mapped.documentType) mapped.documentType = 'SALE';
    this.myntraGstrRowCache.set(gstrRow, mapped);
    return mapped;
  }

  private getCachedMyntraMdirectSku(mDirectRow: ParsedSheetRow): string | undefined {
    const cached = this.myntraMdirectRowCache.get(mDirectRow);
    if (cached) return cached.skuID;
    const fromMdirect = this.mapRow(mDirectRow, 'sales', MYNTRA_MDIRECT_MAPPINGS);
    this.myntraMdirectRowCache.set(mDirectRow, { skuID: fromMdirect.skuID });
    return fromMdirect.skuID;
  }

  private getCachedMyntraReturnsFields(returnsRow: ParsedSheetRow): Pick<
    NormalizedImportRow,
    'returnReason' | 'detailedReturnReason'
  > {
    const cached = this.myntraReturnsRowCache.get(returnsRow);
    if (cached) return cached;
    const fromReturns = this.mapRow(
      returnsRow,
      'sales',
      MYNTRA_MDIRECT_RETURNS_MAPPINGS,
    );
    const fields = {
      returnReason: fromReturns.returnReason,
      detailedReturnReason: fromReturns.detailedReturnReason,
    };
    this.myntraReturnsRowCache.set(returnsRow, fields);
    return fields;
  }

  // ─── Fast path: build a per-file lookup map once, then map each row in O(cols) ──

  /**
   * Build a header→config map from the actual column labels present in a sheet.
   * Call once per file; pass the result to mapRowFast() for each data row.
   * This replaces the per-row O(headers × aliases × mappings) scan with a one-time
   * O(headers × aliases) setup and per-row O(headers) lookup.
   */
  buildHeaderMap(headers: string[], mappings: MappingConfig[]): ColumnHeaderMap {
    const map: ColumnHeaderMap = new Map();
    for (const header of headers) {
      if (header === '__sheetName' || header === '__rowNumber') continue;
      const hNorm = normalizeHeader(header);
      if (!hNorm) continue;
      for (const config of mappings) {
        let matched = false;
        for (const alias of config.source) {
          const aNorm = normalizeHeader(alias);
          if (aNorm && (hNorm === aNorm || hNorm.includes(aNorm))) {
            matched = true;
            break;
          }
        }
        if (matched) {
          map.set(header, { target: config.target, transform: config.transform });
          break; // first winning config per header
        }
      }
    }
    return map;
  }

  /** Map a single data row using a pre-built ColumnHeaderMap — O(cols) per row. */
  mapRowFast(
    row: ParsedSheetRow,
    reportType: 'sales' | 'cashback',
    headerMap: ColumnHeaderMap,
  ): NormalizedImportRow {
    const mapped: NormalizedImportRow = { reportType, documentType: '' };
    for (const [key, value] of Object.entries(row)) {
      if (key === '__sheetName' || key === '__rowNumber') continue;
      const config = headerMap.get(key);
      if (!config || value === null || value === undefined || value === '') continue;
      const xformed = config.transform ? config.transform(value, row) : value;
      if (xformed !== undefined && xformed !== null && xformed !== '') {
        (mapped as Record<string, unknown>)[config.target] = xformed;
      }
    }
    if (!mapped.documentType) {
      mapped.documentType = reportType === 'sales' ? 'SALE' : 'CASHBACK';
    }
    return mapped;
  }

  // Convenience builders for the 4 Myntra file types

  buildMyntraGstrHeaderMap(headers: string[]): ColumnHeaderMap {
    return this.buildHeaderMap(headers, MYNTRA_GSTR_MAPPINGS);
  }

  buildMyntraMdirectHeaderMap(headers: string[]): ColumnHeaderMap {
    return this.buildHeaderMap(headers, MYNTRA_MDIRECT_MAPPINGS);
  }

  buildMyntraSalesHeaderMap(headers: string[]): ColumnHeaderMap {
    return this.buildHeaderMap(headers, MYNTRA_SALES_REVENUE_MAPPINGS);
  }

  buildMyntraMdirectReturnsHeaderMap(headers: string[]): ColumnHeaderMap {
    return this.buildHeaderMap(headers, MYNTRA_MDIRECT_RETURNS_MAPPINGS);
  }

  // ─────────────────────────────────────────────────────────────────────────────

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
      const aliasList = config.source;
      const currentValue = aliasList
        .map((alias) => {
          const exact = normalizedRowEntries.find(
            (entry) => entry.keyNorm === normalizeHeader(alias),
          )?.value;
          if (exact !== undefined && exact !== null && exact !== '') {
            return exact;
          }
          const fuzzy = normalizedRowEntries.find((entry) =>
            headerMatchesExcelColumn(entry.key, alias),
          )?.value;
          return fuzzy;
        })
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
