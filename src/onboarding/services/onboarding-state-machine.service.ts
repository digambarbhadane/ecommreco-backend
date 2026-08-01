import { BadRequestException, Injectable } from '@nestjs/common';
import {
  LEAD_ONBOARDING_STATUSES,
  LeadOnboardingStatus,
} from '../constants/onboarding-status';

const TRANSITIONS: Record<LeadOnboardingStatus, LeadOnboardingStatus[]> = {
  NEW: ['REGISTERED', 'LOST'],
  REGISTERED: ['PAYMENT_PENDING', 'LOST'],
  PAYMENT_PENDING: [
    'TRIAL_ACTIVE',
    'PAYMENT_FAILED',
    'PAYMENT_LINK_SENT',
    'LOST',
  ],
  PAYMENT_FAILED: ['PAYMENT_PENDING', 'PAYMENT_LINK_SENT', 'LOST'],
  PAYMENT_LINK_SENT: ['TRIAL_ACTIVE', 'PAYMENT_FAILED', 'LOST'],
  TRIAL_ACTIVE: ['TRIAL_EXPIRED', 'SUBSCRIBED'],
  TRIAL_EXPIRED: ['SUBSCRIBED', 'LOST'],
  SUBSCRIBED: [],
  LOST: ['PAYMENT_PENDING'],
};

@Injectable()
export class OnboardingStateMachineService {
  assertTransition(from: LeadOnboardingStatus, to: LeadOnboardingStatus) {
    if (!LEAD_ONBOARDING_STATUSES.includes(from)) {
      throw new BadRequestException(`Invalid lead status: ${from}`);
    }
    if (!LEAD_ONBOARDING_STATUSES.includes(to)) {
      throw new BadRequestException(`Invalid lead status: ${to}`);
    }
    const allowed = TRANSITIONS[from] ?? [];
    if (!allowed.includes(to) && from !== to) {
      throw new BadRequestException(
        `Cannot transition lead from ${from} to ${to}`,
      );
    }
  }

  canTransition(from: LeadOnboardingStatus, to: LeadOnboardingStatus) {
    if (from === to) return true;
    return (TRANSITIONS[from] ?? []).includes(to);
  }
}
