import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { CashfreeGateway } from './gateways/cashfree.gateway';
import {
  PaymentOrder,
  PaymentOrderDocument,
} from './schemas/payment-order.schema';
import { PaymentActivationService } from './payment-activation.service';
import { PaymentLogService } from './payment-log.service';
import { OnboardingActivationService } from '../onboarding/services/onboarding-activation.service';
import { ONBOARDING_CHECKOUT_TYPE } from '../onboarding/constants/onboarding-status';

type CashfreeWebhookPayload = {
  type?: string;
  data?: {
    order?: {
      order_id?: string;
      order_status?: string;
    };
    payment?: {
      cf_payment_id?: number;
      payment_status?: string;
      payment_method?: Record<string, unknown>;
      bank_reference?: string;
      payment_time?: string;
    };
    refund?: {
      refund_id?: string;
      refund_status?: string;
    };
  };
};

@Injectable()
export class PaymentWebhookService {
  private readonly logger = new Logger(PaymentWebhookService.name);
  private readonly processedEvents = new Set<string>();

  constructor(
    @InjectModel(PaymentOrder.name)
    private readonly orderModel: Model<PaymentOrderDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    private readonly cashfreeGateway: CashfreeGateway,
    private readonly activationService: PaymentActivationService,
    private readonly paymentLog: PaymentLogService,
    private readonly emailService: EmailService,
    private readonly onboardingActivation: OnboardingActivationService,
  ) {}

  async handleCashfreeWebhook(
    rawBody: string,
    signature: string,
    timestamp?: string,
    payload?: CashfreeWebhookPayload,
  ) {
    const valid = this.cashfreeGateway.verifyWebhookSignature(
      rawBody,
      signature,
      timestamp,
    );
    if (!valid) {
      await this.paymentLog.log({
        eventType: 'webhook',
        message: 'Invalid webhook signature',
        success: false,
        errorCode: 'INVALID_SIGNATURE',
      });
      return { success: false, message: 'Invalid signature' };
    }

    const eventType = String(payload?.type ?? '').toUpperCase();
    const orderId =
      payload?.data?.order?.order_id ??
      (payload?.data as { order_id?: string })?.order_id;
    const idempotencyKey = `${eventType}:${orderId}:${payload?.data?.payment?.cf_payment_id ?? ''}`;

    if (this.processedEvents.has(idempotencyKey)) {
      return { success: true, message: 'Duplicate webhook ignored' };
    }
    this.processedEvents.add(idempotencyKey);
    if (this.processedEvents.size > 10000) {
      this.processedEvents.clear();
    }

    await this.paymentLog.log({
      eventType: 'webhook',
      orderId,
      message: `Webhook received: ${eventType}`,
      request: payload as Record<string, unknown>,
      success: true,
    });

    if (!orderId) {
      return { success: false, message: 'Missing order_id' };
    }

    const order = await this.orderModel.findOne({ orderId }).exec();
    if (!order) {
      this.logger.warn(`Webhook for unknown order: ${orderId}`);
      return { success: false, message: 'Order not found' };
    }

    switch (eventType) {
      case 'PAYMENT_SUCCESS_WEBHOOK':
      case 'PAYMENT_SUCCESS':
        return this.handlePaymentSuccess(order, payload);
      case 'PAYMENT_FAILED_WEBHOOK':
      case 'PAYMENT_FAILED':
        return this.handlePaymentFailed(order, payload);
      case 'PAYMENT_PENDING_WEBHOOK':
      case 'PAYMENT_PENDING':
        order.paymentStatus = 'processing';
        await order.save();
        return { success: true, message: 'Payment pending recorded' };
      case 'REFUND_SUCCESS_WEBHOOK':
      case 'REFUND_SUCCESS':
        order.paymentStatus = 'refunded';
        await order.save();
        return { success: true, message: 'Refund success recorded' };
      case 'REFUND_FAILED_WEBHOOK':
      case 'REFUND_FAILED':
        await this.paymentLog.log({
          eventType: 'refund',
          orderId,
          message: 'Refund failed webhook received',
          success: false,
        });
        return { success: true, message: 'Refund failure recorded' };
      default:
        return { success: true, message: `Unhandled event: ${eventType}` };
    }
  }

  private async handlePaymentSuccess(
    order: PaymentOrderDocument,
    payload?: CashfreeWebhookPayload,
  ) {
    if (order.paymentStatus === 'paid') {
      return { success: true, message: 'Already processed' };
    }

    const checkoutType = (order.metadata as Record<string, unknown>)
      ?.checkoutType;
    const status = await this.cashfreeGateway.getOrderStatus(order.orderId);
    if (status.paymentStatus !== 'paid') {
      return { success: false, message: 'Payment verification failed' };
    }

    if (
      checkoutType === ONBOARDING_CHECKOUT_TYPE ||
      checkoutType === 'onboarding_trial'
    ) {
      order.paymentStatus = 'paid';
      order.orderStatus = 'paid';
      await order.save();
      await this.onboardingActivation.activateFromPayment(order.orderId, 'webhook');
      return { success: true, message: 'Onboarding trial activated via webhook' };
    }

    if (checkoutType === 'trial_upgrade' || checkoutType === 'trial_registration') {
      order.paymentStatus = 'paid';
      order.orderStatus = 'paid';
      await order.save();
      return { success: true, message: 'Trial payment recorded via webhook' };
    }
    if (status.paymentStatus !== 'paid') {
      return { success: false, message: 'Payment verification failed' };
    }

    const payment = payload?.data?.payment;
    await this.activationService.activateFromVerifiedPayment({
      order,
      cashfreePaymentId:
        status.cashfreePaymentId ??
        (payment?.cf_payment_id ? String(payment.cf_payment_id) : undefined),
      paymentMethod: status.paymentMethod,
      bankReference: status.bankReference ?? payment?.bank_reference,
      gatewayResponse: status.raw,
      activatedBy: 'webhook',
    });

    return { success: true, message: 'Payment processed and subscription activated' };
  }

  private async handlePaymentFailed(
    order: PaymentOrderDocument,
    payload?: CashfreeWebhookPayload,
  ) {
    const checkoutType = (order.metadata as Record<string, unknown>)
      ?.checkoutType;
    if (
      checkoutType === ONBOARDING_CHECKOUT_TYPE ||
      checkoutType === 'onboarding_trial'
    ) {
      await this.onboardingActivation.handlePaymentFailed(
        order.orderId,
        payload?.data?.payment?.payment_status,
      );
      return { success: true, message: 'Onboarding payment failure recorded' };
    }

    order.paymentStatus = 'failed';
    order.orderStatus = 'failed';
    await order.save();

    const seller = await this.sellerModel.findById(order.sellerId).lean().exec();
    if (seller?.email) {
      try {
        await this.emailService.sendEmail({
          to: seller.email,
          type: EmailType.SUBSCRIPTION,
          subject: 'Payment Failed — EcommReco',
          payload: {
            name: seller.fullName || 'there',
            planName: 'Subscription',
            amount: order.totalAmount,
            period: '',
            paymentLink: '',
          },
        });
      } catch {
        // Non-blocking
      }
    }

    await this.paymentLog.log({
      eventType: 'failure',
      orderId: order.orderId,
      sellerId: order.sellerId,
      message: 'Payment failed webhook processed',
      request: payload as Record<string, unknown>,
      success: false,
    });

    return { success: true, message: 'Payment failure recorded' };
  }
}
