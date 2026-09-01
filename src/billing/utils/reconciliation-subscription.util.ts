const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function normalizeReportMonths(months: string[]): string[] {
  return Array.from(
    new Set(
      (months ?? [])
        .map((value) => String(value).trim())
        .filter((value) => MONTH_PATTERN.test(value)),
    ),
  ).sort();
}

export function financialYearStartFromReportMonth(reportMonth: string): number | null {
  const match = reportMonth.match(MONTH_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 4 ? year : year - 1;
}

export function formatFinancialYearLabel(fyStartYear: number): string {
  const endSuffix = String(fyStartYear + 1).slice(-2);
  return `${fyStartYear}-${endSuffix}`;
}

export function groupReportMonthsByFinancialYear(months: string[]): string[] {
  const labels = new Set<string>();
  for (const month of normalizeReportMonths(months)) {
    const fyStart = financialYearStartFromReportMonth(month);
    if (typeof fyStart === 'number') {
      labels.add(formatFinancialYearLabel(fyStart));
    }
  }
  return Array.from(labels).sort();
}

export function startOfReportMonth(reportMonth: string): Date | null {
  const match = reportMonth.match(MONTH_PATTERN);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1);
}

export function endOfReportMonth(reportMonth: string): Date | null {
  const match = reportMonth.match(MONTH_PATTERN);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]), 0, 23, 59, 59, 999);
}

export function buildSubscriptionPeriodFromMonths(
  months: string[],
  anchorDate = new Date(),
): { startsAt: Date; endsAt: Date } {
  const normalized = normalizeReportMonths(months);
  if (!normalized.length) {
    const startsAt = new Date(anchorDate);
    const endsAt = new Date(anchorDate);
    endsAt.setFullYear(endsAt.getFullYear() + 1);
    return { startsAt, endsAt };
  }

  const firstStart = startOfReportMonth(normalized[0]);
  const lastEnd = endOfReportMonth(normalized[normalized.length - 1]);
  const startsAt = firstStart ?? new Date(anchorDate);
  const endsAt = lastEnd ?? new Date(anchorDate);
  return { startsAt, endsAt };
}

export type LeadConversionQuoteSnapshot = {
  packageName?: string;
  planType?: string;
  billingMode?: string;
  selectedMonths?: string[];
  monthCount?: number;
  gstSlots?: number;
  panSlots?: number;
  marketplaceSlots?: number;
  durationDays?: number;
  durationYears?: number;
  totalPayable?: number;
};

export function resolveMarketplaceSlotsInPlan(input: {
  marketplaceSlotsPurchased?: number;
  subscriptionPlanType?: string;
  gstSlots?: number;
  gstSlotsPurchased?: number;
}): number {
  const stored = Math.max(0, Number(input.marketplaceSlotsPurchased ?? 0));
  if (stored > 0) return stored;

  const planType = input.subscriptionPlanType;
  if (planType === 'single_gst') return 1;

  const gstInPlan = Math.max(
    0,
    Number(input.gstSlotsPurchased ?? input.gstSlots ?? 0),
  );
  if (planType === 'multi_gst_pan') {
    return gstInPlan > 0 ? gstInPlan : 1;
  }

  return 0;
}

export function resolveMarketplaceSlotsFromQuote(
  quote: LeadConversionQuoteSnapshot,
): number {
  const explicit = Number(quote.marketplaceSlots ?? 0);
  if (explicit > 0) return explicit;
  return resolveMarketplaceSlotsInPlan({
    subscriptionPlanType: quote.planType,
    gstSlots: quote.gstSlots,
    gstSlotsPurchased: quote.gstSlots,
  });
}

export type SellerSubscriptionFields = {
  reconciliationMonths?: string[];
  subscriptionPlanLabel?: string;
  subscriptionPlanType?: string;
  subscriptionStartsAt?: Date;
  subscriptionEndsAt?: Date;
  paymentCompletedAt?: Date;
  paymentVerifiedAt?: Date;
  paymentDate?: Date;
  marketplaceSlotsPurchased?: number;
  gstSlots?: number;
  gstSlotsPurchased?: number;
};

export function applyQuoteSnapshotToSellerFields(
  seller: SellerSubscriptionFields,
  quote: LeadConversionQuoteSnapshot,
): void {
  const months = normalizeReportMonths(quote.selectedMonths ?? []);
  if (!seller.reconciliationMonths?.length && months.length) {
    seller.reconciliationMonths = months;
  }
  if (!seller.subscriptionPlanLabel && quote.packageName) {
    seller.subscriptionPlanLabel = quote.packageName;
  }
  if (!seller.subscriptionPlanType && quote.planType) {
    seller.subscriptionPlanType = quote.planType;
  }
  if (!seller.marketplaceSlotsPurchased) {
    const marketplaceSlots = resolveMarketplaceSlotsFromQuote(quote);
    if (marketplaceSlots > 0) {
      seller.marketplaceSlotsPurchased = marketplaceSlots;
    }
  }
  if (!seller.marketplaceSlotsPurchased && seller.subscriptionPlanType === 'single_gst') {
    seller.marketplaceSlotsPurchased = 1;
  }
  if (!seller.subscriptionStartsAt || !seller.subscriptionEndsAt) {
    const anchor =
      seller.paymentCompletedAt ??
      seller.paymentVerifiedAt ??
      seller.paymentDate ??
      new Date();
    const period = buildSubscriptionPeriodFromMonths(months, new Date(anchor));
    seller.subscriptionStartsAt =
      seller.subscriptionStartsAt ?? period.startsAt;
    seller.subscriptionEndsAt = seller.subscriptionEndsAt ?? period.endsAt;
  }

  const effectiveMonths = normalizeReportMonths(
    seller.reconciliationMonths ?? months,
  );
  if (effectiveMonths.length) {
    const anchor =
      seller.paymentCompletedAt ??
      seller.paymentVerifiedAt ??
      seller.paymentDate ??
      seller.subscriptionStartsAt ??
      new Date();
    const period = buildSubscriptionPeriodFromMonths(
      effectiveMonths,
      new Date(anchor),
    );
    seller.subscriptionStartsAt = period.startsAt;
    seller.subscriptionEndsAt = period.endsAt;
  }
}

export function extractQuoteFromPaymentMetadata(
  metadata?: Record<string, unknown> | null,
): LeadConversionQuoteSnapshot | null {
  if (!metadata) return null;
  const quote = (metadata.quote ?? {}) as Record<string, unknown>;
  const rawMonths = Array.isArray(metadata.selectedMonths)
    ? metadata.selectedMonths
    : Array.isArray(quote.selectedMonths)
      ? quote.selectedMonths
      : [];
  const selectedMonths = normalizeReportMonths(rawMonths as string[]);
  if (
    !selectedMonths.length &&
    !quote.packageName &&
    !quote.planType &&
    !quote.totalPayable
  ) {
    return null;
  }
  return {
    packageName: typeof quote.packageName === 'string' ? quote.packageName : undefined,
    planType: typeof quote.planType === 'string' ? quote.planType : undefined,
    billingMode: typeof quote.billingMode === 'string' ? quote.billingMode : undefined,
    selectedMonths,
    monthCount: Number(quote.monthCount ?? selectedMonths.length) || selectedMonths.length,
    gstSlots: Number(quote.gstSlots ?? 1) || 1,
    panSlots: Number(quote.panSlots ?? quote.gstSlots ?? 1) || 1,
    marketplaceSlots: Number(quote.marketplaceSlots ?? 0) || undefined,
    durationDays: Number(quote.durationDays ?? 0) || undefined,
    durationYears: Number(quote.durationYears ?? 0) || undefined,
    totalPayable: Number(quote.totalPayable ?? 0) || undefined,
  };
}
