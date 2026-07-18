export const TRIAL_PRICE = 499;
export const TRIAL_GST_PERCENTAGE = 18;
export const TRIAL_DURATION_DAYS = 7;
export const TRIAL_DATA_RETENTION_DAYS = 90;
export const TRIAL_ALLOWED_IMPORT_MONTHS = 3;
export const TRIAL_GST_SLOTS = 1;
export const TRIAL_PAN_SLOTS = 1;

export const TRIAL_STATUSES = [
  'pending_payment',
  'active',
  'expired',
  'converted',
  'suspended',
  'data_deleted',
] as const;

export type TrialStatus = (typeof TRIAL_STATUSES)[number];

export function computeTrialPayable(basePrice = TRIAL_PRICE) {
  const gstAmount = Number(((basePrice * TRIAL_GST_PERCENTAGE) / 100).toFixed(2));
  const totalPayable = Number((basePrice + gstAmount).toFixed(2));
  return {
    basePrice,
    gstPercentage: TRIAL_GST_PERCENTAGE,
    gstAmount,
    totalPayable,
  };
}

export function extractPanFromGstin(gstin: string): string | null {
  const value = String(gstin ?? '')
    .trim()
    .toUpperCase();
  if (value.length < 12) return null;
  return value.slice(2, 12);
}

/** Registration month + previous 3 months (4 months total). */
export function getTrialAllowedReportMonths(reference: Date): string[] {
  const months: string[] = [];
  const cursor = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1),
  );
  for (let i = 0; i <= TRIAL_ALLOWED_IMPORT_MONTHS; i += 1) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    months.push(`${year}-${month}`);
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return months;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
