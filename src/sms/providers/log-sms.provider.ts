import { Injectable, Logger } from '@nestjs/common';
import type { SmsProvider, SmsSendResult } from './sms-provider.interface';

@Injectable()
export class LogSmsProvider implements SmsProvider {
  readonly name = 'log';
  private readonly logger = new Logger(LogSmsProvider.name);

  async sendOtp(mobile: string, otp: string): Promise<SmsSendResult> {
    this.logger.log(`SMS OTP dispatched mobile=${mobile}`);
    return { sent: true, provider: this.name };
  }

  async sendSms(mobile: string, message: string): Promise<SmsSendResult> {
    this.logger.log(`SMS notification mobile=${mobile} messageLength=${message.length}`);
    return { sent: true, provider: this.name };
  }
}
