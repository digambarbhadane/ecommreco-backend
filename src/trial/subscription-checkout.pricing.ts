export type SubscriptionPlanType =
  | 'single_gst'
  | 'single_gst_multi_marketplace'
  | 'multi_gst_pan';

export type GstCheckoutSelection = {
  gstNumber: string;
  verificationId: string;
  marketplacePlatformIds: string[];
  selectedMonths?: string[];
};

export const SUBSCRIPTION_RATES = {
  singleGstSingleMarketplace: 999,
  multiTier: 2499,
} as const;

export type TrialCoverageContext = {
  coveredMonths: string[];
  trialGstNumber: string | null;
  trialMarketplacePlatformIds: string[];
};

export type PanPricingBreakdown = {
  panNumber: string;
  gstNumbers: string[];
  gstCount: number;
  marketplaceCount: number;
  monthlyRate: number;
  tierLabel: string;
  selectedMonthCount: number;
  billableMonthCount: number;
  lineSubtotal: number;
};

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function normalizeReportMonths(months: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (months ?? [])
        .map((month) => String(month).trim())
        .filter((month) => MONTH_PATTERN.test(month)),
    ),
  ).sort();
}

/** Trial months waived only when PAN is trial GST + trial marketplace(s) only. */
export function panRequiresFullMonthBilling(
  panItems: GstCheckoutSelection[],
  ctx?: TrialCoverageContext | null,
): boolean {
  if (!ctx?.trialGstNumber || !ctx.coveredMonths.length) {
    return true;
  }
  if (panItems.length > 1) {
    return true;
  }

  const trialGst = ctx.trialGstNumber.toUpperCase();
  const trialMarketplaces = new Set(
    ctx.trialMarketplacePlatformIds.map((id) => String(id).trim()).filter(Boolean),
  );
  if (!trialMarketplaces.size) {
    return true;
  }

  const item = panItems[0];
  const gst = String(item.gstNumber ?? '')
    .trim()
    .toUpperCase();
  if (gst !== trialGst) {
    return true;
  }
  for (const mpId of item.marketplacePlatformIds ?? []) {
    if (!trialMarketplaces.has(String(mpId).trim())) {
      return true;
    }
  }
  return false;
}

export function panBillableMonthCount(
  panItems: GstCheckoutSelection[],
  selectedMonths: string[],
  ctx?: TrialCoverageContext | null,
): number {
  const months = normalizeReportMonths(selectedMonths);
  if (!months.length) {
    return 0;
  }
  if (panRequiresFullMonthBilling(panItems, ctx)) {
    return months.length;
  }
  const trialCovered = new Set(ctx?.coveredMonths ?? []);
  return months.filter((month) => !trialCovered.has(month)).length;
}

export function checkoutIsTrialOnly(
  selections: GstCheckoutSelection[],
  ctx?: TrialCoverageContext | null,
): boolean {
  if (!selections.length || !ctx?.trialGstNumber) {
    return false;
  }
  const groups = groupSelectionsByPan(selections);
  for (const items of groups.values()) {
    if (panRequiresFullMonthBilling(items, ctx)) {
      return false;
    }
  }
  return true;
}

export function normalizeGstSelections(
  selections: GstCheckoutSelection[],
  globalMonths?: string[],
): GstCheckoutSelection[] {
  const fallbackMonths = normalizeReportMonths(globalMonths);

  return selections.map((item) => {
    const gstNumber = String(item.gstNumber ?? '')
      .trim()
      .toUpperCase();
    const marketplacePlatformIds = Array.from(
      new Set(
        (item.marketplacePlatformIds ?? [])
          .map((id) => String(id).trim())
          .filter(Boolean),
      ),
    );
    const selectedMonths = normalizeReportMonths(
      item.selectedMonths?.length ? item.selectedMonths : fallbackMonths,
    );

    return {
      ...item,
      gstNumber,
      marketplacePlatformIds,
      selectedMonths,
    };
  });
}

export function extractPanFromGstin(gstNumber: string): string {
  const value = String(gstNumber ?? '')
    .trim()
    .toUpperCase();
  return value.length >= 12 ? value.slice(2, 12) : '';
}

export function monthlyRateForPanGroup(items: GstCheckoutSelection[]): number {
  const gstCount = items.length;
  const marketplaceCount = items.reduce(
    (sum, item) => sum + (item.marketplacePlatformIds?.length ?? 0),
    0,
  );

  if (gstCount > 1) {
    return SUBSCRIPTION_RATES.multiTier;
  }
  if (marketplaceCount > 1) {
    return SUBSCRIPTION_RATES.multiTier;
  }
  return SUBSCRIPTION_RATES.singleGstSingleMarketplace;
}

export function tierLabelForPanGroup(items: GstCheckoutSelection[]): string {
  const gstCount = items.length;
  const marketplaceCount = items.reduce(
    (sum, item) => sum + (item.marketplacePlatformIds?.length ?? 0),
    0,
  );

  if (gstCount > 1) {
    return 'Multiple GSTs under one PAN';
  }
  if (marketplaceCount > 1) {
    return 'Single GST · multiple marketplaces';
  }
  return 'Single GST · single marketplace';
}

export function groupSelectionsByPan(
  selections: GstCheckoutSelection[],
): Map<string, GstCheckoutSelection[]> {
  const groups = new Map<string, GstCheckoutSelection[]>();
  for (const item of selections) {
    const gstNumber = String(item.gstNumber ?? '')
      .trim()
      .toUpperCase();
    const pan = extractPanFromGstin(gstNumber) || gstNumber;
    const bucket = groups.get(pan) ?? [];
    bucket.push({ ...item, gstNumber });
    groups.set(pan, bucket);
  }
  return groups;
}

export function buildPanBreakdown(
  selections: GstCheckoutSelection[],
  options?: {
    globalMonths?: string[];
    trialCoverage?: TrialCoverageContext | null;
  },
): PanPricingBreakdown[] {
  const normalized = normalizeGstSelections(selections, options?.globalMonths);
  const trialCoverage = options?.trialCoverage ?? null;
  const groups = groupSelectionsByPan(normalized);

  return Array.from(groups.entries()).map(([panNumber, items]) => {
    const monthlyRate = monthlyRateForPanGroup(items);
    const selectedMonths = normalizeReportMonths(
      items.flatMap((item) => item.selectedMonths ?? []),
    );
    const selectedMonthCount = selectedMonths.length;
    const billableMonthCount = panBillableMonthCount(
      items,
      selectedMonths,
      trialCoverage,
    );

    return {
      panNumber,
      gstNumbers: items.map((item) => item.gstNumber),
      gstCount: items.length,
      marketplaceCount: items.reduce(
        (sum, item) => sum + (item.marketplacePlatformIds?.length ?? 0),
        0,
      ),
      monthlyRate,
      tierLabel: tierLabelForPanGroup(items),
      selectedMonthCount,
      billableMonthCount,
      lineSubtotal: Number((monthlyRate * billableMonthCount).toFixed(2)),
    };
  });
}

function deriveOverallPlanType(
  panBreakdown: PanPricingBreakdown[],
): SubscriptionPlanType {
  if (panBreakdown.length > 1) {
    return 'multi_gst_pan';
  }
  const only = panBreakdown[0];
  if (!only) {
    return 'single_gst';
  }
  return only.monthlyRate === SUBSCRIPTION_RATES.singleGstSingleMarketplace
    ? 'single_gst'
    : 'single_gst_multi_marketplace';
}

export function buildPlanLabel(panBreakdown: PanPricingBreakdown[]): string {
  if (!panBreakdown.length) {
    return 'Subscription';
  }
  if (panBreakdown.length === 1) {
    const row = panBreakdown[0];
    if (row.monthlyRate === SUBSCRIPTION_RATES.singleGstSingleMarketplace) {
      return 'Single GST + 1 Marketplace';
    }
    if (row.gstCount > 1) {
      return 'Multiple GSTs under one PAN';
    }
    return 'Single GST + Multiple Marketplaces';
  }
  return `Multiple PAN profiles (${panBreakdown.length})`;
}

export function resolveSubscriptionCheckoutPricing(input: {
  selections: GstCheckoutSelection[];
  selectedMonths?: string[];
  monthCount?: number;
  trialCoverage?: TrialCoverageContext | null;
}) {
  const selections = input.selections ?? [];
  if (!selections.length) {
    throw new Error('Add at least one verified GST to continue.');
  }

  const gstNumbers: string[] = [];

  for (const item of selections) {
    const gstNumber = String(item.gstNumber ?? '')
      .trim()
      .toUpperCase();
    if (!gstNumber) {
      throw new Error('Each GST selection must include a GST number.');
    }
    if (!String(item.verificationId ?? '').trim()) {
      throw new Error(`GST ${gstNumber} must be verified before checkout.`);
    }
    const marketplaces = Array.from(
      new Set(
        (item.marketplacePlatformIds ?? [])
          .map((id) => String(id).trim())
          .filter(Boolean),
      ),
    );
    if (!marketplaces.length) {
      throw new Error(
        `Select at least one marketplace for GST ${gstNumber}.`,
      );
    }
    gstNumbers.push(gstNumber);
  }

  const normalized = normalizeGstSelections(selections, input.selectedMonths);
  const allSelectedMonths = normalizeReportMonths(
    normalized.flatMap((item) => item.selectedMonths ?? []),
  );
  if (!allSelectedMonths.length) {
    throw new Error('Select at least one reconciliation month (YYYY-MM).');
  }

  const panBreakdown = buildPanBreakdown(normalized, {
    trialCoverage: input.trialCoverage,
  });
  const panSlots = panBreakdown.length;
  const gstCount = selections.length;
  const marketplaceSlots = normalized.reduce(
    (sum, item) => sum + (item.marketplacePlatformIds?.length ?? 0),
    0,
  );
  const totalMonthlyRate = panBreakdown.reduce(
    (sum, row) => sum + row.monthlyRate,
    0,
  );
  const billableMonthCount = panBreakdown.reduce(
    (sum, row) => sum + row.billableMonthCount,
    0,
  );
  const planType = deriveOverallPlanType(panBreakdown);
  const subtotalBeforeDiscount = panBreakdown.reduce(
    (sum, row) => sum + row.lineSubtotal,
    0,
  );

  return {
    planType,
    billingMode: planType,
    basePricePerMonth: totalMonthlyRate,
    monthCount: allSelectedMonths.length,
    billableMonthCount,
    panSlots,
    gstSlots: gstCount,
    gstCount,
    marketplaceSlots,
    totalMonthlyRate,
    panBreakdown,
    planLabel: buildPlanLabel(panBreakdown),
    gstNumbers,
    panNumbers: panBreakdown.map((row) => row.panNumber),
    subtotalBeforeDiscount,
    selections: normalized,
    selectedMonths: allSelectedMonths,
    trialCoverageApplied: Boolean(input.trialCoverage?.trialGstNumber),
    checkoutIsTrialOnly: checkoutIsTrialOnly(normalized, input.trialCoverage),
  };
}
