import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import type { OtpConfigValues } from './otp.config';

const MOBILE_REGEX = /^[6-9][0-9]{9}$/;

export function normalizeIndianMobile(mobile: string): string {
  const digits = String(mobile ?? '').replace(/\D/g, '');
  const normalized =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits;

  if (!MOBILE_REGEX.test(normalized)) {
    throw new Error('Invalid mobile number');
  }
  return normalized;
}

export function isValidIndianMobile(mobile: string): boolean {
  try {
    normalizeIndianMobile(mobile);
    return true;
  } catch {
    return false;
  }
}

export function isValidOtpCode(otp: string, length = 6): boolean {
  return new RegExp(`^\\d{${length}}$`).test(String(otp ?? '').trim());
}

export function generateOtpCode(length = 6): string {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(randomInt(min, max + 1));
}

export async function hashOtpCode(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10);
}

export async function compareOtpCode(
  otp: string,
  hash: string,
): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(otp, hash);
}

export function computeOtpExpiry(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export function computeBlockedUntil(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export function computeResendAvailableAt(
  lastSentAt: Date | undefined,
  intervalSeconds: number,
): Date | null {
  if (!lastSentAt) return null;
  return new Date(lastSentAt.getTime() + intervalSeconds * 1000);
}

export function secondsUntil(date: Date | null | undefined): number {
  if (!date) return 0;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
}

export function buildOtpConfigSnapshot(config: OtpConfigValues) {
  return {
    otpLength: config.otpLength,
    otpExpiryMinutes: config.otpExpiryMinutes,
    maxVerifyAttempts: config.maxVerifyAttempts,
    maxSendAttempts: config.maxSendAttempts,
    sendWindowMinutes: config.sendWindowMinutes,
    blockMinutes: config.blockMinutes,
    resendIntervalSeconds: config.resendIntervalSeconds,
    verificationProofMinutes: config.verificationProofMinutes,
  };
}
