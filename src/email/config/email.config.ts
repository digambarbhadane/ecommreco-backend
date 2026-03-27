import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailType } from '../email.types';

@Injectable()
export class EmailConfigService {
  constructor(private readonly config: ConfigService) {}

  get postmarkApiKey() {
    const key = this.config.get<string>('POSTMARK_API_KEY');
    if (!key) throw new Error('POSTMARK_API_KEY is not set');
    return key;
  }

  get defaultFrom() {
    return (
      this.config.get<string>('EMAIL_FROM_DEFAULT') ?? 'no-reply@ecommreco.com'
    );
  }

  get senderAuth() {
    return this.config.get<string>('EMAIL_AUTH') ?? 'auth@ecommreco.com';
  }

  get senderBilling() {
    return this.config.get<string>('EMAIL_BILLING') ?? 'billing@ecommreco.com';
  }

  get senderNotification() {
    return (
      this.config.get<string>('EMAIL_NOTIFICATION') ??
      'notifications@ecommreco.com'
    );
  }

  get useQueue() {
    return false;
  }

  get redisUrl() {
    return undefined;
  }

  get smtpHost() {
    return this.config.get<string>('SMTP_HOST');
  }

  get smtpPort() {
    const v = this.config.get<string>('SMTP_PORT');
    return v ? Number(v) : undefined;
  }

  get smtpUser() {
    return this.config.get<string>('SMTP_USER');
  }

  get smtpPass() {
    return this.config.get<string>('SMTP_PASS');
  }

  get useSmtpFallback() {
    const flag = this.config.get<string>('EMAIL_SMTP_FALLBACK');
    if (flag === 'true') return true;
    const env = this.config.get<string>('NODE_ENV');
    return env === 'development';
  }

  chooseSender(type: EmailType): string {
    switch (type) {
      case EmailType.OTP:
      case EmailType.PASSWORD_RESET:
        return this.senderAuth;
      case EmailType.INVOICE:
      case EmailType.SUBSCRIPTION:
        return this.senderBilling;
      case EmailType.NOTIFICATION:
        return this.senderNotification;
      default:
        return this.defaultFrom;
    }
  }

  templateFor(type: EmailType): string {
    switch (type) {
      case EmailType.OTP:
        return 'otp.hbs';
      case EmailType.PASSWORD_RESET:
        return 'password-reset.hbs';
      case EmailType.INVOICE:
        return 'invoice.hbs';
      case EmailType.SUBSCRIPTION:
        return 'subscription.hbs';
      case EmailType.NOTIFICATION:
        return 'notification.hbs';
      default:
        return 'notification.hbs';
    }
  }
}
