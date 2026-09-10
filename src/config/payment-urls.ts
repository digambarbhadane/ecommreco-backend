import type { ConfigService } from '@nestjs/config';

type ConfigReader = Pick<ConfigService, 'get'>;

const LOCAL_HOST_PATTERN =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/i;

function readConfigValue(
  config: ConfigReader,
  key: string,
): string | undefined {
  const raw = config.get<string>(key);
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed || undefined;
}

function isLocalUrl(url: string): boolean {
  return LOCAL_HOST_PATTERN.test(url.replace(/\/+$/, ''));
}

function isPublicHttpsUrl(url: string): boolean {
  return /^https:\/\//i.test(url) && !isLocalUrl(url);
}

/** Cashfree return_url host — must match where the seller's browser opens the app. */
export function resolvePaymentReturnBaseUrl(config: ConfigReader): string {
  const paymentReturn = readConfigValue(config, 'PAYMENT_RETURN_BASE_URL');
  const frontendPrimary =
    readConfigValue(config, 'FRONTEND_URL')?.split(',')[0]?.trim() || undefined;

  if (paymentReturn) {
    if (
      isLocalUrl(paymentReturn) &&
      frontendPrimary &&
      isPublicHttpsUrl(frontendPrimary)
    ) {
      return frontendPrimary;
    }
    return paymentReturn;
  }

  if (frontendPrimary) {
    return frontendPrimary;
  }

  return 'http://localhost:8080';
}

/** Cashfree notify_url host — public API base (no /api/v1 suffix). */
export function resolvePaymentNotifyBaseUrl(config: ConfigReader): string {
  const apiPublic = readConfigValue(config, 'API_PUBLIC_URL');
  if (apiPublic) {
    return apiPublic.replace(/\/+$/, '');
  }

  const port = readConfigValue(config, 'PORT') ?? '5001';
  return `http://localhost:${port}`;
}

export function buildPaymentReturnUrl(
  config: ConfigReader,
  returnPath: string,
): string {
  const base = resolvePaymentReturnBaseUrl(config).replace(/\/+$/, '');
  const path = returnPath.startsWith('/') ? returnPath : `/${returnPath}`;
  return `${base}${path}`;
}

export function buildPaymentNotifyUrl(config: ConfigReader): string {
  const base = resolvePaymentNotifyBaseUrl(config);
  return `${base}/api/v1/webhooks/cashfree`;
}
