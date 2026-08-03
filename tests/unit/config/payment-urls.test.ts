import {
  buildPaymentNotifyUrl,
  buildPaymentReturnUrl,
  resolvePaymentReturnBaseUrl,
} from '../../../src/config/payment-urls';

const config = (values: Record<string, string | undefined>) => ({
  get: (key: string) => values[key],
});

describe('payment-urls', () => {
  it('uses PAYMENT_RETURN_BASE_URL when aligned with environment', () => {
    const url = resolvePaymentReturnBaseUrl(
      config({
        PAYMENT_RETURN_BASE_URL: 'https://uat.ecommreco.com',
        FRONTEND_URL: 'https://uat.ecommreco.com',
      }),
    );
    expect(url).toBe('https://uat.ecommreco.com');
  });

  it('prefers public FRONTEND_URL when PAYMENT_RETURN_BASE_URL is localhost', () => {
    const url = resolvePaymentReturnBaseUrl(
      config({
        PAYMENT_RETURN_BASE_URL: 'http://localhost:8080',
        FRONTEND_URL: 'https://dev.ecommreco.com',
      }),
    );
    expect(url).toBe('https://dev.ecommreco.com');
  });

  it('builds notify webhook from API_PUBLIC_URL', () => {
    expect(
      buildPaymentNotifyUrl(
        config({ API_PUBLIC_URL: 'https://api-dev.ecommreco.com' }),
      ),
    ).toBe('https://api-dev.ecommreco.com/api/v1/webhooks/cashfree');
  });

  it('builds return path on resolved frontend base', () => {
    expect(
      buildPaymentReturnUrl(
        config({
          PAYMENT_RETURN_BASE_URL: 'https://dev.ecommreco.com',
          FRONTEND_URL: 'https://dev.ecommreco.com',
        }),
        '/payment/success?order_id=ABC',
      ),
    ).toBe('https://dev.ecommreco.com/payment/success?order_id=ABC');
  });
});
