import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OTP_CONFIG_KEY,
  type OtpConfigValues,
} from './otp.config';
import {
  OTP_LOG_EVENT,
  type OtpLogEvent,
  type OtpPurpose,
} from './otp.constants';
import {
  compareOtpCode,
  computeBlockedUntil,
  computeOtpExpiry,
  computeResendAvailableAt,
  generateOtpCode,
  hashOtpCode,
  isValidOtpCode,
  normalizeIndianMobile,
  secondsUntil,
} from './otp.helper';
import { OtpRepository } from './otp.repository';
import { SmsService } from '../sms/sms.service';
import { Msg91WidgetService } from '../sms/providers/msg91-widget.service';
import type { OtpVerificationDocument } from './schemas/otp-verification.schema';

export type OtpRequestContext = {
  ip?: string;
  userAgent?: string;
};

export type SendOtpResult = {
  success: true;
  message: string;
  expiresIn: number;
  resendAfter: number;
};

export type VerifyOtpResult = {
  success: true;
  verified: true;
  message: string;
};

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly repository: OtpRepository,
    private readonly smsService: SmsService,
    private readonly msg91WidgetService: Msg91WidgetService,
    private readonly configService: ConfigService,
  ) {}

  private getConfig(): OtpConfigValues {
    return this.configService.get<OtpConfigValues>(OTP_CONFIG_KEY, {
      infer: true,
    }) ?? {
      otpLength: 6,
      otpExpiryMinutes: 5,
      maxVerifyAttempts: 5,
      maxSendAttempts: 3,
      sendWindowMinutes: 15,
      blockMinutes: 15,
      resendIntervalSeconds: 30,
      verificationProofMinutes: 15,
    };
  }

  private normalizeMobileOrThrow(mobileInput: string): string {
    try {
      return normalizeIndianMobile(mobileInput);
    } catch {
      throw new BadRequestException('Invalid mobile number.');
    }
  }

  private isNonProduction(): boolean {
    const env =
      this.configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
    return env !== 'production';
  }

  private isCaptchaSkipped(): boolean {
    const explicit = this.configService
      .get<string>('MSG91_SKIP_CAPTCHA')
      ?.trim()
      .toLowerCase();
    if (explicit === '1' || explicit === 'true' || explicit === 'yes') {
      return true;
    }
    if (explicit === '0' || explicit === 'false' || explicit === 'no') {
      return false;
    }
    return this.isNonProduction();
  }

  async getMsg91WidgetConfig() {
    const config = await this.msg91WidgetService.getWidgetConfig();
    if (this.isCaptchaSkipped()) {
      return {
        ...config,
        captchaRequired: false,
        recaptchaSiteKey: null,
      };
    }
    return config;
  }

  private canDeliverLocalSms(): boolean {
    if (this.isNonProduction()) {
      return true;
    }
    const authKey = this.msg91WidgetService.getAuthKey();
    const flowId =
      this.configService.get<string>('MSG91_FLOW_ID')?.trim() ||
      this.configService.get<string>('MSG91_OTP_TEMPLATE_ID')?.trim();
    return Boolean(authKey && flowId);
  }

  private async sendOtpViaMsg91Widget(
    record: OtpVerificationDocument,
    mobile: string,
    otp: string,
    otpHash: string,
    captchaToken?: string,
  ): Promise<void> {
    const skipCaptcha = this.isCaptchaSkipped();
    const widgetConfig = skipCaptcha
      ? { captchaRequired: false }
      : await this.msg91WidgetService.getWidgetConfig();

    if (
      widgetConfig.captchaRequired &&
      !captchaToken?.trim() &&
      !this.canDeliverLocalSms()
    ) {
      throw new BadRequestException(
        'Captcha verification is required before sending OTP.',
      );
    }

    const fallbackToLocalOtp = async (reason: string) => {
      if (!this.canDeliverLocalSms()) {
        this.logger.error(
          `${reason}; MSG91 widget failed and SMS fallback is not configured mobile=${mobile}`,
        );
        throw new BadRequestException(
          'Unable to send OTP via MSG91. Ensure captcha is enabled or configure MSG91 SMS credentials.',
        );
      }
      this.logger.warn(`${reason}; using local OTP fallback mobile=${mobile}`);
      await this.repository.setLocalOtpHash(record, otpHash);
      await this.deliverLocalOtp(mobile, otp);
    };

    if (skipCaptcha) {
      await fallbackToLocalOtp('MSG91 captcha skipped for this environment');
      return;
    }

    if (widgetConfig.captchaRequired && !captchaToken?.trim()) {
      await fallbackToLocalOtp('MSG91 captcha token was not provided');
      return;
    }

    try {
      const widgetSend = await this.msg91WidgetService.sendOtp(
        mobile,
        captchaToken,
      );
      if (!widgetSend.reqId) {
        await fallbackToLocalOtp('MSG91 did not return an OTP session id');
        return;
      }
      await this.repository.setMsg91Session(record, widgetSend.reqId);
      this.logger.log(
        `MSG91 widget OTP session created mobile=${mobile} reqId=${widgetSend.reqId}`,
      );
    } catch (error: unknown) {
      if (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
      ) {
        throw error;
      }
      const reason =
        error instanceof BadRequestException
          ? this.extractExceptionMessage(error)
          : error instanceof Error
            ? error.message
            : 'MSG91 widget send failed';

      if (
        this.msg91WidgetService.isCaptchaError(reason) &&
        !this.canDeliverLocalSms()
      ) {
        throw new BadRequestException(
          'MSG91 captcha verification failed. Refresh the page and try again.',
        );
      }

      await fallbackToLocalOtp(reason);
    }
  }

  private async deliverLocalOtp(mobile: string, otp: string): Promise<void> {
    if (this.isNonProduction()) {
      this.logger.log(`DEV OTP for ${mobile}: ${otp}`);
    }
    try {
      await this.smsService.sendOtp(mobile, otp);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'SMS delivery failed';
      this.logger.warn(
        `SMS OTP delivery failed mobile=${mobile}: ${message}`,
      );
    }
  }

  private extractExceptionMessage(error: BadRequestException): string {
    const response = error.getResponse();
    if (typeof response === 'string') {
      return response;
    }
    if (response && typeof response === 'object') {
      const record = response as Record<string, unknown>;
      if (typeof record.message === 'string') {
        return record.message;
      }
      if (record.message && typeof record.message === 'object') {
        const nested = record.message as Record<string, unknown>;
        if (typeof nested.message === 'string') {
          return nested.message;
        }
      }
    }
    return error.message;
  }

  async sendOtp(
    mobileInput: string,
    purpose: OtpPurpose,
    context: OtpRequestContext = {},
    captchaToken?: string,
  ): Promise<SendOtpResult> {
    const config = this.getConfig();
    const mobile = this.normalizeMobileOrThrow(mobileInput);
    this.logEvent(OTP_LOG_EVENT.REQUESTED, mobile, purpose, context);

    const blocked = await this.assertNotBlocked(mobile, purpose, config);
    if (blocked) {
      this.logEvent(OTP_LOG_EVENT.BLOCKED, mobile, purpose, context);
      throw new HttpException(
        'Too many OTP requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let record = await this.repository.findByMobileAndPurpose(mobile, purpose);

    if (record?.lastSentAt) {
      const resendAt = computeResendAvailableAt(
        record.lastSentAt,
        config.resendIntervalSeconds,
      );
      const waitSeconds = secondsUntil(resendAt);
      if (waitSeconds > 0) {
        throw new HttpException(
          `Please wait ${waitSeconds} seconds before requesting another OTP.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const windowStart = Date.now() - config.sendWindowMinutes * 60 * 1000;
    const sendsInWindow =
      record &&
      record.lastSentAt &&
      record.lastSentAt.getTime() >= windowStart
        ? record.requestCount
        : 0;

    if (sendsInWindow >= config.maxSendAttempts) {
      if (record) {
        record.blockedUntil = computeBlockedUntil(config.blockMinutes);
        await this.repository.save(record);
      }
      this.logEvent(OTP_LOG_EVENT.BLOCKED, mobile, purpose, context);
      throw new HttpException(
        'Too many OTP requests. Please try again after 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otp = generateOtpCode(config.otpLength);
    const otpHash = await hashOtpCode(otp);
    const expiresAt = computeOtpExpiry(config.otpExpiryMinutes);
    const now = new Date();
    const useMsg91Widget = this.msg91WidgetService.isWidgetConfigured();

    if (!record) {
      record = await this.repository.create({
        mobile,
        purpose,
        attempts: 0,
        verified: false,
        expiresAt,
        requestedIp: context.ip,
        requestedUserAgent: context.userAgent,
        requestCount: 1,
        lastSentAt: now,
        ...(useMsg91Widget ? {} : { otpHash }),
      });
    } else {
      record.attempts = 0;
      record.verified = false;
      record.expiresAt = expiresAt;
      record.verifiedAt = undefined;
      record.verificationProofExpiresAt = undefined;
      record.requestCount =
        record.lastSentAt && record.lastSentAt.getTime() >= windowStart
          ? (record.requestCount ?? 0) + 1
          : 1;
      record.lastSentAt = now;
      record.requestedIp = context.ip ?? record.requestedIp;
      record.requestedUserAgent =
        context.userAgent ?? record.requestedUserAgent;
      if (!useMsg91Widget) {
        record.otpHash = otpHash;
        record.msg91ReqId = undefined;
      }
      await this.repository.save(record);
    }

    try {
      if (useMsg91Widget) {
        await this.sendOtpViaMsg91Widget(
          record,
          mobile,
          otp,
          otpHash,
          captchaToken,
        );
      } else {
        await this.smsService.sendOtp(mobile, otp);
      }
      this.logEvent(OTP_LOG_EVENT.SENT, mobile, purpose, context);
    } catch (error: unknown) {
      this.logEvent(OTP_LOG_EVENT.FAILED, mobile, purpose, context, error);
      if (error instanceof BadRequestException || error instanceof HttpException) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'MSG91 service unavailable. Please try again shortly.',
      );
    }

    return {
      success: true,
      message: 'OTP sent successfully to your mobile number.',
      expiresIn: config.otpExpiryMinutes * 60,
      resendAfter: config.resendIntervalSeconds,
    };
  }

  async resendOtp(
    mobileInput: string,
    purpose: OtpPurpose,
    context: OtpRequestContext = {},
    captchaToken?: string,
  ): Promise<SendOtpResult> {
    const config = this.getConfig();
    const mobile = this.normalizeMobileOrThrow(mobileInput);
    this.logEvent(OTP_LOG_EVENT.RESENT, mobile, purpose, context);

    if (this.msg91WidgetService.isWidgetConfigured()) {
      const record = await this.repository.findByMobileAndPurpose(mobile, purpose);
      if (record?.msg91ReqId) {
        const blocked = await this.assertNotBlocked(mobile, purpose, config);
        if (blocked) {
          throw new HttpException(
            'Too many OTP requests. Please try again later.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        if (record.lastSentAt) {
          const resendAt = computeResendAvailableAt(
            record.lastSentAt,
            config.resendIntervalSeconds,
          );
          const waitSeconds = secondsUntil(resendAt);
          if (waitSeconds > 0) {
            throw new HttpException(
              `Please wait ${waitSeconds} seconds before requesting another OTP.`,
              HttpStatus.TOO_MANY_REQUESTS,
            );
          }
        }

        try {
          const widgetRetry = await this.msg91WidgetService.retryOtp(
            record.msg91ReqId,
          );
          record.msg91ReqId = widgetRetry.reqId ?? record.msg91ReqId;
          record.lastSentAt = new Date();
          record.attempts = 0;
          record.verified = false;
          await this.repository.save(record);
          this.logEvent(OTP_LOG_EVENT.SENT, mobile, purpose, context);
        } catch (error: unknown) {
          this.logEvent(OTP_LOG_EVENT.FAILED, mobile, purpose, context, error);
          if (error instanceof BadRequestException || error instanceof HttpException) {
            throw error;
          }
          throw new ServiceUnavailableException(
            'MSG91 service unavailable. Please try again shortly.',
          );
        }

        return {
          success: true,
          message: 'OTP resent successfully to your mobile number.',
          expiresIn: config.otpExpiryMinutes * 60,
          resendAfter: config.resendIntervalSeconds,
        };
      }
    }

    return this.sendOtp(mobileInput, purpose, context, captchaToken);
  }

  async verifyOtp(
    mobileInput: string,
    otpInput: string,
    purpose: OtpPurpose,
    context: OtpRequestContext = {},
  ): Promise<VerifyOtpResult> {
    const config = this.getConfig();
    const mobile = this.normalizeMobileOrThrow(mobileInput);
    const otp = String(otpInput ?? '').trim();

    if (!isValidOtpCode(otp, config.otpLength)) {
      throw new BadRequestException('Enter a valid 6-digit OTP.');
    }

    const record = await this.repository.findByMobileAndPurpose(mobile, purpose);
    if (!record) {
      throw new BadRequestException('Request an OTP first.');
    }

    if (record.msg91ReqId) {
      return this.verifyWidgetOtp(
        mobile,
        purpose,
        record.msg91ReqId,
        otp,
        context,
      );
    }

    if (!record.otpHash) {
      throw new BadRequestException('Request an OTP first.');
    }

    if (record.verified) {
      return {
        success: true,
        verified: true,
        message: 'Mobile number already verified.',
      };
    }

    if (record.blockedUntil && record.blockedUntil.getTime() > Date.now()) {
      this.logEvent(OTP_LOG_EVENT.BLOCKED, mobile, purpose, context);
      throw new HttpException(
        'Too many attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!record.expiresAt || record.expiresAt.getTime() < Date.now()) {
      this.logEvent(OTP_LOG_EVENT.EXPIRED, mobile, purpose, context);
      throw new BadRequestException('OTP expired. Request a new one.');
    }

    if ((record.attempts ?? 0) >= config.maxVerifyAttempts) {
      record.blockedUntil = computeBlockedUntil(config.blockMinutes);
      await this.repository.save(record);
      this.logEvent(OTP_LOG_EVENT.MAX_ATTEMPTS, mobile, purpose, context);
      throw new HttpException(
        'Maximum verification attempts reached. Request a new OTP.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const valid = await compareOtpCode(otp, record.otpHash);
    if (!valid) {
      record.attempts = (record.attempts ?? 0) + 1;
      await this.repository.save(record);
      this.logEvent(OTP_LOG_EVENT.INVALID, mobile, purpose, context);
      throw new BadRequestException('Incorrect OTP. Please try again.');
    }

    const verifiedAt = new Date();
    record.verified = true;
    record.verifiedAt = verifiedAt;
    record.otpHash = undefined;
    record.expiresAt = undefined;
    record.verificationProofExpiresAt = computeOtpExpiry(
      config.verificationProofMinutes,
    );
    record.attempts = 0;
    record.blockedUntil = undefined;
    await this.repository.save(record);

    this.logEvent(OTP_LOG_EVENT.VERIFIED, mobile, purpose, context);

    return {
      success: true,
      verified: true,
      message: 'Mobile number verified successfully.',
    };
  }

  async verifyWidgetOtp(
    mobileInput: string,
    purpose: OtpPurpose,
    reqId: string,
    otpInput: string,
    context: OtpRequestContext = {},
  ): Promise<VerifyOtpResult> {
    const config = this.getConfig();
    const mobile = this.normalizeMobileOrThrow(mobileInput);

    const widgetResult = await this.msg91WidgetService.verifyWidgetOtp(
      reqId,
      otpInput,
    );

    if (widgetResult.mobile && widgetResult.mobile !== mobile) {
      this.logEvent(OTP_LOG_EVENT.INVALID, mobile, purpose, context);
      throw new BadRequestException(
        'Mobile number does not match the verified OTP.',
      );
    }

    const verifiedAt = new Date();
    const verificationProofExpiresAt = computeOtpExpiry(
      config.verificationProofMinutes,
    );

    const record = await this.repository.upsertWidgetVerified(mobile, purpose, {
      verifiedAt,
      verificationProofExpiresAt,
      requestedIp: context.ip,
      requestedUserAgent: context.userAgent,
    });

    if (!record) {
      throw new ServiceUnavailableException(
        'Unable to store OTP verification. Please try again.',
      );
    }

    this.logEvent(OTP_LOG_EVENT.VERIFIED, mobile, purpose, context);

    return {
      success: true,
      verified: true,
      message: 'Mobile number verified successfully.',
    };
  }

  async verifyWidgetAccessToken(
    mobileInput: string,
    purpose: OtpPurpose,
    accessToken: string,
    context: OtpRequestContext = {},
  ): Promise<VerifyOtpResult> {
    const config = this.getConfig();
    const mobile = this.normalizeMobileOrThrow(mobileInput);

    const widgetResult = await this.msg91WidgetService.verifyAccessToken(
      accessToken,
    );

    if (widgetResult.mobile && widgetResult.mobile !== mobile) {
      this.logEvent(OTP_LOG_EVENT.INVALID, mobile, purpose, context);
      throw new BadRequestException(
        'Mobile number does not match the verified OTP.',
      );
    }

    let record = await this.repository.findByMobileAndPurpose(mobile, purpose);
    const verifiedAt = new Date();
    const verificationProofExpiresAt = computeOtpExpiry(
      config.verificationProofMinutes,
    );

    record = await this.repository.upsertWidgetVerified(mobile, purpose, {
      verifiedAt,
      verificationProofExpiresAt,
      requestedIp: context.ip,
      requestedUserAgent: context.userAgent,
    });

    if (!record) {
      throw new ServiceUnavailableException(
        'Unable to store OTP verification. Please try again.',
      );
    }

    this.logEvent(OTP_LOG_EVENT.VERIFIED, mobile, purpose, context);

    return {
      success: true,
      verified: true,
      message: 'Mobile number verified successfully.',
    };
  }

  async isMobileVerified(mobileInput: string, purpose: OtpPurpose): Promise<boolean> {
    const mobile = this.normalizeMobileOrThrow(mobileInput);
    const record = await this.repository.findByMobileAndPurpose(mobile, purpose);
    return this.isRecordVerified(record);
  }

  async assertMobileVerified(mobileInput: string, purpose: OtpPurpose): Promise<void> {
    const mobile = this.normalizeMobileOrThrow(mobileInput);
    const record = await this.repository.findByMobileAndPurpose(mobile, purpose);

    if (!this.isRecordVerified(record)) {
      throw new BadRequestException('Mobile number not verified.');
    }
  }

  async consumeVerification(mobileInput: string, purpose: OtpPurpose): Promise<void> {
    const mobile = this.normalizeMobileOrThrow(mobileInput);
    await this.repository.deleteVerifiedProof(mobile, purpose);
  }

  async getStatus(mobileInput: string, purpose: OtpPurpose) {
    const config = this.getConfig();
    const mobile = this.normalizeMobileOrThrow(mobileInput);
    const record = await this.repository.findByMobileAndPurpose(mobile, purpose);
    const resendAt = computeResendAvailableAt(
      record?.lastSentAt,
      config.resendIntervalSeconds,
    );

    return {
      mobile,
      purpose,
      verified: this.isRecordVerified(record),
      blockedUntil: record?.blockedUntil ?? null,
      resendAfter: secondsUntil(resendAt),
      expiresIn:
        record?.expiresAt && !record.verified
          ? secondsUntil(record.expiresAt)
          : 0,
      attemptsRemaining: record
        ? Math.max(0, config.maxVerifyAttempts - (record.attempts ?? 0))
        : config.maxVerifyAttempts,
    };
  }

  private isRecordVerified(record: OtpVerificationDocument | null): boolean {
    if (!record?.verified || !record.verifiedAt) {
      return false;
    }
    if (
      record.verificationProofExpiresAt &&
      record.verificationProofExpiresAt.getTime() < Date.now()
    ) {
      return false;
    }
    return true;
  }

  private async assertNotBlocked(
    mobile: string,
    purpose: OtpPurpose,
    config: OtpConfigValues,
  ): Promise<boolean> {
    const record = await this.repository.findByMobileAndPurpose(mobile, purpose);
    if (!record?.blockedUntil) {
      return false;
    }
    if (record.blockedUntil.getTime() <= Date.now()) {
      record.blockedUntil = undefined;
      await this.repository.save(record);
      return false;
    }
    return true;
  }

  private logEvent(
    event: OtpLogEvent,
    mobile: string,
    purpose: OtpPurpose,
    context: OtpRequestContext,
    error?: unknown,
  ) {
    const payload = {
      event,
      mobile,
      purpose,
      ip: context.ip,
      userAgent: context.userAgent,
      error:
        error instanceof Error
          ? error.message
          : error
            ? String(error)
            : undefined,
    };
    if (
      event === OTP_LOG_EVENT.FAILED ||
      event === OTP_LOG_EVENT.BLOCKED ||
      event === OTP_LOG_EVENT.INVALID
    ) {
      this.logger.warn(JSON.stringify(payload));
    } else {
      this.logger.log(JSON.stringify(payload));
    }
  }
}
