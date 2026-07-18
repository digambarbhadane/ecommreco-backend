/** Repair dates corrupted by Date.UTC(2000+day, month-1, year). */

const MIN_YEAR = 2015;

function isReasonableYear(year: number) {
  const max = new Date().getUTCFullYear() + 1;
  return year >= MIN_YEAR && year <= max;
}

export function repairLegacyCorruptedDate(
  value: unknown,
  reportMonth?: string,
): Date | undefined {
  const parsed =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : undefined;
  if (!parsed || Number.isNaN(parsed.getTime())) return undefined;
  if (isReasonableYear(parsed.getUTCFullYear())) return parsed;

  const targetIso = parsed.toISOString().slice(0, 10);
  const monthMatch = String(reportMonth ?? '').match(/^(\d{4})-(\d{2})$/);
  const expectedYear = monthMatch ? Number(monthMatch[1]) : undefined;
  const expectedMonth = monthMatch ? Number(monthMatch[2]) : undefined;
  const nowYear = new Date().getUTCFullYear();
  const candidates: Date[] = [];

  for (let year = MIN_YEAR; year <= nowYear + 1; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (let day = 1; day <= daysInMonth; day += 1) {
        const legacy = new Date(Date.UTC(2000 + day, month - 1, year));
        if (legacy.toISOString().slice(0, 10) === targetIso) {
          candidates.push(new Date(Date.UTC(year, month - 1, day)));
        }
      }
    }
  }
  if (!candidates.length) return undefined;

  if (expectedYear && expectedMonth) {
    const expectedTime = Date.UTC(expectedYear, expectedMonth - 1, 1);
    return candidates.sort(
      (a, b) =>
        Math.abs(a.getTime() - expectedTime) -
        Math.abs(b.getTime() - expectedTime),
    )[0];
  }

  const now = Date.now();
  return candidates.sort(
    (a, b) => Math.abs(a.getTime() - now) - Math.abs(b.getTime() - now),
  )[0];
}

/** Repair a stored date field and return YYYY-MM-DD (or undefined if unusable). */
export function repairDateToIso(
  value: unknown,
  reportMonth?: string,
): string | undefined {
  if (value == null || value === '') return undefined;
  const repaired = repairLegacyCorruptedDate(value, reportMonth);
  if (!repaired) return undefined;
  return repaired.toISOString().slice(0, 10);
}

const IMPORT_ROW_DATE_KEYS = [
  'invoiceDate',
  'buyerInvoiceDate',
  'order_packed_date',
  'order_created_date',
  'frRefundedDate',
  'orderCancelDate',
  'paymentDate',
  'orderDate',
  'returnInvoiceDate',
] as const;

/** Repair known date fields on an import/analytics row for API responses. */
export function repairImportRowDates<T extends Record<string, unknown>>(
  row: T,
): T {
  const reportMonth =
    typeof row.reportMonth === 'string' ? row.reportMonth : undefined;
  const next = { ...row };
  for (const key of IMPORT_ROW_DATE_KEYS) {
    if (next[key] == null || next[key] === '') continue;
    const repaired = repairDateToIso(next[key], reportMonth);
    if (repaired !== undefined) {
      (next as Record<string, unknown>)[key] = repaired;
    } else {
      const parsed = new Date(String(next[key]));
      if (
        !Number.isNaN(parsed.getTime()) &&
        !isReasonableYear(parsed.getUTCFullYear())
      ) {
        (next as Record<string, unknown>)[key] = undefined;
      }
    }
  }
  return next;
}
