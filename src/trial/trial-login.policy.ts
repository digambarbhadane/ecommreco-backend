export type SellerLoginSnapshot = {
  _id?: unknown;
  id?: string;
  accountStatus?: string;
  accountStatusReason?: string;
  isTrial?: boolean;
  trialStatus?: string;
  paymentStatus?: string;
  onboardingStatus?: string;
  password?: string;
};

const blockedAccountStatuses = new Set(['suspended', 'paused']);

const blockedOnboardingStatuses = new Set([
  'lead_generated',
  'sales_contacted',
  'payment_pending',
]);

const allowedOnboardingStatuses = new Set([
  'training_pending',
  'training_completed',
  'active',
]);

export type SellerLoginEvaluation = {
  allowed: boolean;
  message?: string;
  errorCode?: string;
  sellerId?: string;
  accountStatusReason?: string;
};

export function evaluateSellerLogin(
  seller: SellerLoginSnapshot,
  options?: { requirePassword?: boolean },
): SellerLoginEvaluation {
  const requirePassword = options?.requirePassword !== false;
  const hasPassword =
    typeof seller.password === 'string' && seller.password.trim().length > 0;

  if (requirePassword && !hasPassword) {
    return {
      allowed: false,
      message:
        'Login credentials are not set yet. Contact support to complete onboarding.',
      errorCode: 'SELLER_NO_CREDENTIALS',
    };
  }

  const sellerId = String(seller.id ?? seller._id ?? '');
  const accountStatus = String(seller.accountStatus ?? 'active')
    .trim()
    .toLowerCase();

  if (blockedAccountStatuses.has(accountStatus)) {
    const accountStatusReason = String(seller.accountStatusReason ?? '').trim();
    return {
      allowed: false,
      message:
        accountStatus === 'paused'
          ? 'Your account is paused. Contact support to resume access.'
          : 'Your account has been suspended. Contact support for assistance.',
      errorCode:
        accountStatus === 'paused' ? 'ACCOUNT_PAUSED' : 'ACCOUNT_SUSPENDED',
      sellerId,
      accountStatusReason: accountStatusReason || undefined,
    };
  }

  const onboarding = seller.onboardingStatus ?? 'payment_pending';
  const paymentStatus = String(seller.paymentStatus ?? '').trim().toLowerCase();
  const trialStatus = seller.trialStatus;

  if (seller.isTrial) {
    if (trialStatus === 'suspended') {
      const accountStatusReason = String(seller.accountStatusReason ?? '').trim();
      return {
        allowed: false,
        message: 'Your trial account is suspended. Contact support.',
        errorCode: 'TRIAL_SUSPENDED',
        sellerId,
        accountStatusReason: accountStatusReason || undefined,
      };
    }

    const trialPaymentComplete =
      trialStatus === 'converted' ||
      (paymentStatus === 'paid' &&
        (trialStatus === 'active' ||
          trialStatus === 'expired' ||
          trialStatus === 'data_deleted'));

    if (!trialPaymentComplete) {
      return {
        allowed: false,
        message:
          'Complete your trial payment of ₹499 + GST to activate your account.',
        errorCode: 'TRIAL_PAYMENT_PENDING',
        sellerId,
      };
    }

    if (
      trialStatus === 'active' ||
      trialStatus === 'expired' ||
      trialStatus === 'converted' ||
      trialStatus === 'data_deleted'
    ) {
      return { allowed: true, sellerId };
    }
  }

  if (blockedOnboardingStatuses.has(onboarding)) {
    return {
      allowed: false,
      message:
        'Account is not ready for login yet. Complete payment and credential setup first.',
      errorCode: 'SELLER_NOT_APPROVED',
      sellerId,
    };
  }

  if (!allowedOnboardingStatuses.has(onboarding)) {
    return {
      allowed: false,
      message:
        'Your account is pending super admin approval. You can log in after credentials are approved.',
      errorCode: 'SELLER_PENDING_APPROVAL',
      sellerId,
    };
  }

  return { allowed: true, sellerId };
}

export function assertSellerLoginAllowed(seller: SellerLoginSnapshot): void {
  const result = evaluateSellerLogin(seller);
  if (!result.allowed) {
    const error = new Error(result.message ?? 'Login not allowed');
    (error as Error & { errorCode?: string; sellerId?: string }).errorCode =
      result.errorCode;
    (error as Error & { errorCode?: string; sellerId?: string }).sellerId =
      result.sellerId;
    throw error;
  }
}
