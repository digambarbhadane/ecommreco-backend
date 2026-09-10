import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogSmsProvider } from './providers/log-sms.provider';
import { Msg91SmsProvider } from './providers/msg91-sms.provider';
import type { SmsSendResult } from './providers/sms-provider.interface';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly logProvider: LogSmsProvider,
    private readonly msg91Provider: Msg91SmsProvider,
  ) {}

  private resolveProviderName(): string {
    return String(this.config.get<string>('SMS_PROVIDER') ?? 'log')
      .trim()
      .toLowerCase();
  }

  private getProvider() {
    const name = this.resolveProviderName();
    if (name === 'msg91') {
      return this.msg91Provider;
    }
    return this.logProvider;
  }

  async sendOtp(mobile: string, otp: string): Promise<SmsSendResult> {
    const primary = this.getProvider();
    try {
      const result = await primary.sendOtp(mobile, otp);
      this.logger.log(
        `OTP SMS sent provider=${result.provider} mobile=${mobile}`,
      );
      return result;
    } catch (error: unknown) {
      if (primary.name === 'msg91') {
        this.logger.warn(
          `MSG91 OTP send failed; falling back to log provider mobile=${mobile}`,
        );
        return this.logProvider.sendOtp(mobile, otp);
      }
      const message =
        error instanceof Error ? error.message : 'SMS provider error';
      throw new ServiceUnavailableException(message);
    }
  }

  async verifyOtp(): Promise<{ verified: boolean }> {
    return { verified: false };
  }

  async resendOtp(mobile: string, otp: string): Promise<SmsSendResult> {
    return this.sendOtp(mobile, otp);
  }

  async sendSms(mobile: string, message: string): Promise<SmsSendResult> {
    const primary = this.getProvider();
    try {
      return await primary.sendSms(mobile, message);
    } catch (error: unknown) {
      if (primary.name === 'msg91') {
        return this.logProvider.sendSms(mobile, message);
      }
      const messageText =
        error instanceof Error ? error.message : 'SMS provider error';
      throw new ServiceUnavailableException(messageText);
    }
  }
}
