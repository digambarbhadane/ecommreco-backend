import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import { NotificationsService } from '../notifications/notifications.service';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import {
  SubscriptionPackage,
  SubscriptionPackageDocument,
} from '../subscription/schemas/subscription-package.schema';
import {
  PaymentOrder,
  PaymentOrderDocument,
} from './schemas/payment-order.schema';
import {
  PaymentTransaction,
  PaymentTransactionDocument,
} from './schemas/payment-transaction.schema';
import {
  SellerSubscription,
  SellerSubscriptionDocument,
  SubscriptionType,
} from './schemas/seller-subscription.schema';
import { PaymentInvoiceService } from './payment-invoice.service';
import { PaymentLogService } from './payment-log.service';
import { PaymentPricingService } from './payment-pricing.service';

@Injectable()
export class PaymentActivationService {
  private readonly logger = new Logger(PaymentActivationService.name);

  constructor(
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(PaymentOrder.name)
    private readonly orderModel: Model<PaymentOrderDocument>,
    @InjectModel(PaymentTransaction.name)
    private readonly transactionModel: Model<PaymentTransactionDocument>,
    @InjectModel(SellerSubscription.name)
    private readonly subscriptionModel: Model<SellerSubscriptionDocument>,
    @InjectModel(SubscriptionPackage.name)
    private readonly packageModel: Model<SubscriptionPackageDocument>,
    private readonly invoiceService: PaymentInvoiceService,
    private readonly paymentLog: PaymentLogService,
    private readonly pricingService: PaymentPricingService,
    private readonly emailService: EmailService,
    private readonly notifications: NotificationsService,
  ) {}

  async activateFromVerifiedPayment(input: {
    order: PaymentOrderDocument;
    cashfreePaymentId?: string;
    paymentMethod?: string;
    bankReference?: string;
    utrNumber?: string;
    gatewayResponse?: Record<string, unknown>;
    activatedBy?: string;
  }) {
    if (input.order.paymentStatus === 'paid') {
      const existing = await this.subscriptionModel
        .findOne({ paymentOrderId: input.order._id, status: 'active' })
        .lean()
        .exec();
      if (existing) {
        return { subscription: existing, alreadyActivated: true };
      }
    }

    const transactionId =
      input.cashfreePaymentId ?? `TXN-${input.order.orderId}`;
    const existingTxn = await this.transactionModel
      .findOne({ transactionId })
      .exec();
    if (!existingTxn) {
      await this.transactionModel.create({
        paymentOrderId: input.order._id,
        transactionId,
        cashfreePaymentId: input.cashfreePaymentId,
        paymentMethod: input.paymentMethod,
        bankReference: input.bankReference,
        utrNumber: input.utrNumber,
        gatewayResponse: input.gatewayResponse,
        paymentStatus: 'paid',
        paymentTime: new Date(),
        remarks: 'Payment verified via Cashfree',
      });
    }

    input.order.paymentStatus = 'paid';
    input.order.orderStatus = 'paid';
    input.order.paidAt = new Date();
    if (input.paymentMethod) input.order.paymentMethod = input.paymentMethod;
    await input.order.save();

    const plan = input.order.subscriptionPlanId
      ? await this.packageModel.findById(input.order.subscriptionPlanId).exec()
      : null;

    const durationDays =
      (input.order.metadata?.durationDays as number) ??
      plan?.durationInDays ??
      30;
    const gstSlots =
      (input.order.metadata?.gstSlots as number) ?? plan?.gstSlots ?? 1;
    const panSlots =
      (input.order.metadata?.panSlots as number) ?? plan?.panSlots ?? 1;
    const isTrial = Boolean(input.order.metadata?.isTrial ?? plan?.isTrial);

    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + durationDays);

    const subscriptionType = this.pricingService.inferSubscriptionType(
      durationDays,
    ) as SubscriptionType;

    const subscription = await this.subscriptionModel.create({
      sellerId: input.order.sellerId,
      organisationId: input.order.organisationId ?? input.order.sellerId,
      paymentOrderId: input.order._id,
      planId: input.order.subscriptionPlanId ?? plan?._id,
      subscriptionType,
      startDate: now,
      endDate,
      renewalDate: endDate,
      status: 'active',
      autoRenew: false,
      trial: isTrial,
      activatedAt: now,
      activatedBy: input.activatedBy ?? 'system',
      metadata: input.order.metadata,
    });

    await this.updateSellerAccount({
      sellerId: input.order.sellerId,
      plan,
      order: input.order,
      subscription,
      durationDays,
      gstSlots,
      panSlots,
      isTrial,
      transactionId,
    });

    const invoice = await this.invoiceService.generateForOrder(
      input.order.orderId,
    );

    await this.sendActivationEmails(input.order, subscription, invoice);
    await this.paymentLog.log({
      eventType: 'activation',
      orderId: input.order.orderId,
      sellerId: input.order.sellerId,
      transactionId,
      message: 'Subscription activated after payment verification',
      success: true,
    });

    return { subscription, invoice, alreadyActivated: false };
  }

  private async updateSellerAccount(input: {
    sellerId: string;
    plan: SubscriptionPackageDocument | null;
    order: PaymentOrderDocument;
    subscription: SellerSubscriptionDocument;
    durationDays: number;
    gstSlots: number;
    panSlots: number;
    isTrial: boolean;
    transactionId: string;
  }) {
    const seller = await this.sellerModel.findById(input.sellerId).exec();
    if (!seller) return;

    const now = new Date();
    const endsAt = input.subscription.endDate;

    seller.gstSlots = input.gstSlots;
    seller.gstSlotsPurchased = input.gstSlots;
    seller.allocatedPanSlots = input.panSlots;
    seller.totalPanSlots = input.panSlots;
    seller.durationYears = input.durationDays / 365;
    seller.subscriptionDuration = input.durationDays;
    seller.amount = input.order.totalAmount;
    seller.paymentAmount = input.order.totalAmount;
    seller.paymentStatus = 'paid';
    seller.paymentId = input.transactionId;
    seller.transactionId = input.transactionId;
    seller.paymentCompletedAt = now;
    seller.paymentVerifiedAt = now;
    seller.paymentDate = now;
    seller.subscriptionStartsAt = now;
    seller.subscriptionEndsAt = endsAt;
    seller.subscriptionId = String(input.subscription._id);
    seller.onboardingStatus = 'active';
    seller.accountStatus = 'active';

    if (input.plan?.planType) {
      seller.subscriptionPlanType = input.plan.planType;
    }

    if (input.isTrial) {
      seller.isTrial = true;
      seller.trialStatus = 'active';
      seller.trialStart = now;
      seller.trialEnd = endsAt;
    } else if (seller.isTrial) {
      seller.trialStatus = 'converted';
      seller.convertedToPaid = true;
      seller.convertedAt = now;
    }

    await seller.save();
  }

  private async sendActivationEmails(
    order: PaymentOrderDocument,
    subscription: SellerSubscriptionDocument,
    invoice: { invoiceNumber?: string } | null,
  ) {
    const seller = await this.sellerModel
      .findById(order.sellerId)
      .lean()
      .exec();
    if (!seller?.email) return;

    try {
      await this.emailService.sendEmail({
        to: seller.email,
        type: EmailType.SUBSCRIPTION,
        subject: 'Payment Successful — Subscription Activated',
        payload: {
          name: seller.fullName || 'there',
          planName: 'EcommReco Subscription',
          amount: order.totalAmount,
          period: `${subscription.subscriptionType} plan`,
          paymentLink: '',
          invoiceNumber: invoice?.invoiceNumber,
          transactionId: order.orderId,
        },
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to send activation email: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      await this.notifications.createNotification({
        event: 'subscription_activated',
        recipientRole: 'seller',
        message: `Your subscription is now active until ${subscription.endDate.toLocaleDateString('en-IN')}.`,
      });
    } catch {
      // Non-blocking
    }
  }
}
