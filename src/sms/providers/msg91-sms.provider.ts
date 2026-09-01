import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SmsProvider, SmsSendResult } from './sms-provider.interface';

@Injectable()
export class Msg91SmsProvider implements SmsProvider {
  readonly name = 'msg91';
  private readonly logger = new Logger(Msg91SmsProvider.name);

  constructor(private readonly config: ConfigService) {}

  private authKey() {
    return (
      this.config.get<string>('MSG91_AUTH_KEY')?.trim() ||
      this.config.get<string>('MSG91_API_KEY')?.trim()
    );
  }

  private flowId() {
    return (
      this.config.get<string>('MSG91_FLOW_ID')?.trim() ||
      this.config.get<string>('MSG91_OTP_TEMPLATE_ID')?.trim()
    );
  }

  private senderId() {
    return this.config.get<string>('MSG91_SENDER_ID')?.trim() || 'ECMRCO';
  }

  async sendOtp(mobile: string, otp: string): Promise<SmsSendResult> {
    const authKey = this.authKey();
    const flowId = this.flowId();
    if (!authKey || !flowId) {
      throw new Error('MSG91 is not configured');
    }

    const response = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: {
        authkey: authKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        template_id: flowId,
        short_url: '0',
        sender: this.senderId(),
        recipients: [
          {
            mobiles: `91${mobile}`,
            var1: otp,
            OTP: otp,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        `MSG91 flow send failed status=${response.status} body=${body}`,
      );
      throw new Error('MSG91 send failed');
    }

    const payload = (await response.json().catch(() => null)) as {
      message?: string;
      type?: string;
    } | null;

    return {
      sent: true,
      provider: this.name,
      messageId: payload?.message,
    };
  }

  async sendSms(mobile: string, message: string): Promise<SmsSendResult> {
    const authKey = this.authKey();
    const flowId = this.flowId();
    if (!authKey || !flowId) {
      throw new Error('MSG91 is not configured');
    }

    const response = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: {
        authkey: authKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        template_id: flowId,
        short_url: '0',
        sender: this.senderId(),
        recipients: [
          {
            mobiles: `91${mobile}`,
            var1: message,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        `MSG91 SMS failed status=${response.status} body=${body}`,
      );
      throw new Error('MSG91 send failed');
    }

    return { sent: true, provider: this.name };
  }
}
