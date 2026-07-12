/** Parse import file date values (Excel serial, DD/MM/YYYY, ISO, YYYYMMDD). */
export function parseImportDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const compact = Math.trunc(value);
    const compactDate = parseYyyymmddInteger(compact);
    if (compactDate) return compactDate;

    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const raw = String(value).trim();
  if (!raw) return undefined;

  const compactToken = raw.replace(/[^\d]/g, '');
  if (/^\d{8}$/.test(compactToken)) {
    const compactDate = parseYyyymmddString(compactToken);
    if (compactDate) return compactDate;
  }

  const extractedDateToken =
    raw.match(/\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/)?.[0] ?? raw;
  const normalized = extractedDateToken.replace(/\./g, '/').replace(/-/g, '/');
  const parts = normalized.split('/').map((part) => Number(part));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    const [d, m, y] = parts;
    const inferredYear = y < 100 ? 2000 + y : y;
    const byDmy = new Date(Date.UTC(inferredYear, m - 1, d));
    if (!Number.isNaN(byDmy.getTime())) return byDmy;
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const byIso = new Date(
      Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])),
    );
    if (!Number.isNaN(byIso.getTime())) return byIso;
  }

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseYyyymmddInteger(value: number): Date | undefined {
  if (value < 10000101 || value > 99991231) return undefined;
  return parseYyyymmddString(String(value));
}

function parseYyyymmddString(token: string): Date | undefined {
  const year = Number(token.slice(0, 4));
  const month = Number(token.slice(4, 6));
  const day = Number(token.slice(6, 8));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
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
