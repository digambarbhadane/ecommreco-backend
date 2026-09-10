import { repairDateToIso } from '../../../common/utils/repair-legacy-date.util';
import type {
  PaymentAnalyticsRow,
  PaymentFeeComponent,
} from '../payment-analytics.types';

/** Myntra GST return document types (not used by Flipkart/Amazon/Meesho). */
export const MYNTRA_RETURN_DOCUMENT_TYPES = new Set([
  'RTO Return',
  'Customer Return',
]);

export type MyntraPgSettlementAnalyticsDoc = {
  _id?: { toString(): string } | string;
  reportKind?: 'forward' | 'reverse' | string;
  rowKey?: string;
  orderReleaseId?: string;
  orderLineId?: string;
  sellerOrderId?: string;
  skuCode?: string;
  returnId?: string;
  returnType?: string;
  invoiceNumber?: string;
  sellerProductAmount?: number;
  totalCommission?: number;
  totalLogisticsDeduction?: number;
  tcsAmount?: number;
  tdsAmount?: number;
  totalSettlement?: number;
  totalActualSettlement?: number;
  settlementDate?: Date | string;
  gstin?: string;
  marketplace?: string;
  reportMonth?: string;
  uploadedAt?: Date | string;
  rowData?: Record<string, unknown>;
};

function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function toIsoDateString(
  value: unknown,
  reportMonth?: string,
): string | undefined {
  return repairDateToIso(value, reportMonth);
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

/** Strip Excel/CSV quoting noise from Myntra invoice numbers. */
export function cleanMyntraInvoiceNumber(value: unknown): string {
  return String(value ?? '')
    .replace(/\\+"/g, '')
    .replace(/"/g, '')
    .trim();
}

function pickRowDataNumber(
  rowData: Record<string, unknown> | undefined,
  ...keys: string[]
): number | undefined {
  if (!rowData) return undefined;
  for (const key of keys) {
    const value = num(rowData[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function pickRowDataString(
  rowData: Record<string, unknown> | undefined,
  ...keys: string[]
): string {
  if (!rowData) return '';
  for (const key of keys) {
    const text = cleanMyntraInvoiceNumber(rowData[key]);
    if (text) return text;
  }
  return '';
}

function pickRowDataDate(
  rowData: Record<string, unknown> | undefined,
  reportMonth: string | undefined,
  ...keys: string[]
): string | undefined {
  if (!rowData) return undefined;
  for (const key of keys) {
    const iso = toIsoDateString(rowData[key], reportMonth);
    if (iso) return iso;
  }
  return undefined;
}

function pushFeeComponent(
  components: PaymentFeeComponent[],
  key: string,
  label: string,
  amount: number | undefined,
  category: PaymentFeeComponent['category'],
) {
  if (amount == null || amount === 0) return;
  components.push({ key, label, amount, category });
}

/**
 * Fee impact as stored on Myntra PG exports.
 * `total_commission_plus_tcs_tds_deduction + total_logistics_deduction`
 * reconciles with seller_product_amount → total_actual_settlement.
 */
export function aggregateMyntraPgFees(doc: MyntraPgSettlementAnalyticsDoc): {
  marketplaceFee: number | undefined;
  commission: number | undefined;
  tcs: number | undefined;
  tds: number | undefined;
  feeComponents: PaymentFeeComponent[];
} {
  const rowData = doc.rowData ?? {};
  const feeComponents: PaymentFeeComponent[] = [];

  const commission =
    pickRowDataNumber(rowData, 'total_commission') ?? num(doc.totalCommission);
  const tcs = pickRowDataNumber(rowData, 'tcs_amount') ?? num(doc.tcsAmount);
  const tds = pickRowDataNumber(rowData, 'tds_amount') ?? num(doc.tdsAmount);
  const logistics =
    pickRowDataNumber(rowData, 'total_logistics_deduction') ??
    num(doc.totalLogisticsDeduction);
  const combinedFromParts =
    commission != null || tcs != null || tds != null
      ? (commission ?? 0) + (tcs ?? 0) + (tds ?? 0)
      : undefined;
  const combined =
    pickRowDataNumber(rowData, 'total_commission_plus_tcs_tds_deduction') ??
    combinedFromParts;

  const feeImpact =
    combined != null || logistics != null
      ? (combined ?? 0) + (logistics ?? 0)
      : undefined;

  pushFeeComponent(
    feeComponents,
    'commission',
    'Commission',
    commission,
    'commission',
  );
  pushFeeComponent(feeComponents, 'tcs', 'TCS', tcs, 'tcs');
  pushFeeComponent(feeComponents, 'tds', 'TDS', tds, 'tds');
  pushFeeComponent(
    feeComponents,
    'logistics',
    'Logistics Deduction',
    logistics,
    'other',
  );

  // Combined fee impact on marketplaceFee; commission left 0 so
  // getMarketplaceFeesAmount (fee + commission) does not double-count.
  return {
    marketplaceFee: feeImpact,
    commission: 0,
    tcs,
    tds,
    feeComponents,
  };
}

export function resolveMyntraPgInvoiceNumber(
  doc: MyntraPgSettlementAnalyticsDoc,
): string {
  return (
    cleanMyntraInvoiceNumber(doc.invoiceNumber) ||
    pickRowDataString(doc.rowData, 'invoice_number', 'invoice_no')
  );
}

export function resolveMyntraPgNeftId(
  doc: MyntraPgSettlementAnalyticsDoc,
): string | undefined {
  const fromRow = pickRowDataString(
    doc.rowData,
    'bank_utr_no_prepaid_payment',
    'bank_utr_no_postpaid_payment',
    'bank_utr_no_prepaid_comm_deduction',
    'bank_utr_no_postpaid_comm_deduction',
    'bank_utr_no_prepaid_logistics_deduction',
    'bank_utr_no_postpaid_logistics_deduction',
  );
  return fromRow || undefined;
}

const MYNTRA_PG_UTR_FIELDS = [
  'bank_utr_no_prepaid_payment',
  'bank_utr_no_postpaid_payment',
  'bank_utr_no_prepaid_comm_deduction',
  'bank_utr_no_postpaid_comm_deduction',
  'bank_utr_no_prepaid_logistics_deduction',
  'bank_utr_no_postpaid_logistics_deduction',
] as const;

/** All non-empty NEFT/UTR values on a PG settlement row (prepaid + postpaid). */
export function collectMyntraPgNeftIds(
  doc: MyntraPgSettlementAnalyticsDoc,
): Set<string> {
  const ids = new Set<string>();
  const rowData = doc.rowData ?? {};
  for (const field of MYNTRA_PG_UTR_FIELDS) {
    const value = pickRowDataString(rowData, field);
    if (value) ids.add(value);
  }
  return ids;
}

/**
 * Business identity of a Myntra PG settlement line (not settlement amount).
 * Re-uploads revise total_actual_settlement and may fill additional UTR fields.
 */
export function myntraPgBusinessKey(doc: MyntraPgSettlementAnalyticsDoc): string {
  const kind = String(doc.reportKind ?? '').trim().toLowerCase();
  const release = String(doc.orderReleaseId ?? '').trim();
  const line = String(doc.orderLineId ?? '').trim();
  const ret = String(doc.returnId ?? '').trim();
  const sku = String(doc.skuCode ?? '').trim().toUpperCase();
  return `${kind}::${release}::${line}::${ret}::${sku}`;
}

/** @deprecated Prefer myntraPgBusinessKey; kept for existing call sites/tests. */
export function myntraPgDedupeKey(doc: MyntraPgSettlementAnalyticsDoc): string {
  return myntraPgBusinessKey(doc);
}

function neftSetsShouldMerge(a: Set<string>, b: Set<string>): boolean {
  // Missing UTRs (common on partial re-uploads) merge with the same business line.
  if (a.size === 0 || b.size === 0) return true;
  for (const id of a) {
    if (b.has(id)) return true;
  }
  return false;
}

function preferNewerPgDoc<T extends MyntraPgSettlementAnalyticsDoc>(
  prev: T,
  next: T,
): T {
  const prevAt = Date.parse(String(prev.uploadedAt ?? ''));
  const nextAt = Date.parse(String(next.uploadedAt ?? ''));
  return (Number.isFinite(nextAt) ? nextAt : 0) >=
    (Number.isFinite(prevAt) ? prevAt : 0)
    ? next
    : prev;
}

/**
 * Collapse duplicate PG uploads of the same settlement line.
 *
 * - Same kind + order release + order line + return + SKU group together.
 * - Within a group, merge rows whose NEFT/UTR sets overlap (or either lacks UTR).
 * - Completely disjoint NEFT sets for the same line are kept as separate payouts.
 * - Prefer the newest uploadedAt when merging.
 */
export function dedupeMyntraPgSettlementDocs<
  T extends MyntraPgSettlementAnalyticsDoc,
>(docs: T[]): T[] {
  type Cluster = { doc: T; nefts: Set<string> };
  const byBusiness = new Map<string, Cluster[]>();

  for (const doc of docs) {
    const businessKey = myntraPgBusinessKey(doc);
    const nefts = collectMyntraPgNeftIds(doc);
    const clusters = byBusiness.get(businessKey) ?? [];
    let merged = false;
    for (const cluster of clusters) {
      if (!neftSetsShouldMerge(cluster.nefts, nefts)) continue;
      cluster.doc = preferNewerPgDoc(cluster.doc, doc);
      for (const id of nefts) cluster.nefts.add(id);
      merged = true;
      break;
    }
    if (!merged) {
      clusters.push({ doc, nefts: new Set(nefts) });
    }
    byBusiness.set(businessKey, clusters);
  }

  const result: T[] = [];
  for (const clusters of byBusiness.values()) {
    for (const cluster of clusters) result.push(cluster.doc);
  }
  return result;
}

export function resolveMyntraPgPaymentDate(
  doc: MyntraPgSettlementAnalyticsDoc,
): string | undefined {
  return (
    pickRowDataDate(
      doc.rowData,
      doc.reportMonth,
      'settlement_date_prepaid_payment',
      'settlement_date_postpaid_payment',
      'settlement_date_prepaid_comm_deduction',
      'settlement_date_postpaid_comm_deduction',
      'settlement_date_prepaid_logistics_deduction',
      'settlement_date_postpaid_logistics_deduction',
    ) || toIsoDateString(doc.settlementDate, doc.reportMonth)
  );
}

/**
 * Map a Myntra PG settlement line into Order Wise Payments analytics shape.
 *
 * Sales / returns stay on GST `import_rows`. PG contributes bank payout + fees
 * only (saleAmount/refund left unset) so existing lifecycle formulas are unchanged.
 */
export function mapMyntraPgSettlementToAnalyticsRow(
  doc: MyntraPgSettlementAnalyticsDoc,
  orderId: string,
): PaymentAnalyticsRow {
  const id =
    typeof doc._id === 'object' && doc._id !== null && 'toString' in doc._id
      ? doc._id.toString()
      : String(doc._id ?? doc.rowKey ?? '');

  const fees = aggregateMyntraPgFees(doc);
  const settlement =
    num(doc.totalActualSettlement) ??
    pickRowDataNumber(doc.rowData, 'total_actual_settlement') ??
    num(doc.totalSettlement);
  const invoiceId = resolveMyntraPgInvoiceNumber(doc) || undefined;
  const neftId = resolveMyntraPgNeftId(doc);
  const paymentDate = resolveMyntraPgPaymentDate(doc);

  return {
    _id: id,
    source: 'myntra_pg_settlement_rows',
    orderId: String(orderId ?? '').trim(),
    orderItemId: String(doc.orderLineId ?? '').trim() || undefined,
    neftId,
    transactionId: neftId,
    paymentDate,
    bankSettlementValue: settlement,
    finalSettlementAmount: settlement,
    saleAmount: undefined,
    refund: undefined,
    marketplaceFee: fees.marketplaceFee,
    commission: fees.commission,
    tcs: fees.tcs,
    tds: fees.tds,
    feeComponents: fees.feeComponents.length ? fees.feeComponents : undefined,
    returnType: doc.returnType,
    sellerSku: doc.skuCode,
    invoiceId,
    gstin: doc.gstin,
    marketplace: 'myntra',
    reportMonth: doc.reportMonth,
    documentType:
      String(doc.reportKind ?? '').toLowerCase() === 'reverse'
        ? 'PG Reverse'
        : 'PG Forward',
  };
}

function preferCanonicalMyntraOrderId(
  current: string | undefined,
  candidate: string,
): string {
  const next = String(candidate ?? '').trim();
  if (!next) return String(current ?? '').trim();
  const prev = String(current ?? '').trim();
  if (!prev) return next;
  // Prefer non-UUID Order Ids (GSTR Order Id / Order Release Id).
  if (isUuidLike(prev) && !isUuidLike(next)) return next;
  return prev;
}

/**
 * When SALE (GSTR Packed / Sale_Order_Code) and return (GSTR RTO/RT order_id)
 * disagree for the same invoice, prefer the return's Order Id — that is the
 * portal / original Myntra Order ID. Never replace a real id with a UUID.
 */
function preferMyntraPortalOrderId(
  saleOrderId: string | undefined,
  returnOrderId: string | undefined,
): string {
  const saleId = String(saleOrderId ?? '').trim();
  const returnId = String(returnOrderId ?? '').trim();
  if (!returnId) return saleId;
  if (!saleId) return returnId;
  if (saleId === returnId) return saleId;
  if (isUuidLike(returnId) && !isUuidLike(saleId)) return saleId;
  if (!isUuidLike(returnId)) return returnId;
  return preferCanonicalMyntraOrderId(saleId, returnId);
}

function isMyntraImportRow(row: PaymentAnalyticsRow): boolean {
  return String(row.source ?? '') === 'import_rows';
}

function isMyntraSaleRow(row: PaymentAnalyticsRow): boolean {
  const docType = String(row.documentType ?? '').trim();
  return docType === 'SALE' || docType === 'Sale';
}

function isMyntraGstReturnRow(row: PaymentAnalyticsRow): boolean {
  if (!isMyntraImportRow(row)) return false;
  return MYNTRA_RETURN_DOCUMENT_TYPES.has(String(row.documentType ?? '').trim());
}

function normalizeMatchToken(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function absAmount(value: unknown): number {
  const n = num(value);
  return n == null ? 0 : Math.abs(n);
}

function saleRowAmount(row: PaymentAnalyticsRow): number {
  return absAmount(row.saleAmount ?? row.invoiceAmount);
}

function returnRowAmount(row: PaymentAnalyticsRow): number {
  return absAmount(row.refund ?? row.invoiceAmount);
}

function amountsAlign(
  sale: PaymentAnalyticsRow,
  ret: PaymentAnalyticsRow,
): boolean {
  const saleAmt = saleRowAmount(sale);
  const retAmt = returnRowAmount(ret);
  if (!saleAmt || !retAmt || saleAmt !== retAmt) return false;
  const saleTax = absAmount(sale.taxableAmount);
  const retTax = absAmount(ret.taxableAmount);
  if (saleTax && retTax && Math.abs(saleTax - retTax) > 0.01) return false;
  return true;
}

function saleMatchesReturnContext(
  sale: PaymentAnalyticsRow,
  ret: PaymentAnalyticsRow,
): boolean {
  if (!amountsAlign(sale, ret)) return false;
  const retMode = normalizeMatchToken(ret.paymentMode);
  const saleMode = normalizeMatchToken(sale.paymentMode);
  if (retMode && saleMode && retMode !== saleMode) return false;
  const retState = normalizeMatchToken(ret.stateName);
  const saleState = normalizeMatchToken(sale.stateName);
  if (retState && saleState && retState !== saleState) return false;
  return true;
}

function copySaleDisplayFieldsOntoReturn(
  ret: PaymentAnalyticsRow,
  sale: PaymentAnalyticsRow,
): PaymentAnalyticsRow {
  const saleQty = num(sale.quantity);
  return {
    ...ret,
    invoiceId: ret.invoiceId || sale.invoiceId,
    sellerSku: ret.sellerSku || sale.sellerSku,
    quantity:
      ret.quantity ??
      (saleQty != null ? -Math.abs(saleQty) : undefined),
  };
}

type MyntraPgNeftBucket = {
  forward?: string;
  reverse?: string;
};

/**
 * Copy Myntra PG bank UTR/NEFT ids onto matching GST sale/return rows so Order
 * Details shows the imported payment identifier on Sale/Return transactions.
 */
export function attachMyntraPgNeftIdsToGstRows(
  rows: PaymentAnalyticsRow[],
): PaymentAnalyticsRow[] {
  const pgNeftByOrderInvoice = new Map<string, MyntraPgNeftBucket>();

  for (const row of rows) {
    if (String(row.source ?? '') !== 'myntra_pg_settlement_rows') continue;
    const neftId = String(row.neftId ?? row.transactionId ?? '').trim();
    if (!neftId) continue;

    const orderId = String(row.orderId ?? '').trim();
    const invoice = cleanMyntraInvoiceNumber(row.invoiceId);
    if (!orderId || !invoice) continue;

    const key = `${orderId}::${invoice}`;
    const bucket = pgNeftByOrderInvoice.get(key) ?? {};
    const docType = String(row.documentType ?? '').trim().toLowerCase();
    if (docType.includes('reverse')) bucket.reverse = neftId;
    else bucket.forward = neftId;
    pgNeftByOrderInvoice.set(key, bucket);
  }

  if (!pgNeftByOrderInvoice.size) return rows;

  return rows.map((row) => {
    if (String(row.source ?? '') !== 'import_rows') return row;
    if (String(row.neftId ?? row.transactionId ?? '').trim()) return row;

    const orderId = String(row.orderId ?? '').trim();
    const invoice = cleanMyntraInvoiceNumber(row.invoiceId);
    if (!orderId || !invoice) return row;

    const bucket = pgNeftByOrderInvoice.get(`${orderId}::${invoice}`);
    if (!bucket) return row;

    const docType = String(row.documentType ?? '').trim();
    const isReturn = MYNTRA_RETURN_DOCUMENT_TYPES.has(docType);
    const neftId = isReturn
      ? bucket.reverse ?? bucket.forward
      : bucket.forward ?? bucket.reverse;
    if (!neftId) return row;

    return { ...row, neftId, transactionId: neftId };
  });
}

/**
 * Link invoice-less Myntra GST returns to their SALE row so Order Wise Payments
 * can group sale + return and resolve the portal Order Id.
 *
 * Matching order (Myntra-only):
 * 1. import_rows linkedSaleRowId (prior-month sale pointer)
 * 2. same Order Id as an in-batch SALE
 * 3. unique SALE in the same upload with aligned amount/taxable/payment/state
 * 4. unique SALE across the batch (cross-month RTO) with the same fingerprint
 *
 * Keeps the return's Order Id (GSTR RTO/RT order_id) — that is the original
 * Myntra Order ID. Invoice metadata is copied from the matched sale.
 */
export function linkMyntraCustomerReturnsToSales(
  rows: PaymentAnalyticsRow[],
): PaymentAnalyticsRow[] {
  const sales = rows.filter((row) => isMyntraImportRow(row) && isMyntraSaleRow(row));
  const salesByOrderId = new Map<string, PaymentAnalyticsRow>();
  const salesById = new Map<string, PaymentAnalyticsRow>();
  const salesByUploadId = new Map<string, PaymentAnalyticsRow[]>();

  for (const sale of sales) {
    salesById.set(sale._id, sale);
    const orderId = String(sale.orderId ?? '').trim();
    if (orderId) salesByOrderId.set(orderId, sale);
    const uploadId = String(sale.uploadId ?? '').trim();
    if (uploadId) {
      const bucket = salesByUploadId.get(uploadId) ?? [];
      bucket.push(sale);
      salesByUploadId.set(uploadId, bucket);
    }
  }

  return rows.map((row) => {
    if (!isMyntraGstReturnRow(row)) return row;
    if (cleanMyntraInvoiceNumber(row.invoiceId)) return row;

    const returnOrderId = String(row.orderId ?? '').trim();
    let matchedSale: PaymentAnalyticsRow | undefined;

    const linkedSaleRowId = String(row.linkedSaleRowId ?? '').trim();
    if (linkedSaleRowId) {
      matchedSale = salesById.get(linkedSaleRowId);
    }

    if (!matchedSale && returnOrderId) {
      matchedSale = salesByOrderId.get(returnOrderId);
    }

    if (!matchedSale) {
      const uploadId = String(row.uploadId ?? '').trim();
      const uploadPool = uploadId
        ? (salesByUploadId.get(uploadId) ?? [])
        : [];
      let candidates = uploadPool.filter((sale) =>
        saleMatchesReturnContext(sale, row),
      );
      if (candidates.length !== 1) {
        candidates = sales.filter((sale) => saleMatchesReturnContext(sale, row));
      }
      if (candidates.length === 1) matchedSale = candidates[0];
    }

    if (!matchedSale) return row;

    // Preserve return Order Id; canonicalize later prefers it over Sale_Order_Code.
    return copySaleDisplayFieldsOntoReturn(row, matchedSale);
  });
}

/**
 * Build invoice → canonical Myntra Order Id.
 *
 * Prefer GSTR RTO/RT order_id (portal Order ID) over GSTR Packed /
 * Sale_Order_Code when both appear for the same invoice. Fall back to PG
 * orderReleaseId when the sale still carries a seller-order UUID.
 */
export function buildMyntraInvoiceOrderIdMap(
  gstRows: PaymentAnalyticsRow[],
  pgDocs: MyntraPgSettlementAnalyticsDoc[] = [],
): Map<string, string> {
  const byInvoice = new Map<string, string>();

  for (const row of gstRows) {
    if (String(row.source ?? '') !== 'import_rows') continue;
    const docType = String(row.documentType ?? '').trim();
    if (docType !== 'SALE' && docType !== 'Sale') continue;
    const invoice = cleanMyntraInvoiceNumber(row.invoiceId);
    const orderId = String(row.orderId ?? '').trim();
    if (!invoice || !orderId) continue;
    byInvoice.set(
      invoice,
      preferCanonicalMyntraOrderId(byInvoice.get(invoice), orderId),
    );
  }

  for (const row of gstRows) {
    if (!isMyntraGstReturnRow(row)) continue;
    const invoice = cleanMyntraInvoiceNumber(row.invoiceId);
    const returnOrderId = String(row.orderId ?? '').trim();
    if (!invoice || !returnOrderId) continue;
    byInvoice.set(
      invoice,
      preferMyntraPortalOrderId(byInvoice.get(invoice), returnOrderId),
    );
  }

  for (const doc of pgDocs) {
    const invoice = resolveMyntraPgInvoiceNumber(doc);
    const releaseId = String(doc.orderReleaseId ?? '').trim();
    if (!invoice || !releaseId) continue;
    const current = byInvoice.get(invoice);
    if (!current || isUuidLike(current)) {
      byInvoice.set(
        invoice,
        preferCanonicalMyntraOrderId(current, releaseId),
      );
    }
  }

  return byInvoice;
}

/**
 * Remap Myntra GST sale + return rows that share an invoice onto the canonical
 * portal Order Id so Order Settlements / Order Details show one Order ID.
 */
export function canonicalizeMyntraPaymentAnalyticsOrderIds(
  rows: PaymentAnalyticsRow[],
  invoiceOrderIds: Map<string, string>,
): PaymentAnalyticsRow[] {
  if (!invoiceOrderIds.size) return rows;

  return rows.map((row) => {
    if (String(row.source ?? '') !== 'import_rows') return row;
    const invoice = cleanMyntraInvoiceNumber(row.invoiceId);
    if (!invoice) return row;
    const canonical = invoiceOrderIds.get(invoice);
    if (!canonical) return row;

    const orderId = String(row.orderId ?? '').trim();
    if (orderId === canonical) return row;
    return { ...row, orderId: canonical };
  });
}

export function resolveOrderIdForMyntraPgDoc(
  doc: MyntraPgSettlementAnalyticsDoc,
  invoiceOrderIds: Map<string, string>,
  knownOrderIds: Set<string>,
): string {
  const invoice = resolveMyntraPgInvoiceNumber(doc);
  if (invoice) {
    const fromInvoice = invoiceOrderIds.get(invoice);
    if (fromInvoice) return fromInvoice;
  }

  const sellerOrderId = String(doc.sellerOrderId ?? '').trim();
  if (sellerOrderId && knownOrderIds.has(sellerOrderId)) {
    return sellerOrderId;
  }

  const releaseId = String(doc.orderReleaseId ?? '').trim();
  if (releaseId) return releaseId;
  return sellerOrderId;
}

/**
 * Full Myntra Order Wise enrichment: canonicalize GST order ids, then attach PG.
 */
export function enrichMyntraPaymentAnalyticsRows(
  gstAndOtherRows: PaymentAnalyticsRow[],
  pgDocs: MyntraPgSettlementAnalyticsDoc[],
): PaymentAnalyticsRow[] {
  const linkedGst = linkMyntraCustomerReturnsToSales(gstAndOtherRows);
  const invoiceOrderIds = buildMyntraInvoiceOrderIdMap(linkedGst, pgDocs);
  const canonicalGst = canonicalizeMyntraPaymentAnalyticsOrderIds(
    linkedGst,
    invoiceOrderIds,
  );
  if (!pgDocs.length) return attachMyntraPgNeftIdsToGstRows(canonicalGst);

  const knownOrderIds = new Set(
    canonicalGst
      .map((row) => String(row.orderId ?? '').trim())
      .filter(Boolean),
  );
  const finalInvoiceMap = buildMyntraInvoiceOrderIdMap(canonicalGst, pgDocs);
  const pgRows = dedupeMyntraPgSettlementDocs(pgDocs).map((doc) =>
    mapMyntraPgSettlementToAnalyticsRow(
      doc,
      resolveOrderIdForMyntraPgDoc(doc, finalInvoiceMap, knownOrderIds),
    ),
  );
  return attachMyntraPgNeftIdsToGstRows([...canonicalGst, ...pgRows]);
}
