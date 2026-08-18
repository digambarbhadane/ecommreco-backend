import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type Msg91WidgetVerifyResult = {
  mobile: string | null;
  raw: Record<string, unknown>;
};

export type Msg91WidgetSendResult = {
  reqId: string | null;
  raw: Record<string, unknown>;
};

export type Msg91WidgetConfig = {
  configured: boolean;
  captchaRequired: boolean;
  captchaType: number | null;
  recaptchaSiteKey: string | null;
};

/** MSG91 default reCAPTCHA Enterprise site key when widgetMeta has no captcha_site_key */
export const MSG91_DEFAULT_RECAPTCHA_SITE_KEY =
  '6LemcdopAAAAACUyxk9h_mI_O-9fNxsWdrmA_N62';

@Injectable()
export class Msg91WidgetService {
  private readonly logger = new Logger(Msg91WidgetService.name);
  private readonly widgetApiBase = 'https://control.msg91.com/api/v5/widget';

  constructor(private readonly config: ConfigService) {}

  getAuthKey(): string | undefined {
    return (
      this.config.get<string>('MSG91_AUTH_KEY')?.trim() ||
      this.config.get<string>('MSG91_API_KEY')?.trim() ||
      undefined
    );
  }

  getWidgetCredentials(): { widgetId: string; tokenAuth: string } | null {
    const widgetId =
      this.config.get<string>('MSG91_WIDGET_ID')?.trim() ||
      this.config.get<string>('VITE_MSG91_WIDGET_ID')?.trim();
    const tokenAuth =
      this.config.get<string>('MSG91_TOKEN_AUTH')?.trim() ||
      this.config.get<string>('MSG91_WIDGET_TOKEN')?.trim() ||
      this.config.get<string>('VITE_MSG91_TOKEN_AUTH')?.trim();

    if (!widgetId || !tokenAuth) {
      return null;
    }
    return { widgetId, tokenAuth };
  }

  isWidgetConfigured(): boolean {
    return !!this.getWidgetCredentials();
  }

  isAccessTokenConfigured(): boolean {
    return !!this.getAuthKey();
  }

  getDefaultRecaptchaSiteKey(): string {
    return (
      this.config.get<string>('MSG91_RECAPTCHA_SITE_KEY')?.trim() ||
      MSG91_DEFAULT_RECAPTCHA_SITE_KEY
    );
  }

  isCaptchaError(message?: string): boolean {
    return message?.toLowerCase().includes('captcha') ?? false;
  }

  async getWidgetProcessRaw(): Promise<Record<string, unknown>> {
    const credentials = this.getWidgetCredentials();
    if (!credentials) {
      throw new ServiceUnavailableException('MSG91 widget is not configured.');
    }

    const params = new URLSearchParams({
      widgetId: credentials.widgetId,
      tokenAuth: credentials.tokenAuth,
    });

    let response: Response;
    try {
      response = await fetch(
        `${this.widgetApiBase}/getWidgetProcess?${params.toString()}`,
        { method: 'GET' },
      );
    } catch (error: unknown) {
      this.logger.error(
        `MSG91 getWidgetProcess network error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(
        'MSG91 service unavailable. Please try again shortly.',
      );
    }

    const body = await response.text();
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      this.logger.error(
        `MSG91 getWidgetProcess invalid JSON status=${response.status} body=${body.slice(0, 200)}`,
      );
      throw new ServiceUnavailableException(
        'MSG91 service unavailable. Please try again shortly.',
      );
    }
  }

  async getWidgetConfig(): Promise<Msg91WidgetConfig> {
    const credentials = this.getWidgetCredentials();
    if (!credentials) {
      return {
        configured: false,
        captchaRequired: false,
        captchaType: null,
        recaptchaSiteKey: null,
      };
    }

    try {
      const raw = await this.getWidgetProcessRaw();
      const data = (raw.data ?? raw) as Record<string, unknown>;
      const captchaValidations = data.captchaValidations === 1;
      const widgetMeta = data.widgetMeta as Record<string, unknown> | undefined;
      const captchaType =
        typeof widgetMeta?.captcha_type === 'number'
          ? widgetMeta.captcha_type
          : null;
      const metaSiteKey =
        typeof widgetMeta?.captcha_site_key === 'string'
          ? widgetMeta.captcha_site_key.trim()
          : '';

      return {
        configured: true,
        captchaRequired: captchaValidations,
        captchaType,
        recaptchaSiteKey: captchaValidations
          ? metaSiteKey || this.getDefaultRecaptchaSiteKey()
          : null,
      };
    } catch (error: unknown) {
      this.logger.warn(
        `MSG91 getWidgetConfig failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        configured: true,
        captchaRequired: false,
        captchaType: null,
        recaptchaSiteKey: null,
      };
    }
  }

  async sendOtp(
    identifier: string,
    captchaToken?: string,
  ): Promise<Msg91WidgetSendResult> {
    const credentials = this.getWidgetCredentials();
    if (!credentials) {
      throw new ServiceUnavailableException(
        'MSG91 widget is not configured on the server (MSG91_WIDGET_ID + MSG91_TOKEN_AUTH).',
      );
    }

    const digits = identifier.replace(/\D/g, '');
    const normalizedIdentifier =
      digits.length === 10 ? `91${digits}` : digits.startsWith('91') ? digits : `91${digits}`;

    const payload: Record<string, string> = {
      widgetId: credentials.widgetId,
      tokenAuth: credentials.tokenAuth,
      identifier: normalizedIdentifier,
    };
    if (captchaToken?.trim()) {
      payload.captchaToken = captchaToken.trim();
    }

    const data = await this.postWidgetJson(`${this.widgetApiBase}/sendOtp`, payload);
    if (!this.isSuccessResponse(data)) {
      const message = this.extractErrorMessage(data);
      this.logger.warn(
        `MSG91 sendOtp rejected identifier=${normalizedIdentifier} body=${JSON.stringify(data).slice(0, 300)}`,
      );
      if (message?.toLowerCase().includes('captcha')) {
        throw new BadRequestException(
          message || 'MSG91 captcha verification failed.',
        );
      }
      throw new BadRequestException(message || 'Failed to send OTP.');
    }

    const reqId = this.extractReqId(data);
    this.logger.log(
      `MSG91 sendOtp accepted identifier=${normalizedIdentifier} reqId=${reqId ?? 'missing'}`,
    );

    return {
      reqId,
      raw: data,
    };
  }

  async retryOtp(reqId: string): Promise<Msg91WidgetSendResult> {
    const credentials = this.getWidgetCredentials();
    if (!credentials) {
      throw new ServiceUnavailableException(
        'MSG91 widget is not configured on the server.',
      );
    }

    const normalizedReqId = reqId?.trim();
    if (!normalizedReqId) {
      throw new BadRequestException('OTP request id is required to resend.');
    }

    const data = await this.postWidgetJson(`${this.widgetApiBase}/retryOtp`, {
      widgetId: credentials.widgetId,
      tokenAuth: credentials.tokenAuth,
      reqId: normalizedReqId,
    });

    if (!this.isSuccessResponse(data)) {
      const message = this.extractErrorMessage(data);
      this.logger.warn(`MSG91 retryOtp rejected body=${JSON.stringify(data).slice(0, 300)}`);
      throw new BadRequestException(message || 'Failed to resend OTP.');
    }

    return {
      reqId: this.extractReqId(data) ?? normalizedReqId,
      raw: data,
    };
  }

  async verifyWidgetOtp(reqId: string, otp: string): Promise<Msg91WidgetVerifyResult> {
    const credentials = this.getWidgetCredentials();
    if (!credentials) {
      throw new ServiceUnavailableException(
        'MSG91 widget is not configured on the server (MSG91_WIDGET_ID + MSG91_TOKEN_AUTH).',
      );
    }

    const normalizedReqId = reqId?.trim();
    const normalizedOtp = otp?.trim();
    if (!normalizedReqId) {
      throw new BadRequestException('OTP request id is required.');
    }
    if (!/^\d{6}$/.test(normalizedOtp)) {
      throw new BadRequestException('Enter a valid 6-digit OTP.');
    }

    const data = await this.postWidgetJson(`${this.widgetApiBase}/verifyOtp`, {
      widgetId: credentials.widgetId,
      tokenAuth: credentials.tokenAuth,
      reqId: normalizedReqId,
      otp: normalizedOtp,
    });

    if (!this.isSuccessResponse(data)) {
      const message = this.extractErrorMessage(data);
      this.logger.warn(`MSG91 verifyOtp rejected body=${JSON.stringify(data).slice(0, 300)}`);
      throw new BadRequestException(message || 'Incorrect OTP. Please try again.');
    }

    return {
      mobile: this.extractMobile(data),
      raw: data,
    };
  }

  async verifyAccessToken(accessToken: string): Promise<Msg91WidgetVerifyResult> {
    const authkey = this.getAuthKey();
    if (!authkey) {
      throw new ServiceUnavailableException(
        'MSG91 account auth key is not configured (MSG91_AUTH_KEY).',
      );
    }

    const token = accessToken?.trim();
    if (!token) {
      throw new BadRequestException('Access token is required.');
    }

    const params = new URLSearchParams();
    params.append('authkey', authkey);
    params.append('access-token', token);

    let response: Response;
    try {
      response = await fetch(`${this.widgetApiBase}/verifyAccessToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    } catch (error: unknown) {
      this.logger.error(
        `MSG91 verifyAccessToken network error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(
        'MSG91 service unavailable. Please try again shortly.',
      );
    }

    const body = await response.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(body) as Record<string, unknown>;
    } catch {
      this.logger.error(
        `MSG91 verifyAccessToken invalid JSON status=${response.status} body=${body.slice(0, 200)}`,
      );
      throw new ServiceUnavailableException(
        'MSG91 service unavailable. Please try again shortly.',
      );
    }

    if (!this.isSuccessResponse(data, response)) {
      const messageText = this.extractErrorMessage(data);
      this.logger.warn(
        `MSG91 verifyAccessToken rejected status=${response.status} body=${body.slice(0, 300)}`,
      );
      const userMessage =
        messageText === 'AuthenticationFailure'
          ? 'MSG91 account auth key is invalid. Use widget OTP verification (MSG91_WIDGET_ID + MSG91_TOKEN_AUTH) or set the correct MSG91_AUTH_KEY from your MSG91 dashboard.'
          : messageText || 'Invalid or expired OTP verification token.';
      throw new BadRequestException(userMessage);
    }

    return {
      mobile: this.extractMobile(data),
      raw: data,
    };
  }

  private async postWidgetJson(
    url: string,
    payload: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error: unknown) {
      this.logger.error(
        `MSG91 widget API network error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(
        'MSG91 service unavailable. Please try again shortly.',
      );
    }

    const body = await response.text();
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      this.logger.error(
        `MSG91 widget API invalid JSON status=${response.status} body=${body.slice(0, 200)}`,
      );
      throw new ServiceUnavailableException(
        'MSG91 service unavailable. Please try again shortly.',
      );
    }
  }

  private isSuccessResponse(
    data: Record<string, unknown>,
    response?: Response,
  ): boolean {
    const type = String(data.type ?? data.status ?? '').toLowerCase();
    if (type === 'error' || type === 'fail' || data.hasError === true) {
      return false;
    }
    if (type === 'success' || type === 'ok') {
      return true;
    }
    if (data.hasError === false) {
      return true;
    }
    return response ? response.ok : true;
  }

  private extractErrorMessage(data: Record<string, unknown>): string | undefined {
    const message = data.message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
    if (message && typeof message === 'object') {
      const nested = message as Record<string, unknown>;
      if (typeof nested.message === 'string' && nested.message.trim()) {
        return nested.message;
      }
    }
    return undefined;
  }

  private extractReqId(data: Record<string, unknown>): string | null {
    const message = data.message;
    if (typeof message === 'string' && this.looksLikeReqId(message)) {
      return message.trim();
    }

    for (const key of ['reqId', 'req_id', 'requestId', 'request_id', 'id']) {
      const value = data[key];
      if (typeof value === 'string' && this.looksLikeReqId(value)) {
        return value.trim();
      }
    }

    if (message && typeof message === 'object') {
      const nested = message as Record<string, unknown>;
      for (const key of ['reqId', 'req_id', 'requestId', 'request_id', 'id']) {
        const value = nested[key];
        if (typeof value === 'string' && this.looksLikeReqId(value)) {
          return value.trim();
        }
      }
    }

    const dataField = data.data;
    if (dataField && typeof dataField === 'object') {
      return this.extractReqId(dataField as Record<string, unknown>);
    }

    return null;
  }

  private looksLikeReqId(value: string): boolean {
    const trimmed = value.trim();
    return trimmed.length >= 10 && /^[a-zA-Z0-9_-]+$/.test(trimmed);
  }

  private extractMobile(data: Record<string, unknown>): string | null {
    const message = data.message;
    if (message && typeof message === 'object') {
      const nested = message as Record<string, unknown>;
      const fromNested = this.mobileFromValue(nested.mobile);
      if (fromNested) return fromNested;
      const fromIdentifier = this.mobileFromValue(nested.identifier);
      if (fromIdentifier) return fromIdentifier;
    }

    for (const key of ['mobile', 'phone', 'identifier', 'mobile_no']) {
      const normalized = this.mobileFromValue(data[key]);
      if (normalized) return normalized;
    }

    return null;
  }

  private mobileFromValue(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const digits = value.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) {
      return digits.slice(2);
    }
    if (digits.length === 10) {
      return digits;
    }
    if (digits.length > 10) {
      return digits.slice(-10);
    }
    return null;
  }
}
