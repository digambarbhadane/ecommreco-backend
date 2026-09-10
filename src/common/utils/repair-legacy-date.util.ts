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

  // Prefer explicit DMY (common in Myntra/import files) before Date() MDY ambiguity.
  // Example: "12-06-2026" must stay 2026-06-12, not 2026-12-06.
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const dmy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (dmy) {
      const day = Number(dmy[1]);
      const month = Number(dmy[2]);
      let year = Number(dmy[3]);
      if (year < 100) {
        const full = 2000 + year;
        year = isReasonableYear(full) ? full : 1900 + year;
      }
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        const date = new Date(Date.UTC(year, month - 1, day));
        if (
          date.getUTCFullYear() === year &&
          date.getUTCMonth() === month - 1 &&
          date.getUTCDate() === day &&
          isReasonableYear(year)
        ) {
          return date.toISOString().slice(0, 10);
        }
      }
    }
  }

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

  // Prefer Myntra-authentic invoice dates when present.
  // RTO → orderCancelDate; Customer Return → frRefundedDate; SALE packed → order_packed_date.
  // Do not overwrite other marketplaces that lack these Myntra-specific fields/types.
  const docType = String(next.documentType ?? '').trim();
  if (docType === 'RTO Return') {
    const cancelIso = next.orderCancelDate;
    if (typeof cancelIso === 'string' && cancelIso.trim()) {
      (next as Record<string, unknown>).invoiceDate = cancelIso;
    }
  } else if (docType === 'Customer Return') {
    const refundedIso = next.frRefundedDate;
    if (typeof refundedIso === 'string' && refundedIso.trim()) {
      (next as Record<string, unknown>).invoiceDate = refundedIso;
    }
  } else {
    // Myntra GSTR Packed date is the authentic sale invoice date. Stored invoiceDate
    // can be an MDY-swapped ISO of the same DMY value (e.g. packed 12-06-2026 → 2026-12-06).
    const packedIso = next.order_packed_date;
    if (typeof packedIso === 'string' && packedIso.trim()) {
      (next as Record<string, unknown>).invoiceDate = packedIso;
    }
  }

  return next;
}
