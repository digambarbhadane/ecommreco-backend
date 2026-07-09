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
import {
  asImportDateDmy,
  asImportDateIso,
} from '../utils/import-date.util';
import { normalizeHeader as normalizeHeaderUtil } from '../utils/header.util';
import { applyFlipkartInvoiceAmount } from '../utils/flipkart-invoice.util';
import {
  buildSellerGstContext,
  normalizeImportRowGst,
} from '../../common/services/gst-calculation.core';
import { resolveIndianStateKey, resolveIndianStateCode } from '../utils/gst-state.util';

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
  gstAmount?: number;
  gstTransactionType?: 'intra' | 'inter';
  invoiceNo?: string;
  buyerInvoiceDate?: string;
  invoiceDate?: string;
  order_packed_date?: string;
  order_created_date?: string;
  /** Myntra GSTR RTO — ISO date (YYYY-MM-DD) */
  orderCancelDate?: string;
  /** Myntra GSTR RT — ISO date (YYYY-MM-DD) */
  frRefundedDate?: string;
  pincode?: string;
  stateName?: string;
  customerStateCode?: string;
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
  myntraTransactionType?: 'SALE' | 'RETURN';
  myntraReturnMatchStatus?:
    | 'MATCHED_CURRENT_MONTH'
    | 'MATCHED_PREVIOUS_MONTH'
    | 'UNMATCHED_RETURN';
  myntraIsReturned?: boolean;
  linkedSaleRowId?: string;
  saleReferenceMonth?: string;
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

export const MYNTRA_SALES_ORDER_ID_ALIASES = [
  'Sale_Order_Code',
  'sale_order_code',
] as const;

export const MYNTRA_GSTR_ORDER_ID_ALIASES = [
  'order_id',
  'order_release_id',
  'sale_order_code',
  'Sale_Order_Code',
  'shipment_id',
] as const;

export const MYNTRA_MDIRECT_ORDER_ID_ALIASES = [
  'order_release_id',
  'order_id',
  'sale_order_code',
  'Sale_Order_Code',
] as const;

export const MYNTRA_GSTR_RTO_ORDER_ID_ALIASES = [
  'order_id',
  'Order ID',
  'Order Id',
  'order_release_id',
  'sale_order_code',
  'Sale_Order_Code',
] as const;

export const MYNTRA_GSTR_RT_ORDER_ID_ALIASES = [
  'order_id',
  'Order ID',
  'Order Id',
  'order_release_id',
  'sale_order_code',
  'Sale_Order_Code',
] as const;

export const MYNTRA_MDIRECT_RETURNS_ORDER_ID_ALIASES = [
  'order_id',
  'Order ID',
  'Order Id',
  'Order Number',
  'Store Order Id',
] as const;

export const MYNTRA_DOCUMENT_TYPE_RTO = 'RTO Return';
export const MYNTRA_DOCUMENT_TYPE_CUSTOMER_RETURN = 'Customer Return';

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
    .replace(/[,\s₹$%]/g, '')
    .trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const asDate = asImportDateIso;
const asDmyDate = asImportDateDmy;
const asIndianStateCode = (value: unknown): string | undefined => {
  const code = resolveIndianStateCode(
    value === null || value === undefined ? undefined : String(value),
  );
  return code || undefined;
};
const asIndianStateLabel = (value: unknown): string | undefined => {
  const key = resolveIndianStateKey(
    value === null || value === undefined ? undefined : String(value),
  );
  return key || asString(value);
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
  { source: ['pincode', 'Pincode'], target: 'pincode', transform: asString },
  {
    source: [
      'customer_delivery_state',
      'customer_delivery_state_code',
      'State Name',
      'Ship To State',
    ],
    target: 'stateName',
    transform: asIndianStateLabel,
  },
  {
    source: ['customer_delivery_state_code', 'State Name', 'Ship To State'],
    target: 'customerStateCode',
    transform: asIndianStateCode,
  },
  {
    source: ['order_packed_date', 'Order Packed Date', 'Packed Date'],
    target: 'order_packed_date',
    transform: asDmyDate,
  },
];

const MYNTRA_GSTR_RTO_MAPPINGS: MappingConfig[] = [
  {
    source: ['tax_seller_gstin', 'seller_gstin', 'GST NO', 'GSTIN'],
    target: 'sellerGSTIN',
    transform: normalizeGstin,
  },
  {
    source: [...MYNTRA_GSTR_RTO_ORDER_ID_ALIASES, 'Order ID'],
    target: 'orderID',
    transform: asString,
  },
  {
    source: ['order_cancel_date', 'Order Cancel Date', 'Cancel Date'],
    target: 'orderCancelDate',
    transform: asDate,
  },
  {
    source: ['invoice_number', 'Invoice_Number', 'Invoice No', 'Invoice Number'],
    target: 'invoiceNo',
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
  { source: ['quantity', 'Quantity', 'Qty'], target: 'quantity', transform: asNumber },
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
  {
    source: [
      'igst_rate',
      'IGST Rate',
      'Igst Rate',
      'Igst_Rate',
      'IGST_Rate',
      'Igst Rate %',
      'IGST Rate %',
      'IGST %',
      'tax_rate',
      'gst_rate',
    ],
    target: 'igstRate',
    transform: asNumber,
  },
  {
    source: [
      'igst_amt',
      'IGST Amount',
      'Igst Tax',
      'Igst Amount',
      'Igst_Amt',
      'tax_amount',
      'gst_amount',
    ],
    target: 'igstAmount',
    transform: asNumber,
  },
  {
    source: ['cgst_rate', 'CGST Rate', 'Cgst Rate', 'Cgst_Rate', 'CGST_Rate', 'CGST %'],
    target: 'cgstRate',
    transform: asNumber,
  },
  {
    source: [
      'cgst_amt',
      'CGST Amount',
      'Cgst Tax',
      'Cgst Amount',
      'Cgst_Amt',
    ],
    target: 'cgstAmount',
    transform: asNumber,
  },
  {
    source: ['sgst_rate', 'SGST Rate', 'Sgst Rate', 'Sgst_Rate', 'SGST_Rate', 'SGST %'],
    target: 'sgstRate',
    transform: asNumber,
  },
  {
    source: [
      'sgst_amt',
      'SGST Amount',
      'Sgst Tax',
      'Sgst Amount',
      'Sgst_Amt',
    ],
    target: 'sgstAmount',
    transform: asNumber,
  },
  {
    source: ['customer_pincode', 'pincode', 'Pincode', 'Customer Pincode'],
    target: 'pincode',
    transform: asString,
  },
  {
    source: [
      'customer_state',
      'customer_delivery_state',
      'customer_delivery_state_code',
      'State Name',
      'Ship To State',
    ],
    target: 'stateName',
    transform: asIndianStateLabel,
  },
];

const MYNTRA_GSTR_RT_MAPPINGS: MappingConfig[] = [
  {
    source: ['tax_seller_gstin', 'seller_gstin', 'GST NO', 'GSTIN'],
    target: 'sellerGSTIN',
    transform: normalizeGstin,
  },
  {
    source: [...MYNTRA_GSTR_RT_ORDER_ID_ALIASES, 'Order ID'],
    target: 'orderID',
    transform: asString,
  },
  {
    source: ['fr_refunded_date', 'FR Refunded Date', 'Refunded Date'],
    target: 'frRefundedDate',
    transform: asDate,
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
  { source: ['quantity', 'Quantity', 'Qty'], target: 'quantity', transform: asNumber },
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
  {
    source: [
      'igst_rate',
      'IGST Rate',
      'Igst Rate',
      'Igst_Rate',
      'IGST_Rate',
      'Igst Rate %',
      'IGST Rate %',
      'IGST %',
      'tax_rate',
      'gst_rate',
    ],
    target: 'igstRate',
    transform: asNumber,
  },
  {
    source: [
      'igst_amt',
      'IGST Amount',
      'Igst Tax',
      'Igst Amount',
      'Igst_Amt',
      'tax_amount',
      'gst_amount',
    ],
    target: 'igstAmount',
    transform: asNumber,
  },
  {
    source: ['cgst_rate', 'CGST Rate', 'Cgst Rate', 'Cgst_Rate', 'CGST_Rate', 'CGST %'],
    target: 'cgstRate',
    transform: asNumber,
  },
  {
    source: [
      'cgst_amt',
      'CGST Amount',
      'Cgst Tax',
      'Cgst Amount',
      'Cgst_Amt',
    ],
    target: 'cgstAmount',
    transform: asNumber,
  },
  {
    source: ['sgst_rate', 'SGST Rate', 'Sgst Rate', 'Sgst_Rate', 'SGST_Rate', 'SGST %'],
    target: 'sgstRate',
    transform: asNumber,
  },
  {
    source: [
      'sgst_amt',
      'SGST Amount',
      'Sgst Tax',
      'Sgst Amount',
      'Sgst_Amt',
    ],
    target: 'sgstAmount',
    transform: asNumber,
  },
  {
    source: ['customer_pincode', 'pincode', 'Pincode', 'Customer Pincode'],
    target: 'pincode',
    transform: asString,
  },
  {
    source: [
      'delivery_state',
      'customer_delivery_state',
      'customer_delivery_state_code',
      'State Name',
      'Ship To State',
    ],
    target: 'stateName',
    transform: asIndianStateLabel,
  },
];

const MYNTRA_GSTR_RETURN_GST_FIELDS: Array<keyof NormalizedImportRow> = [
  'quantity',
  'invoiceAmount',
  'taxableAmount',
  'igstRate',
  'igstAmount',
  'cgstRate',
  'cgstAmount',
  'sgstRate',
  'sgstAmount',
];

const MYNTRA_MDIRECT_MAPPINGS: MappingConfig[] = [
  {
    source: [...MYNTRA_MDIRECT_ORDER_ID_ALIASES, 'Order ID'],
    target: 'orderID',
    transform: asString,
  },
  {
    source: ['seller_sku_code', 'seller sku code'],
    target: 'skuID',
    transform: asString,
  },
];

const MYNTRA_MDIRECT_RETURNS_MAPPINGS: MappingConfig[] = [
  {
    source: [...MYNTRA_MDIRECT_RETURNS_ORDER_ID_ALIASES, 'Order ID'],
    target: 'orderID',
    transform: asString,
  },
  {
    source: ['seller_sku_code', 'seller sku code'],
    target: 'skuID',
    transform: asString,
  },
  {
    source: ['return_mode', 'Return Mode'],
    target: 'returnReason',
    transform: asString,
  },
  {
    source: ['return_reason', 'Detailed Return Reason', 'Return Reason Detail'],
    target: 'detailedReturnReason',
    transform: asString,
  },
];

const MYNTRA_SALES_REVENUE_MAPPINGS: MappingConfig[] = [
  {
    source: [...MYNTRA_SALES_ORDER_ID_ALIASES, 'Order ID', 'Order Id'],
    target: 'orderID',
    transform: asString,
  },
  { source: ['Hsn', 'HSN', 'hsn', 'HSN Code'], target: 'hsnCode', transform: asString },
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
  {
    source: ['Order_Created_Date', 'order_created_date', 'Order Created Date'],
    target: 'order_created_date',
    transform: asDmyDate,
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
  /**
   * Enforce GST component split using seller registration state vs customer state.
   * Intra-state => only CGST/SGST. Inter-state => only IGST.
   */
  normalizeTaxByState(
    mapped: NormalizedImportRow,
    sellerStates?: string | string[],
    sellerGstins?: string | string[],
  ): NormalizedImportRow {
    const sellerContext = buildSellerGstContext(sellerStates, sellerGstins);
    if (mapped.sellerGSTIN && !sellerContext.gstins.includes(mapped.sellerGSTIN)) {
      sellerContext.gstins.push(mapped.sellerGSTIN);
      sellerContext.stateKeys = buildSellerGstContext(
        sellerContext.states,
        sellerContext.gstins,
      ).stateKeys;
    }
    normalizeImportRowGst(mapped, sellerContext);
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

  mapMyntraGstrRow(row: ParsedSheetRow): NormalizedImportRow {
    const mapped = this.mapRow(row, 'sales', MYNTRA_GSTR_MAPPINGS);
    mapped.documentType = 'SALE';
    mapped.myntraTransactionType = 'SALE';
    return mapped;
  }

  mapMyntraSalesRevenueRow(row: ParsedSheetRow): NormalizedImportRow {
    return this.mapRow(row, 'sales', MYNTRA_SALES_REVENUE_MAPPINGS);
  }

  mapMyntraMdirectRow(row: ParsedSheetRow): NormalizedImportRow {
    return this.mapRow(row, 'sales', MYNTRA_MDIRECT_MAPPINGS);
  }

  mapMyntraGstrRtoRow(row: ParsedSheetRow): NormalizedImportRow {
    const mapped = this.mapRow(row, 'sales', MYNTRA_GSTR_RTO_MAPPINGS);
    mapped.documentType = MYNTRA_DOCUMENT_TYPE_RTO;
    mapped.typeOfReturn = MYNTRA_DOCUMENT_TYPE_RTO;
    mapped.myntraTransactionType = 'RETURN';
    return mapped;
  }

  mapMyntraGstrRtRow(row: ParsedSheetRow): NormalizedImportRow {
    const mapped = this.mapRow(row, 'sales', MYNTRA_GSTR_RT_MAPPINGS);
    mapped.documentType = MYNTRA_DOCUMENT_TYPE_CUSTOMER_RETURN;
    mapped.typeOfReturn = MYNTRA_DOCUMENT_TYPE_CUSTOMER_RETURN;
    mapped.myntraTransactionType = 'RETURN';
    return mapped;
  }

  mapMyntraMdirectReturnsRow(row: ParsedSheetRow): Pick<
    NormalizedImportRow,
    'returnReason' | 'detailedReturnReason'
  > {
    return this.mapRow(row, 'sales', MYNTRA_MDIRECT_RETURNS_MAPPINGS);
  }

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

  buildMyntraGstrRtoHeaderMap(headers: string[]): ColumnHeaderMap {
    return this.buildHeaderMap(headers, MYNTRA_GSTR_RTO_MAPPINGS);
  }

  buildMyntraGstrRtHeaderMap(headers: string[]): ColumnHeaderMap {
    return this.buildHeaderMap(headers, MYNTRA_GSTR_RT_MAPPINGS);
  }

  /** Fill GST rate/amount fields from return file columns when fast header map missed them. */
  enrichMyntraGstrReturnGstFields(
    mapped: NormalizedImportRow,
    row: ParsedSheetRow,
    kind: 'rto' | 'rt',
  ): void {
    const mappings =
      kind === 'rt' ? MYNTRA_GSTR_RT_MAPPINGS : MYNTRA_GSTR_RTO_MAPPINGS;
    for (const config of mappings) {
      if (
        !MYNTRA_GSTR_RETURN_GST_FIELDS.includes(
          config.target as keyof NormalizedImportRow,
        )
      ) {
        continue;
      }
      const target = config.target as keyof NormalizedImportRow;
      const current = mapped[target];
      if (current !== undefined && current !== null && current !== '') continue;
      const raw = getRowCell(row, ...config.source);
      if (raw === undefined || raw === null || raw === '') continue;
      const xformed = config.transform ? config.transform(raw, row) : raw;
      if (xformed !== undefined && xformed !== null && xformed !== '') {
        (mapped as Record<string, unknown>)[target] = xformed;
      }
    }
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
          if (headerMatchesExcelColumn(header, alias)) {
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
