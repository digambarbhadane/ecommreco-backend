import {
  coercePaymentDate,
  coercePaymentNumber,
  coercePaymentString,
} from '../../core/payment-row-coercion.util';
import { normalizePaymentHeader } from '../../core/payment-header-normalizer.util';

/**
 * Flipkart secondary payment sheets often:
 * - leave NEFT ID blank on follow-on rows under the same payout
 * - leave Payment Date blank when it repeats
 *
 * Forward-fill those identifiers so every data line is kept.
 */
export function forwardFillSecondaryPaymentIds(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  let lastNeftId: string | undefined;
  let lastPaymentDate: string | undefined;
  const enriched: Array<Record<string, unknown>> = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row: Record<string, unknown> = {
      ...rows[index],
      __lineIndex: rows[index].__lineIndex ?? index,
    };

    const neftKey = findHeaderKey(
      row,
      (normalized) =>
        normalized === 'neft id' ||
        normalized === 'neftid' ||
        normalized.includes('neft id') ||
        (normalized.includes('neft') && !normalized.includes('type')),
    );
    const paymentKey = findHeaderKey(
      row,
      (normalized) =>
        normalized === 'payment date' || normalized === 'settlement date',
    );

    const neftId = coercePaymentString(neftKey ? row[neftKey] : undefined);
    if (neftId) {
      lastNeftId = neftId;
    } else if (lastNeftId) {
      if (neftKey) row[neftKey] = lastNeftId;
      else row['NEFT ID'] = lastNeftId;
    }

    const paymentDate = coercePaymentDate(
      paymentKey ? row[paymentKey] : undefined,
    );
    if (paymentDate) {
      lastPaymentDate = paymentDate;
      if (paymentKey) row[paymentKey] = paymentDate;
    } else if (lastPaymentDate) {
      if (paymentKey) row[paymentKey] = lastPaymentDate;
      else row['Payment Date'] = lastPaymentDate;
    }

    const resolvedNeft = coercePaymentString(
      (neftKey ? row[neftKey] : undefined) ?? row['NEFT ID'],
    );
    if (!resolvedNeft) continue;

    enriched.push(row);
  }

  return enriched;
}

/**
 * Storage_Recall: compute Settlement Value from Excel columns J+K when the
 * SUM(J:K) formula cell has no cached value.
 */
export function enrichStorageRecallSheetRows(
  rows: Array<Record<string, unknown>>,
  readCellValue: (absoluteRow: number, absoluteCol: number) => unknown,
): Array<Record<string, unknown>> {
  const filled = forwardFillSecondaryPaymentIds(rows);

  return filled.map((row) => {
    const next: Record<string, unknown> = { ...row };
    const settlementKey = findHeaderKey(
      next,
      (normalized) =>
        normalized.includes('settlement value') ||
        normalized.includes('settlement amount'),
    );

    const existingSettlement = settlementKey
      ? coercePaymentNumber(next[settlementKey])
      : undefined;

    if (existingSettlement === undefined) {
      const absoluteRow = Number(next.__rowNumber ?? 0) - 1;
      if (Number.isFinite(absoluteRow) && absoluteRow >= 0) {
        const colJ = coercePaymentNumber(readCellValue(absoluteRow, 9));
        const colK = coercePaymentNumber(readCellValue(absoluteRow, 10));
        if (colJ !== undefined || colK !== undefined) {
          const targetKey = settlementKey ?? 'Settlement Value(Rs.) = SUM(J:K)';
          next[targetKey] = (colJ ?? 0) + (colK ?? 0);
        }
      }
    }

    return next;
  });
}

function findHeaderKey(
  row: Record<string, unknown>,
  predicate: (normalized: string) => boolean,
): string | undefined {
  for (const key of Object.keys(row)) {
    if (key.startsWith('__')) continue;
    if (predicate(normalizePaymentHeader(key))) return key;
  }
  return undefined;
}
