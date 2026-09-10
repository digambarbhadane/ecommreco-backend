import {
  generateOtpCode,
  hashOtpCode,
  compareOtpCode,
  isValidIndianMobile,
  isValidOtpCode,
  normalizeIndianMobile,
  computeOtpExpiry,
} from '../../../src/otp/otp.helper';

describe('otp.helper', () => {
  it('generates numeric OTP of requested length', () => {
    const otp = generateOtpCode(6);
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('validates Indian mobile numbers', () => {
    expect(isValidIndianMobile('9876543210')).toBe(true);
    expect(isValidIndianMobile('5876543210')).toBe(false);
    expect(isValidIndianMobile('987654321')).toBe(false);
  });

  it('normalizes mobile with country prefix', () => {
    expect(normalizeIndianMobile('919876543210')).toBe('9876543210');
  });

  it('hashes and compares OTP securely', async () => {
    const otp = '483921';
    const hash = await hashOtpCode(otp);
    expect(hash).not.toContain(otp);
    expect(await compareOtpCode(otp, hash)).toBe(true);
    expect(await compareOtpCode('000000', hash)).toBe(false);
  });

  it('validates OTP format', () => {
    expect(isValidOtpCode('123456')).toBe(true);
    expect(isValidOtpCode('12345')).toBe(false);
    expect(isValidOtpCode('12a456')).toBe(false);
  });

  it('computes expiry in the future', () => {
    const expiry = computeOtpExpiry(5);
    expect(expiry.getTime()).toBeGreaterThan(Date.now());
  });
});
