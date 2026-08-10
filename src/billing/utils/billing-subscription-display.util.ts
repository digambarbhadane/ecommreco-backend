import {
  buildPanBreakdown,
  buildPlanLabel,
  type GstCheckoutSelection,
  type PanPricingBreakdown,
} from '../../trial/subscription-checkout.pricing';
import type { Seller } from '../../sellers/schemas/seller.schema';

export type SubscriptionDisplaySnapshot = {
  planLabel: string;
  planType?: string;
  reconciliationMonths: string[];
  billableMonthCount: number;
  totalMonthlyRate: number;
  gstProfilesInPlan: number;
  panProfilesInPlan: number;
  marketplaceLinksPurchased: number;
  panBreakdown: PanPricingBreakdown[];
};

export function buildSubscriptionInvoiceDescription(input: {
  planLabel?: string;
  reconciliationMonths?: string[];
  billableMonthCount?: number;
  totalMonthlyRate?: number;
  gstProfilesInPlan?: number;
  marketplaceLinksPurchased?: number;
}): string {
  const parts = ['EcommReco subscription'];
  if (input.planLabel?.trim()) {
    parts.push(input.planLabel.trim());
  }
  const monthCount = input.reconciliationMonths?.length ?? 0;
  if (monthCount > 0) {
    parts.push(`${monthCount} reconciliation month(s)`);
  } else if (input.billableMonthCount && input.billableMonthCount > 0) {
    parts.push(`${input.billableMonthCount} billable month(s)`);
  }
  if (input.gstProfilesInPlan && input.gstProfilesInPlan > 0) {
    parts.push(
      `${input.gstProfilesInPlan} GST profile${input.gstProfilesInPlan === 1 ? '' : 's'}`,
    );
  }
  if (input.marketplaceLinksPurchased && input.marketplaceLinksPurchased > 0) {
    parts.push(
      `${input.marketplaceLinksPurchased} marketplace link${input.marketplaceLinksPurchased === 1 ? '' : 's'}`,
    );
  }
  if (input.totalMonthlyRate && input.totalMonthlyRate > 0) {
    parts.push(`₹${input.totalMonthlyRate.toLocaleString('en-IN')}/mo plan rate`);
  }
  return parts.join(' · ');
}

export function resolveStoredPanBreakdown(
  seller: Seller,
): PanPricingBreakdown[] {
  const stored = seller.subscriptionPanBreakdown;
  if (!Array.isArray(stored) || !stored.length) {
    return [];
  }
  return stored.map((row) => ({
    panNumber: String(row.panNumber ?? '').toUpperCase(),
    gstNumbers: (row.gstNumbers ?? []).map((gst) =>
      String(gst).trim().toUpperCase(),
    ),
    gstCount: Number(row.gstCount ?? row.gstNumbers?.length ?? 0),
    marketplaceCount: Number(row.marketplaceCount ?? 0),
    monthlyRate: Number(row.monthlyRate ?? 0),
    tierLabel: String(row.tierLabel ?? ''),
    selectedMonthCount: Number(row.selectedMonthCount ?? 0),
    billableMonthCount: Number(row.billableMonthCount ?? 0),
    lineSubtotal: Number(row.lineSubtotal ?? 0),
  }));
}

export function buildPanBreakdownFromSelections(
  selections: GstCheckoutSelection[],
  reconciliationMonths: string[],
): PanPricingBreakdown[] {
  if (!selections.length || !reconciliationMonths.length) {
    return [];
  }
  try {
    return buildPanBreakdown(selections, {
      globalMonths: reconciliationMonths,
    });
  } catch {
    return [];
  }
}

export function resolveSubscriptionDisplaySnapshot(
  seller: Seller,
  checkoutSelections?: GstCheckoutSelection[],
): SubscriptionDisplaySnapshot {
  const reconciliationMonths = Array.isArray(seller.reconciliationMonths)
    ? [...seller.reconciliationMonths].sort()
    : [];

  let panBreakdown = resolveStoredPanBreakdown(seller);
  const hasStoredBreakdown = panBreakdown.length > 0;
  if (!hasStoredBreakdown && checkoutSelections?.length && reconciliationMonths.length) {
    panBreakdown = buildPanBreakdownFromSelections(
      checkoutSelections,
      reconciliationMonths,
    );
  }

  const billableMonthCount = hasStoredBreakdown
    ? panBreakdown.reduce((sum, row) => sum + row.billableMonthCount, 0)
    : reconciliationMonths.length;
  const totalMonthlyRate = hasStoredBreakdown
    ? panBreakdown.reduce((sum, row) => sum + row.monthlyRate, 0)
    : 0;

  const gstProfilesInPlan = hasStoredBreakdown
    ? panBreakdown.reduce((sum, row) => sum + row.gstCount, 0)
    : Math.max(
        0,
        Number(seller.gstSlotsPurchased ?? seller.gstSlots ?? 0),
      );
  const panProfilesInPlan = hasStoredBreakdown
    ? panBreakdown.length
    : Math.max(
        0,
        Number(seller.totalPanSlots ?? seller.allocatedPanSlots ?? 0),
      );
  const marketplaceLinksPurchased = hasStoredBreakdown
    ? panBreakdown.reduce((sum, row) => sum + row.marketplaceCount, 0)
    : Math.max(0, Number(seller.marketplaceSlotsPurchased ?? 0));

  const planLabel =
    seller.subscriptionPlanLabel?.trim() ||
    (panBreakdown.length ? buildPlanLabel(panBreakdown) : '') ||
  formatLegacyPlanLabel(seller);

  return {
    planLabel,
    planType: seller.subscriptionPlanType,
    reconciliationMonths,
    billableMonthCount,
    totalMonthlyRate,
    gstProfilesInPlan,
    panProfilesInPlan,
    marketplaceLinksPurchased,
    panBreakdown,
  };
}

function formatLegacyPlanLabel(seller: Seller): string {
  const planType = seller.subscriptionPlanType;
  if (planType === 'single_gst_multi_marketplace') {
    return 'Single GST · multiple marketplaces';
  }
  if (planType === 'multi_gst_pan') {
    return 'Multiple GSTs under one PAN';
  }
  if (planType === 'single_gst') {
    return 'Single GST · single marketplace';
  }
  const years = seller.durationYears ?? seller.subscriptionDuration;
  if (years) {
    return `EcommReco Seller · ${years} year(s)`;
  }
  return 'EcommReco subscription';
}
