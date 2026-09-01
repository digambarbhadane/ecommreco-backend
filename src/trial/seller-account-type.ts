import { TRIAL_DURATION_DAYS } from './trial.constants';

export type SellerAccountKind = 'trial' | 'subscription' | 'standard';

type SellerAccountFields = {
  isTrial?: boolean;
  trialStatus?: string;
  convertedToPaid?: boolean;
  reconciliationMonths?: string[];
  subscriptionPlanType?: string;
  trialStart?: Date | string;
  trialEnd?: Date | string;
  subscriptionStartsAt?: Date | string;
  subscriptionEndsAt?: Date | string;
  paymentStatus?: string;
  subscriptionId?: string;
  trialSubscriptionId?: string;
  accountCreatedAt?: Date | string;
  createdAt?: Date | string;
  durationYears?: number;
  subscriptionDuration?: number;
};

export function resolveSellerAccountKind(
  seller: SellerAccountFields,
): SellerAccountKind {
  const converted =
    Boolean(seller.convertedToPaid) || seller.trialStatus === 'converted';
  const reconciliationMonths = Array.isArray(seller.reconciliationMonths)
    ? seller.reconciliationMonths.filter(Boolean)
    : [];
  const hasPaidMonths = reconciliationMonths.length > 0;

  if (!converted && !hasPaidMonths && !seller.subscriptionPlanType) {
    if (seller.isTrial) return 'trial';
    if (
      seller.trialStatus === 'active' ||
      seller.trialStatus === 'expired' ||
      seller.trialStatus === 'pending_payment' ||
      seller.trialStatus === 'suspended'
    ) {
      return 'trial';
    }

    const start = seller.trialStart ?? seller.subscriptionStartsAt;
    const end = seller.trialEnd ?? seller.subscriptionEndsAt;
    if (start && end) {
      const startMs = new Date(start).getTime();
      const endMs = new Date(end).getTime();
      if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs) {
        const days = Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1000));
        if (days > 0 && days <= TRIAL_DURATION_DAYS + 1) {
          return 'trial';
        }
      }
    }
  }

  if (
    converted ||
    hasPaidMonths ||
    seller.subscriptionPlanType ||
    seller.paymentStatus === 'paid'
  ) {
    return 'subscription';
  }

  return 'standard';
}

export function isTrialSellerAccount(seller: SellerAccountFields): boolean {
  return resolveSellerAccountKind(seller) === 'trial';
}

export function getAccountTypeLabel(kind: SellerAccountKind): string {
  if (kind === 'trial') return 'Trial account';
  if (kind === 'subscription') return 'Paid subscription';
  return 'Standard account';
}

export function getPlanValidityPeriod(
  seller: SellerAccountFields,
  isTrial: boolean,
): { startsAt?: Date; endsAt?: Date } {
  if (isTrial) {
    const startsAt = seller.trialStart ?? seller.subscriptionStartsAt;
    const endsAt = seller.trialEnd ?? seller.subscriptionEndsAt;
    return {
      startsAt: startsAt ? new Date(startsAt) : undefined,
      endsAt: endsAt ? new Date(endsAt) : undefined,
    };
  }
  return {
    startsAt: seller.subscriptionStartsAt
      ? new Date(seller.subscriptionStartsAt)
      : undefined,
    endsAt: seller.subscriptionEndsAt
      ? new Date(seller.subscriptionEndsAt)
      : undefined,
  };
}

export function formatPlanDurationLabel(
  seller: SellerAccountFields,
  isTrial: boolean,
): string {
  if (isTrial) {
    const { startsAt, endsAt } = getPlanValidityPeriod(seller, true);
    if (
      startsAt &&
      endsAt &&
      !Number.isNaN(startsAt.getTime()) &&
      !Number.isNaN(endsAt.getTime())
    ) {
      const days = Math.max(
        1,
        Math.ceil(
          (endsAt.getTime() - startsAt.getTime()) / (24 * 60 * 60 * 1000),
        ),
      );
      return `${days} day trial`;
    }
    return `${TRIAL_DURATION_DAYS} day trial`;
  }

  const reconciliationMonths = Array.isArray(seller.reconciliationMonths)
    ? seller.reconciliationMonths.filter(Boolean)
    : [];
  if (reconciliationMonths.length > 0) {
    return `${reconciliationMonths.length} reconciliation month(s)`;
  }

  const durationYears =
    seller.durationYears ?? seller.subscriptionDuration ?? undefined;
  if (durationYears) {
    return `${durationYears} year(s)`;
  }

  const { startsAt, endsAt } = getPlanValidityPeriod(seller, false);
  if (
    startsAt &&
    endsAt &&
    !Number.isNaN(startsAt.getTime()) &&
    !Number.isNaN(endsAt.getTime())
  ) {
    const days = Math.ceil(
      (endsAt.getTime() - startsAt.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (days > 0 && days < 32) {
      return `${days} day(s)`;
    }
    const months = Math.round(days / 30);
    if (months > 0) return `${months} month(s)`;
  }

  return '—';
}

export function resolveSubscriptionDisplayId(
  seller: SellerAccountFields,
): string | undefined {
  return seller.subscriptionId || seller.trialSubscriptionId || undefined;
}

export function resolveAccountCreatedAt(
  seller: SellerAccountFields,
): Date | undefined {
  const value = seller.accountCreatedAt ?? seller.createdAt;
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
