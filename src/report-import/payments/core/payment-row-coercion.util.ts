import { asImportDateIso } from '../../utils/import-date.util';

export function coercePaymentString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text.length ? text : undefined;
}

export function coercePaymentNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value)
    .replace(/[₹,]/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function coercePaymentDate(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const iso = asImportDateIso(value);
  return iso ?? coercePaymentString(value);
}

export function coercePaymentInteger(value: unknown): number | undefined {
  const num = coercePaymentNumber(value);
  if (num === undefined) return undefined;
  return Math.trunc(num);
}
