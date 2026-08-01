import { evaluateSellerLogin } from '../../../src/trial/trial-login.policy';

describe('evaluateSellerLogin', () => {
  const baseSeller = {
    password: 'hashed',
    isTrial: true,
    trialStatus: 'pending_payment',
    paymentStatus: 'pending',
    onboardingStatus: 'payment_pending',
    id: 'seller-1',
  };

  it('blocks trial sellers with pending payment', () => {
    const result = evaluateSellerLogin(baseSeller);
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe('TRIAL_PAYMENT_PENDING');
  });

  it('allows trial sellers after payment is verified', () => {
    const result = evaluateSellerLogin({
      ...baseSeller,
      trialStatus: 'active',
      paymentStatus: 'paid',
      onboardingStatus: 'active',
    });
    expect(result.allowed).toBe(true);
  });

  it('allows expired trial sellers to login for upgrade', () => {
    const result = evaluateSellerLogin({
      ...baseSeller,
      trialStatus: 'expired',
      paymentStatus: 'paid',
      onboardingStatus: 'active',
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks unpaid trial sellers during JWT session checks without password', () => {
    const result = evaluateSellerLogin(
      {
        ...baseSeller,
        password: undefined,
      },
      { requirePassword: false },
    );
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe('TRIAL_PAYMENT_PENDING');
  });

  it('returns suspension reason when account is suspended', () => {
    const result = evaluateSellerLogin({
      ...baseSeller,
      accountStatus: 'suspended',
      accountStatusReason: 'Outstanding payment dispute',
      trialStatus: 'active',
      paymentStatus: 'paid',
      onboardingStatus: 'active',
    });
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe('ACCOUNT_SUSPENDED');
    expect(result.accountStatusReason).toBe('Outstanding payment dispute');
  });

  it('blocks sellers with paused account status', () => {
    const result = evaluateSellerLogin({
      password: 'hashed',
      accountStatus: 'paused',
      onboardingStatus: 'active',
      id: 'seller-2',
    });
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe('ACCOUNT_PAUSED');
  });

  it('allows sellers after account is reactivated', () => {
    const result = evaluateSellerLogin({
      password: 'hashed',
      accountStatus: 'active',
      onboardingStatus: 'active',
      id: 'seller-3',
    });
    expect(result.allowed).toBe(true);
  });
});
