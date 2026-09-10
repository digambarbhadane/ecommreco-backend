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
  const gstAmount = Number(
    ((basePrice * TRIAL_GST_PERCENTAGE) / 100).toFixed(2),
  );
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

export function resolveTrialRegistrationDate(input: {
  trialStart?: Date | string;
  accountCreatedAt?: Date | string;
  createdAt?: Date | string;
}): Date {
  for (const value of [
    input.trialStart,
    input.accountCreatedAt,
    input.createdAt,
  ]) {
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

/**
 * Trial uploads: the 3 calendar months immediately before registration month
 * (registration month itself is excluded).
 */
export function getTrialAllowedReportMonthsFromRegistration(
  registrationDate: Date = new Date(),
): string[] {
  const anchor = new Date(
    registrationDate.getFullYear(),
    registrationDate.getMonth() - 1,
    1,
  );
  const months: string[] = [];

  for (let i = 0; i < TRIAL_ALLOWED_IMPORT_MONTHS; i += 1) {
    const y = anchor.getFullYear();
    const m = String(anchor.getMonth() + 1).padStart(2, '0');
    months.push(`${y}-${m}`);
    anchor.setMonth(anchor.getMonth() - 1);
  }

  return months.sort();
}

export function getTrialAllowedReportMonthsForSeller(seller: {
  trialStart?: Date | string;
  accountCreatedAt?: Date | string;
  createdAt?: Date | string;
}): string[] {
  return getTrialAllowedReportMonthsFromRegistration(
    resolveTrialRegistrationDate(seller),
  );
}

/** Whether this seller ever received trial reconciliation month access. */
export function sellerHadTrialCoverage(seller: {
  isTrial?: boolean;
  trialStart?: Date | string;
  trialStatus?: string;
  convertedToPaid?: boolean;
}): boolean {
  if (seller.isTrial) return true;
  if (seller.trialStart) return true;
  if (seller.convertedToPaid) return true;
  if (seller.trialStatus === 'converted') return true;
  return (
    seller.trialStatus === 'active' ||
    seller.trialStatus === 'expired' ||
    seller.trialStatus === 'pending_payment' ||
    seller.trialStatus === 'suspended'
  );
}

/** Trial months that must not be purchased again when upgrading from trial. */
export function getTrialCoveredMonthsForPurchase(seller: {
  isTrial?: boolean;
  trialStart?: Date | string;
  trialStatus?: string;
  convertedToPaid?: boolean;
  accountCreatedAt?: Date | string;
  createdAt?: Date | string;
}): string[] {
  if (!sellerHadTrialCoverage(seller)) {
    return [];
  }
  return getTrialAllowedReportMonthsForSeller(seller);
}

/** @deprecated Use getTrialAllowedReportMonthsForSeller — kept for compatibility. */
export function getTrialAllowedReportMonths(
  reference: Date = new Date(),
): string[] {
  return getTrialAllowedReportMonthsFromRegistration(reference);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
