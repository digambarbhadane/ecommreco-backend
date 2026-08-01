import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { createHmac, timingSafeEqual } from 'crypto';
import { lastValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import {
  CreateGatewayOrderInput,
  GatewayOrderResult,
  GatewayPaymentStatus,
  GatewayRefundInput,
  GatewayRefundResult,
  PaymentGateway,
} from './payment-gateway.interface';

type CashfreeOrderResponse = {
  order_id?: string;
  cf_order_id?: number;
  payment_session_id?: string;
  order_status?: string;
};

type CashfreePaymentsResponse = {
  payments?: Array<{
    cf_payment_id?: number;
    payment_status?: string;
    payment_method?: Record<string, unknown>;
    bank_reference?: string;
    payment_time?: string;
  }>;
};

@Injectable()
export class CashfreeGateway implements PaymentGateway {
  readonly name = 'cashfree';
  private readonly logger = new Logger(CashfreeGateway.name);
  private readonly apiVersion = '2023-08-01';

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private getEnvironment(): 'sandbox' | 'production' {
    const env =
      this.config.get<string>('CASHFREE_ENVIRONMENT')?.trim().toLowerCase() ??
      'sandbox';
    return env === 'production' ? 'production' : 'sandbox';
  }

  private getBaseUrl(): string {
    const override = this.config.get<string>('CASHFREE_BASE_URL')?.trim();
    if (override) return override.replace(/\/+$/, '');
    return this.getEnvironment() === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg';
  }

  private getCredentials() {
    const clientId = this.config.get<string>('CASHFREE_CLIENT_ID')?.trim();
    const clientSecret = this.config.get<string>('CASHFREE_CLIENT_SECRET')?.trim();
    if (!clientId || !clientSecret) {
      throw new UnauthorizedException({
        success: false,
        message: 'Cashfree credentials are not configured',
        errorCode: 'CASHFREE_NOT_CONFIGURED',
      });
    }
    return { clientId, clientSecret };
  }

  private getHeaders() {
    const { clientId, clientSecret } = this.getCredentials();
    return {
      'x-client-id': clientId,
      'x-client-secret': clientSecret,
      'x-api-version': this.apiVersion,
      'Content-Type': 'application/json',
    };
  }

  async createOrder(input: CreateGatewayOrderInput): Promise<GatewayOrderResult> {
    const url = `${this.getBaseUrl()}/orders`;
    const body = {
      order_id: input.orderId,
      order_amount: input.amount,
      order_currency: input.currency ?? 'INR',
      customer_details: {
        customer_id: input.customerId,
        customer_email: input.customerEmail,
        customer_phone: input.customerPhone,
      },
      order_meta: {
        return_url: input.returnUrl,
        notify_url: input.notifyUrl,
        ...(input.metadata ?? {}),
      },
    };

    try {
      const response = await lastValueFrom(
        this.http
          .post<CashfreeOrderResponse>(url, body, { headers: this.getHeaders() })
          .pipe(timeout(30000)),
      );
      const data = response.data ?? {};
      const paymentSessionId = data.payment_session_id;
      if (!paymentSessionId) {
        throw new BadRequestException('Cashfree did not return a payment session');
      }
      return {
        orderId: input.orderId,
        cashfreeOrderId: String(data.cf_order_id ?? data.order_id ?? input.orderId),
        paymentSessionId,
        raw: data as Record<string, unknown>,
      };
    } catch (err: unknown) {
      this.logger.error(`Cashfree createOrder failed: ${this.extractError(err)}`);
      throw new BadRequestException({
        success: false,
        message: 'Failed to create payment order with Cashfree',
        errorCode: 'CASHFREE_ORDER_FAILED',
      });
    }
  }

  async getOrderStatus(orderId: string): Promise<GatewayPaymentStatus> {
    const url = `${this.getBaseUrl()}/orders/${encodeURIComponent(orderId)}`;
    try {
      const orderResponse = await lastValueFrom(
        this.http
          .get<CashfreeOrderResponse>(url, { headers: this.getHeaders() })
          .pipe(timeout(30000)),
      );
      const order = orderResponse.data ?? {};
      const paymentsUrl = `${this.getBaseUrl()}/orders/${encodeURIComponent(orderId)}/payments`;
      const paymentsResponse = await lastValueFrom(
        this.http
          .get<CashfreePaymentsResponse>(paymentsUrl, { headers: this.getHeaders() })
          .pipe(timeout(30000)),
      );
      const payments = paymentsResponse.data?.payments ?? [];
      const latest = payments[0];
      const orderStatus = String(order.order_status ?? '').toUpperCase();
      let paymentStatus: GatewayPaymentStatus['paymentStatus'] = 'pending';
      if (orderStatus === 'PAID' || latest?.payment_status === 'SUCCESS') {
        paymentStatus = 'paid';
      } else if (
        orderStatus === 'EXPIRED' ||
        latest?.payment_status === 'USER_DROPPED'
      ) {
        paymentStatus = 'expired';
      } else if (
        orderStatus === 'ACTIVE' &&
        latest?.payment_status &&
        !['SUCCESS', 'PENDING'].includes(latest.payment_status)
      ) {
        paymentStatus = 'failed';
      }

      const paymentMethod =
        latest?.payment_method && typeof latest.payment_method === 'object'
          ? Object.keys(latest.payment_method)[0]
          : undefined;

      return {
        orderId,
        cashfreeOrderId: String(order.cf_order_id ?? order.order_id ?? orderId),
        paymentStatus,
        paymentMethod,
        bankReference: latest?.bank_reference,
        cashfreePaymentId: latest?.cf_payment_id
          ? String(latest.cf_payment_id)
          : undefined,
        paymentTime: latest?.payment_time
          ? new Date(latest.payment_time)
          : undefined,
        raw: {
          order: order as Record<string, unknown>,
          payments: payments as unknown as Record<string, unknown>,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`Cashfree getOrderStatus failed: ${this.extractError(err)}`);
      throw new BadRequestException({
        success: false,
        message: 'Failed to verify payment with Cashfree',
        errorCode: 'CASHFREE_VERIFY_FAILED',
      });
    }
  }

  async createRefund(input: GatewayRefundInput): Promise<GatewayRefundResult> {
    const url = `${this.getBaseUrl()}/orders/${encodeURIComponent(input.orderId)}/refunds`;
    const body = {
      refund_id: input.refundId,
      refund_amount: input.amount,
      refund_note: input.reason ?? 'Refund initiated by admin',
    };
    try {
      const response = await lastValueFrom(
        this.http
          .post<Record<string, unknown>>(url, body, { headers: this.getHeaders() })
          .pipe(timeout(30000)),
      );
      return {
        refundId: input.refundId,
        status: String(response.data?.refund_status ?? 'PENDING'),
        raw: response.data ?? {},
      };
    } catch (err: unknown) {
      this.logger.error(`Cashfree createRefund failed: ${this.extractError(err)}`);
      throw new BadRequestException({
        success: false,
        message: 'Failed to initiate refund with Cashfree',
        errorCode: 'CASHFREE_REFUND_FAILED',
      });
    }
  }

  verifyWebhookSignature(
    rawBody: string,
    signature: string,
    timestamp?: string,
  ): boolean {
    const secret = this.config.get<string>('CASHFREE_WEBHOOK_SECRET')?.trim();
    if (!secret) {
      this.logger.warn('CASHFREE_WEBHOOK_SECRET not set — rejecting webhook');
      return false;
    }
    if (!signature?.trim()) return false;

    const payload = timestamp ? `${timestamp}${rawBody}` : rawBody;
    const expected = createHmac('sha256', secret).update(payload).digest('base64');
    try {
      const sigBuf = Buffer.from(signature.trim());
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length) return false;
      return timingSafeEqual(sigBuf, expBuf);
    } catch {
      return signature.trim() === expected;
    }
  }

  private extractError(err: unknown): string {
    if (err && typeof err === 'object' && 'response' in err) {
      const response = (err as { response?: { data?: unknown } }).response;
      if (response?.data) return JSON.stringify(response.data);
    }
    if (err && typeof err === 'object' && 'message' in err) {
      return String((err as { message?: unknown }).message);
    }
    return String(err);
  }
}
