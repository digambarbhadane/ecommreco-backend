import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailType } from '../email.types';

@Injectable()
export class EmailConfigService {
  constructor(private readonly config: ConfigService) {}

  get postmarkApiKey() {
    const key = this.config.get<string>('POSTMARK_API_KEY')?.trim();
    if (!key) {
      throw new Error(
        'POSTMARK_API_KEY is required only when EMAIL_PROVIDER=postmark',
      );
    }
    return key;
  }

  get defaultFrom() {
    return (
      this.config.get<string>('EMAIL_FROM_DEFAULT') ?? 'no-reply@ecommreco.com'
    );
  }

  get defaultFromName() {
    return this.config.get<string>('EMAIL_FROM_NAME')?.trim() || 'EcommReco';
  }

  formatFromAddress(email: string) {
    const normalized = email.trim();
    if (normalized.includes('<')) return normalized;
    return `${this.defaultFromName} <${normalized}>`;
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

  get smtpSecure() {
    return this.config.get<string>('SMTP_SECURE') === 'true';
  }

  get emailProvider() {
    return (
      this.config.get<string>('EMAIL_PROVIDER')?.trim().toLowerCase() || 'smtp'
    );
  }

  get hasSmtpCredentials() {
    return Boolean(this.smtpHost && this.smtpUser && this.smtpPass);
  }

  get useSmtpFallback() {
    const flag = this.config.get<string>('EMAIL_SMTP_FALLBACK');
    if (flag === 'true') return true;
    const env = this.config.get<string>('NODE_ENV');
    return env === 'development';
  }

  get frontendUrl() {
    return (
      this.config.get<string>('FRONTEND_URL')?.trim() || 'https://ecommreco.com'
    );
  }

  get supportEmail() {
    return (
      this.config.get<string>('EMAIL_SUPPORT')?.trim() || 'info@ecommreco.com'
    );
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
      case EmailType.REGISTRATION_WELCOME:
        return this.defaultFrom;
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
      case EmailType.REGISTRATION_WELCOME:
        return 'welcome-registration.hbs';
      default:
        return 'notification.hbs';
    }
  }
}
