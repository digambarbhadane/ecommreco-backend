import { createHash } from 'crypto';
import {
  buildNormalizedHeaderLookup,
  normalizePaymentHeader,
} from '../../core/payment-header-normalizer.util';
import {
  coercePaymentDate,
  coercePaymentNumber,
  coercePaymentString,
} from '../../core/payment-row-coercion.util';
import {
  findSecondarySheetDefByKind,
  type FlipkartPaymentSecondarySheetKind,
} from './flipkart-payment-sheet-kinds';

export type MappedSecondarySheetRow = {
  fields: Record<string, unknown>;
  rowKey: string;
};

function buildFieldLookup(
  kind: FlipkartPaymentSecondarySheetKind,
): Map<string, string> | null {
  const def = findSecondarySheetDefByKind(kind);
  if (!def) return null;

  const entries: Array<{ excelLabel: string; field: string }> = [];
  for (const [field, aliases] of Object.entries(def.fields)) {
    for (const alias of aliases ?? []) {
      entries.push({ excelLabel: alias, field });
    }
  }
  return buildNormalizedHeaderLookup(entries);
}

function coerceFieldValue(
  field: string,
  value: unknown,
): string | number | undefined {
  if (field === 'settlementValue') return coercePaymentNumber(value);
  if (field === 'paymentDate' || field === 'claimDate')
    return coercePaymentDate(value);
  return coercePaymentString(value);
}

function secondaryPartForKind(
  kind: FlipkartPaymentSecondarySheetKind,
  fields: Record<string, unknown>,
): string {
  switch (kind) {
    case 'mpFeeRebate':
      return String(fields.orderId ?? '');
    case 'nonOrderSpf':
      return String(fields.claimId ?? '');
    case 'valueAddedServices':
    case 'googleAdsServices':
      return `${fields.serviceName ?? ''}::${fields.paymentDate ?? ''}`;
    case 'ads':
      return String(fields.campaignTransactionId ?? '');
    case 'tcsRecovery':
      return String(fields.transactionId ?? '');
    case 'tds':
      return String(fields.refId ?? '');
    default:
      return '';
  }
}

function isSecondaryPartEmpty(secondaryPart: string): boolean {
  return secondaryPart.replace(/:/g, '').trim().length === 0;
}

/**
 * Storage_Recall often repeats the same NEFT across many lines.
 * Keep every sheet row via stable line index (do not collapse by NEFT).
 */
function buildStorageRecallRowKey(
  neftId: string,
  fields: Record<string, unknown>,
  rawRow: Record<string, unknown>,
): string {
  const lineIndex = Number(rawRow.__lineIndex ?? NaN);
  if (Number.isFinite(lineIndex)) {
    return `${neftId}::line::${lineIndex}`;
  }

  const rowNumber = Number(rawRow.__rowNumber ?? NaN);
  if (Number.isFinite(rowNumber)) {
    return `${neftId}::row::${rowNumber}::${fields.settlementValue ?? ''}::${fields.serviceName ?? ''}`;
  }

  const hash = createHash('sha1')
    .update(
      JSON.stringify({
        neftId,
        serviceName: fields.serviceName,
        paymentDate: fields.paymentDate,
        settlementValue: fields.settlementValue,
        raw: rawRow,
      }),
    )
    .digest('hex')
    .slice(0, 16);
  return `${neftId}::hash::${hash}`;
}

function buildRowKey(
  kind: FlipkartPaymentSecondarySheetKind,
  neftId: string,
  fields: Record<string, unknown>,
  rawRow: Record<string, unknown>,
): string {
  // Always persist every Storage_Recall line, even when NEFT IDs repeat.
  if (kind === 'storageRecall') {
    return buildStorageRecallRowKey(neftId, fields, rawRow);
  }

  const secondaryPart = secondaryPartForKind(kind, fields);

  if (!isSecondaryPartEmpty(secondaryPart)) {
    return `${neftId}::${secondaryPart}`;
  }

  const rowNumber = Number(rawRow.__rowNumber ?? NaN);
  const hash = createHash('sha1')
    .update(JSON.stringify(fields))
    .digest('hex')
    .slice(0, 16);
  return Number.isFinite(rowNumber)
    ? `${neftId}::${hash}::${rowNumber}`
    : `${neftId}::${hash}`;
}

export function mapSecondarySheetRow(
  kind: FlipkartPaymentSecondarySheetKind,
  rawRow: Record<string, unknown>,
): MappedSecondarySheetRow | null {
  const lookup = buildFieldLookup(kind);
  if (!lookup) return null;

  const fields: Record<string, unknown> = {};

  for (const [header, value] of Object.entries(rawRow)) {
    if (header.startsWith('__')) continue;
    if (value === undefined || value === null || value === '') continue;
    const field = lookup.get(normalizePaymentHeader(header));
    if (!field || fields[field] !== undefined) continue;
    const coerced = coerceFieldValue(field, value);
    if (coerced !== undefined) {
      fields[field] = coerced;
    }
  }

  // Fuzzy NEFT recovery when exact header aliases miss (e.g. "NEFTID", "Bank NEFT").
  if (!coercePaymentString(fields.neftId)) {
    for (const [header, value] of Object.entries(rawRow)) {
      if (header.startsWith('__')) continue;
      const normalized = normalizePaymentHeader(header);
      if (
        normalized === 'neft id' ||
        normalized === 'neftid' ||
        (normalized.includes('neft') && !normalized.includes('type'))
      ) {
        const coerced = coercePaymentString(value);
        if (coerced) {
          fields.neftId = coerced;
          break;
        }
      }
    }
  }

  const neftId = coercePaymentString(fields.neftId);
  if (!neftId) return null;
  fields.neftId = neftId;

  // Fallback for formula-labelled settlement columns that don't exact-match aliases.
  if (fields.settlementValue === undefined) {
    for (const [header, value] of Object.entries(rawRow)) {
      if (header.startsWith('__')) continue;
      const normalized = normalizePaymentHeader(header);
      if (
        normalized.includes('settlement value') ||
        normalized.includes('settlement amount')
      ) {
        const coerced = coercePaymentNumber(value);
        if (coerced !== undefined) {
          fields.settlementValue = coerced;
          break;
        }
      }
    }
  }

  const rowKey = buildRowKey(kind, neftId, fields, rawRow);
  return { fields, rowKey };
}
