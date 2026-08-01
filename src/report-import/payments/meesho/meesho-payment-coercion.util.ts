import { parseImportDate } from '../../utils/import-date.util';

export function coerceMeeshoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

export function coerceMeeshoNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value)
    .replace(/[₹,]/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!cleaned) return null;
  if (/^#(n\/?a|ref!|value!|div\/0!)/i.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function coerceMeeshoDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = parseImportDate(value);
  return parsed ?? null;
}

export function normalizeMeeshoHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ');
}
