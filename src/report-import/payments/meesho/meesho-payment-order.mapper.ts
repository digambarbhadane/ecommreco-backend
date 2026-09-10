import { normalizePaymentHeader } from '../core/payment-header-normalizer.util';
import {
  coerceMeeshoDate,
  coerceMeeshoNumber,
  coerceMeeshoString,
  normalizeMeeshoHeader,
} from './meesho-payment-coercion.util';
import type { ParsedSheetRow } from '../../services/mapping.service';

export type MeeshoOrderPaymentsMappedRow = {
  subOrderNo?: string | null;
  orderDate?: Date | null;
  dispatchDate?: Date | null;
  productName?: string | null;
  supplierSku?: string | null;
  catalogId?: string | null;
  orderSource?: string | null;
  liveOrderStatus?: string | null;
  productGstPercent?: number | null;
  listingPriceInclTaxes?: number | null;
  quantity?: number | null;
  transactionId?: string | null;
  paymentDate?: Date | null;
  finalSettlementAmount?: number | null;
  priceType?: string | null;
  totalSaleAmountInclShippingGst?: number | null;
  totalSaleReturnAmountInclShippingGst?: number | null;
  fixedFeeInclGst?: number | null;
  warehousingFeeInclGst?: number | null;
  returnPremiumInclGst?: number | null;
  returnPremiumReturnInclGst?: number | null;
  meeshoCommissionPercentage?: number | null;
  meeshoCommissionInclGst?: number | null;
  meeshoGoldPlatformFeeInclGst?: number | null;
  meeshoMallPlatformFeeInclGst?: number | null;
  fixedFeeDuplicateInclGst?: number | null;
  warehousingFeeDuplicateInclGst?: number | null;
  returnShippingChargeInclGst?: number | null;
  gstCompensationPrpShipping?: number | null;
  shippingChargeInclGst?: number | null;
  otherSupportServiceChargesExclGst?: number | null;
  waiversExclGst?: number | null;
  netOtherSupportServiceChargesExclGst?: number | null;
  gstOnNetOtherSupportServiceCharges?: number | null;
  tcs?: number | null;
  tdsRatePercent?: number | null;
  tds?: number | null;
  compensation?: number | null;
  claims?: number | null;
  recovery?: number | null;
  compensationReason?: string | null;
  claimsReason?: string | null;
  recoveryReason?: string | null;
};

const ORDER_PAYMENT_DATE_FIELDS = new Set([
  'orderDate',
  'dispatchDate',
  'paymentDate',
]);

const ORDER_PAYMENT_NUMBER_FIELDS = new Set([
  'productGstPercent',
  'listingPriceInclTaxes',
  'quantity',
  'finalSettlementAmount',
  'totalSaleAmountInclShippingGst',
  'totalSaleReturnAmountInclShippingGst',
  'fixedFeeInclGst',
  'warehousingFeeInclGst',
  'returnPremiumInclGst',
  'returnPremiumReturnInclGst',
  'meeshoCommissionPercentage',
  'meeshoCommissionInclGst',
  'meeshoGoldPlatformFeeInclGst',
  'meeshoMallPlatformFeeInclGst',
  'fixedFeeDuplicateInclGst',
  'warehousingFeeDuplicateInclGst',
  'returnShippingChargeInclGst',
  'gstCompensationPrpShipping',
  'shippingChargeInclGst',
  'otherSupportServiceChargesExclGst',
  'waiversExclGst',
  'netOtherSupportServiceChargesExclGst',
  'gstOnNetOtherSupportServiceCharges',
  'tcs',
  'tdsRatePercent',
  'tds',
  'compensation',
  'claims',
  'recovery',
]);

const DUPLICATE_HEADER_TARGETS: Record<string, [string, string]> = {
  'fixed fee incl gst': ['fixedFeeInclGst', 'fixedFeeDuplicateInclGst'],
  'warehousing fee incl gst': [
    'warehousingFeeInclGst',
    'warehousingFeeDuplicateInclGst',
  ],
};

const ORDER_PAYMENT_HEADER_ALIASES: Array<{
  field: keyof MeeshoOrderPaymentsMappedRow;
  aliases: string[];
}> = [
  {
    field: 'subOrderNo',
    aliases: ['Sub Order No', 'sub_order_num', 'Order ID'],
  },
  { field: 'orderDate', aliases: ['Order Date'] },
  { field: 'dispatchDate', aliases: ['Dispatch Date'] },
  { field: 'productName', aliases: ['Product Name'] },
  { field: 'supplierSku', aliases: ['Supplier SKU', 'Supplier Sku'] },
  { field: 'catalogId', aliases: ['Catalog ID', 'Catalog Id'] },
  { field: 'orderSource', aliases: ['Order Source'] },
  { field: 'liveOrderStatus', aliases: ['Live Order Status'] },
  {
    field: 'productGstPercent',
    aliases: ['Product GST %', 'Product GST Percent', 'Product GST%'],
  },
  {
    field: 'listingPriceInclTaxes',
    aliases: [
      'Listing Price (Incl. Taxes)',
      'Listing Price incl taxes',
      'Listing Price (Incl Taxes)',
    ],
  },
  { field: 'quantity', aliases: ['Quantity'] },
  { field: 'transactionId', aliases: ['Transaction ID'] },
  { field: 'paymentDate', aliases: ['Payment Date'] },
  {
    field: 'finalSettlementAmount',
    aliases: ['Final Settlement Amount'],
  },
  { field: 'priceType', aliases: ['Price Type'] },
  {
    field: 'totalSaleAmountInclShippingGst',
    aliases: ['Total Sale Amount (Incl. Shipping & GST)'],
  },
  {
    field: 'totalSaleReturnAmountInclShippingGst',
    aliases: ['Total Sale Return Amount (Incl. Shipping & GST)'],
  },
  { field: 'returnPremiumInclGst', aliases: ['Return premium (incl GST)'] },
  {
    field: 'returnPremiumReturnInclGst',
    aliases: ['Return premium (incl GST) of Return'],
  },
  {
    field: 'meeshoCommissionPercentage',
    aliases: ['Meesho Commission Percentage'],
  },
  {
    field: 'meeshoCommissionInclGst',
    aliases: ['Meesho Commission (Incl. GST)'],
  },
  {
    field: 'meeshoGoldPlatformFeeInclGst',
    aliases: ['Meesho gold platform fee (Incl. GST)'],
  },
  {
    field: 'meeshoMallPlatformFeeInclGst',
    aliases: ['Meesho mall platform fee (Incl. GST)'],
  },
  {
    field: 'returnShippingChargeInclGst',
    aliases: ['Return Shipping Charge (Incl. GST)'],
  },
  {
    field: 'gstCompensationPrpShipping',
    aliases: ['GST Compensation (PRP Shipping)'],
  },
  { field: 'shippingChargeInclGst', aliases: ['Shipping Charge (Incl. GST)'] },
  {
    field: 'otherSupportServiceChargesExclGst',
    aliases: ['Other Support Service Charges (Excl. GST)'],
  },
  { field: 'waiversExclGst', aliases: ['Waivers (Excl. GST)'] },
  {
    field: 'netOtherSupportServiceChargesExclGst',
    aliases: ['Net Other Support Service Charges (Excl. GST)'],
  },
  {
    field: 'gstOnNetOtherSupportServiceCharges',
    aliases: ['GST on Net Other Support Service Charges'],
  },
  { field: 'tcs', aliases: ['TCS'] },
  { field: 'tdsRatePercent', aliases: ['TDS Rate %', 'TDS Rate'] },
  { field: 'tds', aliases: ['TDS'] },
  { field: 'compensation', aliases: ['Compensation'] },
  { field: 'claims', aliases: ['Claims'] },
  { field: 'recovery', aliases: ['Recovery'] },
  { field: 'compensationReason', aliases: ['Compensation Reason'] },
  { field: 'claimsReason', aliases: ['Claims Reason'] },
  { field: 'recoveryReason', aliases: ['Recovery Reason'] },
];

function buildAliasLookup(): Map<string, keyof MeeshoOrderPaymentsMappedRow> {
  const lookup = new Map<string, keyof MeeshoOrderPaymentsMappedRow>();
  for (const entry of ORDER_PAYMENT_HEADER_ALIASES) {
    for (const alias of entry.aliases) {
      lookup.set(normalizePaymentHeader(alias), entry.field);
    }
  }
  return lookup;
}

const ALIAS_LOOKUP = buildAliasLookup();

function resolveFieldForHeader(
  normalizedHeader: string,
  duplicateCounts: Record<string, number>,
): keyof MeeshoOrderPaymentsMappedRow | null {
  const duplicateTargets = DUPLICATE_HEADER_TARGETS[normalizedHeader];
  if (duplicateTargets) {
    const count = duplicateCounts[normalizedHeader] ?? 0;
    duplicateCounts[normalizedHeader] = count + 1;
    return duplicateTargets[
      Math.min(count, duplicateTargets.length - 1)
    ] as keyof MeeshoOrderPaymentsMappedRow;
  }
  return ALIAS_LOOKUP.get(normalizedHeader) ?? null;
}

function coerceOrderPaymentValue(
  field: keyof MeeshoOrderPaymentsMappedRow,
  value: unknown,
): string | number | Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (ORDER_PAYMENT_DATE_FIELDS.has(field)) {
    return coerceMeeshoDate(value);
  }
  if (ORDER_PAYMENT_NUMBER_FIELDS.has(field)) {
    return coerceMeeshoNumber(value);
  }
  return coerceMeeshoString(value);
}

export function buildOrderPaymentsColumnFieldMap(
  headers: string[],
): Map<number, keyof MeeshoOrderPaymentsMappedRow> {
  const colToField = new Map<number, keyof MeeshoOrderPaymentsMappedRow>();
  const duplicateCounts: Record<string, number> = {};

  for (let col = 0; col < headers.length; col += 1) {
    const displayHeader = normalizeMeeshoHeader(headers[col]);
    if (!displayHeader) continue;

    const normalized = normalizePaymentHeader(displayHeader);
    let field = resolveFieldForHeader(normalized, duplicateCounts);

    if (!field && normalized.includes('warehousing fee')) {
      const count = duplicateCounts['warehousing fee incl gst'] ?? 0;
      duplicateCounts['warehousing fee incl gst'] = count + 1;
      const targets = DUPLICATE_HEADER_TARGETS['warehousing fee incl gst'];
      field = targets[
        Math.min(count, targets.length - 1)
      ] as keyof MeeshoOrderPaymentsMappedRow;
    }

    if (!field) continue;
    colToField.set(col, field);
  }

  return colToField;
}

/** @deprecated Prefer buildOrderPaymentsColumnFieldMap for duplicate-safe parsing */
export function buildOrderPaymentsHeaderFieldMap(
  headers: string[],
): Map<string, keyof MeeshoOrderPaymentsMappedRow> {
  const colMap = buildOrderPaymentsColumnFieldMap(headers);
  const headerToField = new Map<string, keyof MeeshoOrderPaymentsMappedRow>();
  headers.forEach((header, col) => {
    const field = colMap.get(col);
    if (!field) return;
    const displayHeader = normalizeMeeshoHeader(header);
    if (displayHeader && !headerToField.has(displayHeader)) {
      headerToField.set(displayHeader, field);
    }
  });
  return headerToField;
}

export function mapMeeshoOrderPaymentsIndexedRow(
  cells: unknown[],
  colFieldMap: Map<number, keyof MeeshoOrderPaymentsMappedRow>,
): MeeshoOrderPaymentsMappedRow {
  const mapped = {} as MeeshoOrderPaymentsMappedRow;
  for (const [col, field] of colFieldMap.entries()) {
    mapped[field] = coerceOrderPaymentValue(field, cells[col] ?? null) as never;
  }
  return mapped;
}

export function mappedOrderPaymentsToEnrichmentRow(
  mapped: MeeshoOrderPaymentsMappedRow,
  sheetName: string,
  rowNumber: number,
): ParsedSheetRow {
  const row: ParsedSheetRow = {
    __sheetName: sheetName,
    __rowNumber: rowNumber,
  };
  if (mapped.subOrderNo != null) row['Sub Order No'] = mapped.subOrderNo;
  if (mapped.liveOrderStatus != null)
    row['Live Order Status'] = mapped.liveOrderStatus;
  if (mapped.transactionId != null)
    row['Transaction ID'] = mapped.transactionId;
  if (mapped.paymentDate != null) row['Payment Date'] = mapped.paymentDate;
  if (mapped.finalSettlementAmount != null) {
    row['Final Settlement Amount'] = mapped.finalSettlementAmount;
  }
  if (mapped.priceType != null) row['Price Type'] = mapped.priceType;
  if (mapped.totalSaleAmountInclShippingGst != null) {
    row['Total Sale Amount (Incl. Shipping & GST)'] =
      mapped.totalSaleAmountInclShippingGst;
  }
  if (mapped.totalSaleReturnAmountInclShippingGst != null) {
    row['Total Sale Return Amount (Incl. Shipping & GST)'] =
      mapped.totalSaleReturnAmountInclShippingGst;
  }
  if (mapped.fixedFeeInclGst != null)
    row['Fixed Fee (Incl. GST)'] = mapped.fixedFeeInclGst;
  if (mapped.warehousingFeeInclGst != null) {
    row['Warehousing fee (Incl. GST)'] = mapped.warehousingFeeInclGst;
  }
  if (mapped.returnPremiumInclGst != null) {
    row['Return premium (incl GST)'] = mapped.returnPremiumInclGst;
  }
  if (mapped.returnPremiumReturnInclGst != null) {
    row['Return premium (incl GST) of Return'] =
      mapped.returnPremiumReturnInclGst;
  }
  if (mapped.meeshoCommissionPercentage != null) {
    row['Meesho Commission Percentage'] = mapped.meeshoCommissionPercentage;
  }
  if (mapped.meeshoCommissionInclGst != null) {
    row['Meesho Commission (Incl. GST)'] = mapped.meeshoCommissionInclGst;
  }
  if (mapped.meeshoGoldPlatformFeeInclGst != null) {
    row['Meesho gold platform fee (Incl. GST)'] =
      mapped.meeshoGoldPlatformFeeInclGst;
  }
  if (mapped.meeshoMallPlatformFeeInclGst != null) {
    row['Meesho mall platform fee (Incl. GST)'] =
      mapped.meeshoMallPlatformFeeInclGst;
  }
  if (mapped.returnShippingChargeInclGst != null) {
    row['Return Shipping Charge (Incl. GST)'] =
      mapped.returnShippingChargeInclGst;
  }
  if (mapped.gstCompensationPrpShipping != null) {
    row['GST Compensation (PRP Shipping)'] = mapped.gstCompensationPrpShipping;
  }
  if (mapped.shippingChargeInclGst != null) {
    row['Shipping Charge (Incl. GST)'] = mapped.shippingChargeInclGst;
  }
  if (mapped.otherSupportServiceChargesExclGst != null) {
    row['Other Support Service Charges (Excl. GST)'] =
      mapped.otherSupportServiceChargesExclGst;
  }
  if (mapped.waiversExclGst != null)
    row['Waivers (Excl. GST)'] = mapped.waiversExclGst;
  if (mapped.netOtherSupportServiceChargesExclGst != null) {
    row['Net Other Support Service Charges (Excl. GST)'] =
      mapped.netOtherSupportServiceChargesExclGst;
  }
  if (mapped.gstOnNetOtherSupportServiceCharges != null) {
    row['GST on Net Other Support Service Charges'] =
      mapped.gstOnNetOtherSupportServiceCharges;
  }
  if (mapped.tcs != null) row['TCS'] = mapped.tcs;
  if (mapped.tdsRatePercent != null) row['TDS Rate %'] = mapped.tdsRatePercent;
  if (mapped.tds != null) row['TDS'] = mapped.tds;
  if (mapped.compensation != null) row['Compensation'] = mapped.compensation;
  if (mapped.claims != null) row['Claims'] = mapped.claims;
  if (mapped.recovery != null) row['Recovery'] = mapped.recovery;
  if (mapped.compensationReason != null) {
    row['Compensation Reason'] = mapped.compensationReason;
  }
  if (mapped.claimsReason != null) row['Claims Reason'] = mapped.claimsReason;
  if (mapped.recoveryReason != null)
    row['Recovery Reason'] = mapped.recoveryReason;
  return row;
}

export function mapMeeshoOrderPaymentsRow(
  rawRow: ParsedSheetRow,
  headerFieldMap?: Map<string, keyof MeeshoOrderPaymentsMappedRow>,
): MeeshoOrderPaymentsMappedRow {
  const fieldMap =
    headerFieldMap ?? buildOrderPaymentsHeaderFieldMap(Object.keys(rawRow));
  const mapped = {} as MeeshoOrderPaymentsMappedRow;

  for (const [header, value] of Object.entries(rawRow)) {
    if (header.startsWith('__')) continue;
    const field =
      fieldMap.get(header) ??
      fieldMap.get(normalizeMeeshoHeader(header)) ??
      resolveFieldForHeader(normalizePaymentHeader(header), {});
    if (!field) continue;
    if (mapped[field] !== undefined && mapped[field] !== null) continue;
    mapped[field] = coerceOrderPaymentValue(field, value) as never;
  }

  return mapped;
}

export function isMeeshoOrderPaymentsRowEmpty(
  row: MeeshoOrderPaymentsMappedRow,
): boolean {
  return Object.values(row).every(
    (value) => value === null || value === undefined || value === '',
  );
}
