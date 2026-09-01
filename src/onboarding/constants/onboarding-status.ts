export const LEAD_ONBOARDING_STATUSES = [
  'NEW',
  'REGISTERED',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'PAYMENT_LINK_SENT',
  'TRIAL_ACTIVE',
  'TRIAL_EXPIRED',
  'SUBSCRIBED',
  'LOST',
] as const;

export type LeadOnboardingStatus = (typeof LEAD_ONBOARDING_STATUSES)[number];

export const USER_ONBOARDING_STATUSES = [
  'PENDING_PAYMENT',
  'ACTIVE',
  'BLOCKED',
  'INACTIVE',
] as const;

export type UserOnboardingStatus = (typeof USER_ONBOARDING_STATUSES)[number];

export const ONBOARDING_PAYMENT_STATUSES = [
  'CREATED',
  'INITIATED',
  'PENDING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type OnboardingPaymentStatus =
  (typeof ONBOARDING_PAYMENT_STATUSES)[number];

export const ONBOARDING_TIMELINE_EVENTS = {
  REGISTRATION_COMPLETED: 'REGISTRATION_COMPLETED',
  PAYMENT_STARTED: 'PAYMENT_STARTED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
  PAYMENT_LINK_SENT: 'PAYMENT_LINK_SENT',
  TRIAL_ACTIVATED: 'TRIAL_ACTIVATED',
  CONTACT_SALES: 'CONTACT_SALES',
  STATUS_CHANGED: 'STATUS_CHANGED',
  FOLLOW_UP_SCHEDULED: 'FOLLOW_UP_SCHEDULED',
  PAYMENT_REMINDER_SENT: 'PAYMENT_REMINDER_SENT',
} as const;

export const ONBOARDING_CHECKOUT_TYPE = 'onboarding_trial';

export function isOnboardingV2Enabled(env?: string): boolean {
  return (
    String(env ?? process.env.ONBOARDING_V2_ENABLED ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}
