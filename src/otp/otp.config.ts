import { registerAs } from '@nestjs/config';

export const OTP_CONFIG_KEY = 'otp';

export interface OtpConfigValues {
  otpLength: number;
  otpExpiryMinutes: number;
  maxVerifyAttempts: number;
  maxSendAttempts: number;
  sendWindowMinutes: number;
  blockMinutes: number;
  resendIntervalSeconds: number;
  verificationProofMinutes: number;
}

export const defaultOtpConfig = (): OtpConfigValues => ({
  otpLength: Number(process.env.OTP_LENGTH ?? 6),
  otpExpiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES ?? 5),
  maxVerifyAttempts: Number(process.env.OTP_MAX_VERIFY_ATTEMPTS ?? 5),
  maxSendAttempts: Number(process.env.OTP_MAX_SEND_ATTEMPTS ?? 3),
  sendWindowMinutes: Number(process.env.OTP_SEND_WINDOW_MINUTES ?? 15),
  blockMinutes: Number(process.env.OTP_BLOCK_MINUTES ?? 15),
  resendIntervalSeconds: Number(process.env.OTP_RESEND_INTERVAL_SECONDS ?? 30),
  verificationProofMinutes: Number(
    process.env.OTP_VERIFICATION_PROOF_MINUTES ?? 15,
  ),
});

export const otpConfig = registerAs(OTP_CONFIG_KEY, defaultOtpConfig);
