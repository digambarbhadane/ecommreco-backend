export type CreateGatewayOrderInput = {
  orderId: string;
  amount: number;
  currency?: string;
  customerId: string;
  customerEmail: string;
  customerPhone: string;
  returnUrl: string;
  notifyUrl?: string;
  metadata?: Record<string, string>;
};

export type GatewayOrderResult = {
  orderId: string;
  cashfreeOrderId: string;
  paymentSessionId: string;
  raw: Record<string, unknown>;
};

export type GatewayPaymentStatus = {
  orderId: string;
  cashfreeOrderId: string;
  paymentStatus: 'pending' | 'paid' | 'failed' | 'expired';
  paymentMethod?: string;
  bankReference?: string;
  utrNumber?: string;
  cashfreePaymentId?: string;
  paymentTime?: Date;
  raw: Record<string, unknown>;
};

export type GatewayRefundInput = {
  orderId: string;
  refundId: string;
  amount: number;
  reason?: string;
};

export type GatewayRefundResult = {
  refundId: string;
  status: string;
  raw: Record<string, unknown>;
};

export type CreateGatewayPaymentLinkInput = {
  linkId: string;
  amount: number;
  currency?: string;
  purpose: string;
  customerEmail: string;
  customerPhone: string;
  customerName?: string;
  returnUrl: string;
  notifyUrl?: string;
  expiryTime: Date;
};

export type GatewayPaymentLinkResult = {
  linkId: string;
  linkUrl: string;
  cfLinkId: string;
  raw: Record<string, unknown>;
};

export type GatewayLinkStatus = {
  linkId: string;
  linkStatus: string;
  amountPaid: number;
  paymentStatus: GatewayPaymentStatus['paymentStatus'];
  raw: Record<string, unknown>;
};

export interface PaymentGateway {
  readonly name: string;
  createOrder(input: CreateGatewayOrderInput): Promise<GatewayOrderResult>;
  createPaymentLink?(
    input: CreateGatewayPaymentLinkInput,
  ): Promise<GatewayPaymentLinkResult>;
  getOrderStatus(orderId: string): Promise<GatewayPaymentStatus>;
  getLinkStatus?(linkId: string): Promise<GatewayLinkStatus>;
  createRefund(input: GatewayRefundInput): Promise<GatewayRefundResult>;
  verifyWebhookSignature(
    rawBody: string,
    signature: string,
    timestamp?: string,
  ): boolean;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
