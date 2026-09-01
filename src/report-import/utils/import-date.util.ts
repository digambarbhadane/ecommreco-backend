import { repairLegacyCorruptedDate } from '../../common/utils/repair-legacy-date.util';

/** Parse import file date values (Excel serial, DD/MM/YYYY, ISO, YYYYMMDD). */

const MIN_YEAR = 2015;
const MAX_YEAR_AHEAD = 1;
/** Excel serials roughly covering 1990-01-01 .. 2035-12-31 */
const MIN_EXCEL_SERIAL = 32874;
const MAX_EXCEL_SERIAL = 49673;

function isReasonableYear(year: number) {
  const max = new Date().getUTCFullYear() + MAX_YEAR_AHEAD;
  return year >= MIN_YEAR && year <= max;
}

function assertReasonable(date: Date | undefined): Date | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined;
  if (!isReasonableYear(date.getUTCFullYear())) return undefined;
  return date;
}

export function parseImportDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const compact = Math.trunc(value);
    const compactDate = parseYyyymmddInteger(compact);
    if (compactDate) return assertReasonable(compactDate);

    if (value < MIN_EXCEL_SERIAL || value > MAX_EXCEL_SERIAL) {
      return undefined;
    }
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return assertReasonable(Number.isNaN(date.getTime()) ? undefined : date);
  }

  const raw = String(value).trim();
  if (!raw) return undefined;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const byIso = new Date(Date.UTC(year, month - 1, day));
    if (
      byIso.getUTCFullYear() === year &&
      byIso.getUTCMonth() === month - 1 &&
      byIso.getUTCDate() === day
    ) {
      return assertReasonable(byIso);
    }
  }

  const compactToken = raw.replace(/[^\d]/g, '');
  if (/^\d{8}$/.test(compactToken)) {
    const compactDate = parseYyyymmddString(compactToken);
    if (compactDate) return assertReasonable(compactDate);
  }

  const extractedDateToken =
    raw.match(/\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/)?.[0] ?? raw;
  const normalized = extractedDateToken.replace(/\./g, '/').replace(/-/g, '/');
  const parts = normalized.split('/').map((part) => Number(part));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    const [d, m, y] = parts;
    let inferredYear = y < 100 ? 2000 + y : y;
    if (y < 100 && !isReasonableYear(inferredYear)) {
      inferredYear = 1900 + y;
    }
    if (
      d >= 1 &&
      d <= 31 &&
      m >= 1 &&
      m <= 12 &&
      isReasonableYear(inferredYear)
    ) {
      const byDmy = new Date(Date.UTC(inferredYear, m - 1, d));
      if (
        byDmy.getUTCFullYear() === inferredYear &&
        byDmy.getUTCMonth() === m - 1 &&
        byDmy.getUTCDate() === d
      ) {
        return byDmy;
      }
    }
  }

  const date = new Date(normalized);
  return assertReasonable(Number.isNaN(date.getTime()) ? undefined : date);
}

function parseYyyymmddInteger(value: number): Date | undefined {
  if (value < 10000101 || value > 99991231) return undefined;
  return parseYyyymmddString(String(value));
}

function parseYyyymmddString(token: string): Date | undefined {
  const year = Number(token.slice(0, 4));
  const month = Number(token.slice(4, 6));
  const day = Number(token.slice(6, 8));
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return undefined;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return date;
}

export function formatImportDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatImportDateDmy(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

export function asImportDateIso(value: unknown): string | undefined {
  const date = parseImportDate(value);
  return date ? formatImportDateIso(date) : undefined;
}

export function asImportDateDmy(value: unknown): string | undefined {
  const date = parseImportDate(value);
  return date ? formatImportDateDmy(date) : undefined;
}

/** Convert DD-MM-YYYY (or any parseable date) to ISO YYYY-MM-DD for queries. */
export function dmyToIsoDate(value: unknown): string | undefined {
  return asImportDateIso(value);
}

export function repairLegacyCorruptedImportDate(
  value: unknown,
  reportMonth?: string,
): Date | undefined {
  return repairLegacyCorruptedDate(value, reportMonth);
}
