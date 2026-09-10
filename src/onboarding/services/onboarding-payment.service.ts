import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildPaymentNotifyUrl,
  buildPaymentReturnUrl,
} from '../../config/payment-urls';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Lead, LeadDocument } from '../../leads/schemas/lead.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  PaymentOrder,
  PaymentOrderDocument,
} from '../../payments/schemas/payment-order.schema';
import {
  SubscriptionPackage,
  SubscriptionPackageDocument,
} from '../../subscription/schemas/subscription-package.schema';
import { Inject } from '@nestjs/common';
import type { PaymentGateway } from '../../payments/gateways/payment-gateway.interface';
import { PAYMENT_GATEWAY } from '../../payments/gateways/payment-gateway.interface';
import { PaymentLogService } from '../../payments/payment-log.service';
import {
  ONBOARDING_CHECKOUT_TYPE,
  ONBOARDING_TIMELINE_EVENTS,
} from '../constants/onboarding-status';
import { computeTrialPayable, TRIAL_PRICE } from '../../trial/trial.constants';
import { OnboardingTimelineService } from './onboarding-timeline.service';

@Injectable()
export class OnboardingPaymentService {
  private readonly logger = new Logger(OnboardingPaymentService.name);

  constructor(
    @InjectModel(PaymentOrder.name)
    private readonly orderModel: Model<PaymentOrderDocument>,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(SubscriptionPackage.name)
    private readonly packageModel: Model<SubscriptionPackageDocument>,
    @Inject(PAYMENT_GATEWAY)
    private readonly gateway: PaymentGateway,
    private readonly paymentLog: PaymentLogService,
    private readonly timeline: OnboardingTimelineService,
    private readonly config: ConfigService,
  ) {}

  private async resolveTrialPlanId() {
    const trialPlan = await this.packageModel
      .findOne({ isTrial: true, isActive: true })
      .exec();
    if (trialPlan) return trialPlan;
    return this.packageModel
      .findOne({ isActive: true })
      .sort({ durationInDays: 1 })
      .exec();
  }

  async countAttempts(userId: string) {
    return this.orderModel.countDocuments({ userId }).exec();
  }

  async createPaymentAttempt(input: {
    leadId: string;
    userId: string;
    email: string;
    mobile: string;
    fullName: string;
  }) {
    const plan = await this.resolveTrialPlanId();
    if (!plan) {
      throw new BadRequestException('Trial plan is not configured');
    }

    const pricing = computeTrialPayable(TRIAL_PRICE);
    const attemptNumber = (await this.countAttempts(input.userId)) + 1;
    const orderId = `ECO-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const returnPath = `/seller/register?mode=trial&order_id=${orderId}`;

    const gatewayResult = await this.gateway.createOrder({
      orderId,
      amount: pricing.totalPayable,
      customerId: input.userId,
      customerEmail: input.email,
      customerPhone: input.mobile || '9999999999',
      returnUrl: buildPaymentReturnUrl(this.config, returnPath),
      notifyUrl: buildPaymentNotifyUrl(this.config),
      metadata: {
        user_id: input.userId,
        lead_id: input.leadId,
        checkout_type: ONBOARDING_CHECKOUT_TYPE,
      },
    });

    const order = await this.orderModel.create({
      sellerId: input.userId,
      organisationId: input.userId,
      leadId: new Types.ObjectId(input.leadId),
      userId: new Types.ObjectId(input.userId),
      attemptNumber,
      subscriptionPlanId: plan._id,
      orderId,
      cashfreeOrderId: gatewayResult.cashfreeOrderId,
      paymentSessionId: gatewayResult.paymentSessionId,
      paymentGateway: this.gateway.name,
      currency: 'INR',
      baseAmount: pricing.basePrice,
      discountAmount: 0,
      gstPercentage: pricing.gstPercentage,
      gstAmount: pricing.gstAmount,
      totalAmount: pricing.totalPayable,
      paymentStatus: 'pending',
      orderStatus: 'active',
      idempotencyKey: `onboarding-${input.userId}-${attemptNumber}`,
      metadata: {
        checkoutType: ONBOARDING_CHECKOUT_TYPE,
        leadId: input.leadId,
        userId: input.userId,
        attemptNumber,
        quote: pricing,
        pendingSeller: true,
      },
      createdBy: input.email,
    });

    await this.leadModel.updateOne(
      { _id: input.leadId },
      {
        $set: {
          lastPaymentAttemptAt: new Date(),
          onboardingStatus: 'PAYMENT_PENDING',
        },
      },
    );

    await this.timeline.record({
      leadId: input.leadId,
      userId: input.userId,
      eventType: ONBOARDING_TIMELINE_EVENTS.PAYMENT_STARTED,
      message: `Payment attempt #${attemptNumber} created`,
      payload: { orderId, totalAmount: pricing.totalPayable },
    });

    await this.paymentLog.log({
      eventType: 'api_call',
      orderId,
      sellerId: input.userId,
      gateway: this.gateway.name,
      message: 'Onboarding payment attempt created',
      success: true,
    });

    return {
      order,
      pricing,
      payment_session_id: gatewayResult.paymentSessionId,
      order_id: orderId,
      total_amount: pricing.totalPayable,
      attemptNumber,
    };
  }

  async getPaymentHistory(userId: string) {
    return this.orderModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async getOrderForUser(orderId: string, userId: string) {
    const order = await this.orderModel
      .findOne({
        orderId,
        $or: [{ userId }, { sellerId: userId }],
      })
      .exec();
    if (!order) {
      throw new NotFoundException('Payment order not found');
    }
    return order;
  }
}
