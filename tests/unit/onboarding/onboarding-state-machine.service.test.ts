import { OnboardingStateMachineService } from '../../../src/onboarding/services/onboarding-state-machine.service';

describe('OnboardingStateMachineService', () => {
  let service: OnboardingStateMachineService;

  beforeEach(() => {
    service = new OnboardingStateMachineService();
  });

  it('allows valid transitions from REGISTERED', () => {
    expect(service.canTransition('REGISTERED', 'PAYMENT_PENDING')).toBe(true);
    expect(service.canTransition('REGISTERED', 'LOST')).toBe(true);
    expect(service.canTransition('REGISTERED', 'TRIAL_ACTIVE')).toBe(false);
  });

  it('allows payment recovery paths', () => {
    expect(service.canTransition('PAYMENT_FAILED', 'PAYMENT_PENDING')).toBe(true);
    expect(service.canTransition('PAYMENT_FAILED', 'PAYMENT_LINK_SENT')).toBe(true);
    expect(service.canTransition('PAYMENT_LINK_SENT', 'TRIAL_ACTIVE')).toBe(true);
  });

  it('assertTransition throws on invalid transition', () => {
    expect(() => service.assertTransition('REGISTERED', 'TRIAL_ACTIVE')).toThrow(
      'Cannot transition lead from REGISTERED to TRIAL_ACTIVE',
    );
  });

  it('assertTransition allows same-status no-op', () => {
    expect(() => service.assertTransition('PAYMENT_PENDING', 'PAYMENT_PENDING')).not.toThrow();
  });

  it('blocks transitions from terminal SUBSCRIBED state', () => {
    expect(service.canTransition('SUBSCRIBED', 'TRIAL_ACTIVE')).toBe(false);
    expect(service.canTransition('SUBSCRIBED', 'LOST')).toBe(false);
  });

  it('allows re-engagement from LOST to PAYMENT_PENDING', () => {
    expect(service.canTransition('LOST', 'PAYMENT_PENDING')).toBe(true);
  });
});
