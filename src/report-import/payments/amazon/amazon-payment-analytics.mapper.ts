import { repairDateToIso } from '../../../common/utils/repair-legacy-date.util';
import type {
  PaymentAnalyticsRow,
  PaymentFeeComponent,
} from '../payment-analytics.types';

/** Lean Amazon payment component row from `amazon_payment_transactions`. */
export type AmazonPaymentComponentInput = {
  _id?: { toString(): string } | string;
  settlementId?: string;
  depositDate?: Date | string;
  transactionType?: string;
  orderId?: string;
  amountDescription?: string;
  amount?: number;
  gstin?: string;
  reportMonth?: string;
  rowKey?: string;
};

type AmazonLineKind =
  | 'sale'
  | 'return'
  | 'commission'
  | 'tcs'
  | 'tds'
  | 'fee'
  | 'other';

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIsoDateString(
  value: unknown,
  reportMonth?: string,
): string | undefined {
  return repairDateToIso(value, reportMonth);
}

/**
 * Classify Amazon settlement component lines using the same description/
 * transaction-type patterns as Analytics Payouts and AmazonPaymentService.
 */
export function classifyAmazonPaymentLine(
  transactionType: string | undefined,
  amountDescription: string | undefined,
): AmazonLineKind {
  const description = String(amountDescription ?? '')
    .trim()
    .toLowerCase();
  const haystack = `${String(transactionType ?? '')} ${description}`
    .trim()
    .toLowerCase();

  const isSaleComponent = /principal|product tax/.test(description);
  if (isSaleComponent && /refund|return/.test(haystack)) return 'return';
  if (isSaleComponent) return 'sale';
  if (/commission/.test(haystack)) return 'commission';
  if (/\btcs\b/.test(haystack)) return 'tcs';
  if (/\btds\b/.test(haystack)) return 'tds';
  if (
    /shipping|postage|logistics|easy ship|storage|penalty|fee|charge|fba|fulfillment|closing|advert|sponsored|servicefee|service fee|promotion|promo|discount/.test(
      description,
    ) ||
    /shipping|postage|logistics|easy ship|storage|penalty|fee|charge|fba|fulfillment|closing|advert|sponsored|servicefee|service fee/.test(
      haystack,
    )
  ) {
    return 'fee';
  }
  return 'other';
}

/**
 * Expand PascalCase / camelCase Amazon labels before keying so
 * "FixedClosingFee" and "Fixed closing fee" share one identity.
 * Keeps CGST/SGST/IGST suffixes as distinct fee components.
 */
function expandAmazonFeeDescription(amountDescription: string | undefined): string {
  let raw = String(amountDescription ?? '').trim();
  if (!raw) return '';
  raw = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  raw = raw.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return raw.replace(/\s+/g, ' ').trim();
}

export function amazonFeeLabel(amountDescription: string | undefined): string {
  const expanded = expandAmazonFeeDescription(amountDescription);
  if (!expanded) return 'Marketplace Fee';
  // Title-case word starts for stable display; keep acronyms/Amazon & as imported.
  return expanded.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

function feeLabel(amountDescription: string | undefined): string {
  return amazonFeeLabel(amountDescription);
}

/**
 * Canonical Amazon fee identity for merging true duplicates / name variants.
 * Tax suffixes (CGST/SGST/IGST) remain part of the key so they stay separate.
 */
export function amazonFeeKey(amountDescription: string | undefined): string {
  const expanded = expandAmazonFeeDescription(amountDescription);
  if (!expanded) return 'other_marketplace_fee';
  return expanded
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 64);
}

function feeKey(amountDescription: string | undefined): string {
  return amazonFeeKey(amountDescription);
}

/**
 * Same settlement line can be stored once per reportMonth (rowKey is month-agnostic).
 * Order Wise Payments loads all months — dedupe by rowKey so fees are not double-counted.
 * Distinct rowKeys (fingerprint:1 vs fingerprint:2) are legitimate repeated Amazon lines.
 */
function dedupeAmazonComponentsByRowKey(
  docs: AmazonPaymentComponentInput[],
): AmazonPaymentComponentInput[] {
  const byRowKey = new Map<string, AmazonPaymentComponentInput>();
  const withoutKey: AmazonPaymentComponentInput[] = [];

  for (const doc of docs) {
    const rowKey = String(doc.rowKey ?? '').trim();
    if (!rowKey) {
      withoutKey.push(doc);
      continue;
    }
    const existing = byRowKey.get(rowKey);
    if (!existing) {
      byRowKey.set(rowKey, doc);
      continue;
    }
    // Prefer the later report month when the same source line was re-imported.
    const existingMonth = String(existing.reportMonth ?? '');
    const nextMonth = String(doc.reportMonth ?? '');
    if (nextMonth >= existingMonth) byRowKey.set(rowKey, doc);
  }

  return [...byRowKey.values(), ...withoutKey];
}

type OrderSettlementBucket = {
  orderId: string;
  settlementId: string;
  rows: AmazonPaymentComponentInput[];
};

/**
 * Pivot Amazon long/component settlement rows into Order Wise PaymentAnalyticsRow
 * records, one per (orderId, settlementId).
 *
 * - saleAmount ← Principal / Product Tax (non-refund)
 * - refund ← abs of refund/return Principal lines
 * - commission ← Commission lines (signed as imported)
 * - marketplaceFee ← other fee/TCS/TDS lines (signed as imported)
 * - bankSettlementValue ← sum of all component amounts for the order in that settlement
 *
 * Settlement-level rows without orderId are skipped (cannot attach to an order).
 */
export function mapAmazonPaymentComponentsToAnalyticsRows(
  docs: AmazonPaymentComponentInput[],
): PaymentAnalyticsRow[] {
  const buckets = new Map<string, OrderSettlementBucket>();

  for (const doc of dedupeAmazonComponentsByRowKey(docs)) {
    const orderId = String(doc.orderId ?? '').trim();
    if (!orderId) continue;
    const settlementId = String(doc.settlementId ?? '').trim() || 'unknown';
    const key = `${orderId}::${settlementId}`;
    const existing = buckets.get(key);
    if (existing) existing.rows.push(doc);
    else buckets.set(key, { orderId, settlementId, rows: [doc] });
  }

  const out: PaymentAnalyticsRow[] = [];

  for (const bucket of buckets.values()) {
    let saleAmount = 0;
    let refundAbs = 0;
    let commission = 0;
    let tcs = 0;
    let tds = 0;
    let otherFees = 0;
    let bankSettlementValue = 0;
    const feeByKey = new Map<string, PaymentFeeComponent>();

    let gstin: string | undefined;
    let reportMonth: string | undefined;
    let paymentDate: string | undefined;
    let idSeed = '';

    for (const row of bucket.rows) {
      const amount = num(row.amount);
      bankSettlementValue += amount;
      const kind = classifyAmazonPaymentLine(
        row.transactionType,
        row.amountDescription,
      );

      if (!gstin && row.gstin) gstin = String(row.gstin).trim() || undefined;
      if (!reportMonth && row.reportMonth) {
        reportMonth = String(row.reportMonth).trim() || undefined;
      }
      if (!paymentDate) {
        paymentDate = toIsoDateString(row.depositDate, row.reportMonth);
      }
      if (!idSeed) {
        idSeed =
          typeof row._id === 'object' && row._id && 'toString' in row._id
            ? row._id.toString()
            : String(row._id ?? row.rowKey ?? '');
      }

      if (kind === 'sale') {
        saleAmount += amount;
        continue;
      }
      if (kind === 'return') {
        refundAbs += Math.abs(amount);
        continue;
      }
      if (kind === 'commission') {
        commission += amount;
        const key = 'commission';
        const existing = feeByKey.get(key);
        if (existing) existing.amount += amount;
        else {
          feeByKey.set(key, {
            key,
            label: 'Commission',
            amount,
            category: 'commission',
          });
        }
        continue;
      }
      if (kind === 'tcs') {
        tcs += amount;
        otherFees += amount;
        const key = 'tcs';
        const existing = feeByKey.get(key);
        if (existing) existing.amount += amount;
        else {
          feeByKey.set(key, {
            key,
            label: 'TCS',
            amount,
            category: 'tcs',
          });
        }
        continue;
      }
      if (kind === 'tds') {
        tds += amount;
        otherFees += amount;
        const key = 'tds';
        const existing = feeByKey.get(key);
        if (existing) existing.amount += amount;
        else {
          feeByKey.set(key, {
            key,
            label: 'TDS',
            amount,
            category: 'tds',
          });
        }
        continue;
      }
      if (kind === 'fee' || kind === 'other') {
        // Non-sale, non-return, non-commission components are marketplace fee impact
        // (shipping, FBA, ads, adjustments, etc.) — keep imported sign.
        if (kind === 'other' && amount === 0) continue;
        if (kind === 'other') {
          // Keep unknown non-zero lines in bank sum already; only treat as fee
          // when description suggests a charge/fee/tax/ad, else still include in
          // marketplaceFee so Difference stays consistent with settlement net.
        }
        otherFees += amount;
        const key = feeKey(row.amountDescription) || 'other_marketplace_fee';
        const label = feeLabel(row.amountDescription);
        const existing = feeByKey.get(key);
        if (existing) existing.amount += amount;
        else {
          feeByKey.set(key, {
            key,
            label,
            amount,
            category: 'other',
          });
        }
      }
    }

    const feeComponents = [...feeByKey.values()].filter((c) => c.amount !== 0);
    const marketplaceFee = otherFees !== 0 ? otherFees : undefined;

    out.push({
      _id: idSeed || `amazon:${bucket.orderId}:${bucket.settlementId}`,
      source: 'amazon_payment_transactions',
      orderId: bucket.orderId,
      neftId: bucket.settlementId,
      transactionId: bucket.settlementId,
      paymentDate,
      bankSettlementValue,
      finalSettlementAmount: bankSettlementValue,
      saleAmount: saleAmount !== 0 ? saleAmount : undefined,
      refund: refundAbs !== 0 ? refundAbs : undefined,
      returnType: refundAbs !== 0 ? 'Customer Return' : undefined,
      commission: commission !== 0 ? commission : undefined,
      marketplaceFee,
      tcs: tcs !== 0 ? tcs : undefined,
      tds: tds !== 0 ? tds : undefined,
      feeComponents: feeComponents.length ? feeComponents : undefined,
      gstin,
      marketplace: 'amazon',
      reportMonth,
      paymentMode: 'Settlement',
      neftType: 'Settlement',
    });
  }

  return out;
}

/**
 * Server-side Amazon aggregation result (one doc per orderId+settlementId).
 * Financial sums mirror {@link mapAmazonPaymentComponentsToAnalyticsRows}.
 */
export type AmazonAggregatedSettlementBucket = {
  orderId: string;
  settlementId: string;
  saleAmount: number;
  refundAbs: number;
  commission: number;
  tcs: number;
  tds: number;
  otherFees: number;
  bankSettlementValue: number;
  gstin?: string;
  reportMonth?: string;
  depositDate?: Date | string;
  idSeed?: { toString(): string } | string;
  feeLines?: Array<{
    amountDescription?: string;
    amount?: number;
  }>;
};

/**
 * Map Mongo-aggregated Amazon settlement buckets to PaymentAnalyticsRow.
 * Uses the same fee keys/labels and field rules as the component mapper.
 */
export function mapAmazonAggregatedSettlementsToAnalyticsRows(
  buckets: AmazonAggregatedSettlementBucket[],
): PaymentAnalyticsRow[] {
  const out: PaymentAnalyticsRow[] = [];

  for (const bucket of buckets) {
    const orderId = String(bucket.orderId ?? '').trim();
    if (!orderId) continue;
    const settlementId =
      String(bucket.settlementId ?? '').trim() || 'unknown';

    const saleAmount = num(bucket.saleAmount);
    const refundAbs = num(bucket.refundAbs);
    const commission = num(bucket.commission);
    const tcs = num(bucket.tcs);
    const tds = num(bucket.tds);
    const otherFees = num(bucket.otherFees);
    const bankSettlementValue = num(bucket.bankSettlementValue);

    const feeByKey = new Map<string, PaymentFeeComponent>();

    if (commission !== 0) {
      feeByKey.set('commission', {
        key: 'commission',
        label: 'Commission',
        amount: commission,
        category: 'commission',
      });
    }
    if (tcs !== 0) {
      feeByKey.set('tcs', {
        key: 'tcs',
        label: 'TCS',
        amount: tcs,
        category: 'tcs',
      });
    }
    if (tds !== 0) {
      feeByKey.set('tds', {
        key: 'tds',
        label: 'TDS',
        amount: tds,
        category: 'tds',
      });
    }

    for (const line of bucket.feeLines ?? []) {
      const amount = num(line.amount);
      if (amount === 0) continue;
      const key = feeKey(line.amountDescription) || 'other_marketplace_fee';
      const label = feeLabel(line.amountDescription);
      const existing = feeByKey.get(key);
      if (existing) existing.amount += amount;
      else {
        feeByKey.set(key, {
          key,
          label,
          amount,
          category: 'other',
        });
      }
    }

    const feeComponents = [...feeByKey.values()].filter((c) => c.amount !== 0);
    const marketplaceFee = otherFees !== 0 ? otherFees : undefined;

    const idSeed =
      typeof bucket.idSeed === 'object' &&
      bucket.idSeed &&
      'toString' in bucket.idSeed
        ? bucket.idSeed.toString()
        : String(bucket.idSeed ?? '');

    out.push({
      _id: idSeed || `amazon:${orderId}:${settlementId}`,
      source: 'amazon_payment_transactions',
      orderId,
      neftId: settlementId,
      transactionId: settlementId,
      paymentDate: toIsoDateString(bucket.depositDate, bucket.reportMonth),
      bankSettlementValue,
      finalSettlementAmount: bankSettlementValue,
      saleAmount: saleAmount !== 0 ? saleAmount : undefined,
      refund: refundAbs !== 0 ? refundAbs : undefined,
      returnType: refundAbs !== 0 ? 'Customer Return' : undefined,
      commission: commission !== 0 ? commission : undefined,
      marketplaceFee,
      tcs: tcs !== 0 ? tcs : undefined,
      tds: tds !== 0 ? tds : undefined,
      feeComponents: feeComponents.length ? feeComponents : undefined,
      gstin: bucket.gstin ? String(bucket.gstin).trim() || undefined : undefined,
      marketplace: 'amazon',
      reportMonth: bucket.reportMonth
        ? String(bucket.reportMonth).trim() || undefined
        : undefined,
      paymentMode: 'Settlement',
      neftType: 'Settlement',
    });
  }

  return out;
}
