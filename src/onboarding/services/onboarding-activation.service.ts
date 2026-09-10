import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Connection, Model, Types } from 'mongoose';
import { Lead, LeadDocument } from '../../leads/schemas/lead.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { Seller, SellerDocument } from '../../sellers/schemas/seller.schema';
import {
  PaymentOrder,
  PaymentOrderDocument,
} from '../../payments/schemas/payment-order.schema';
import {
  TrialSubscription,
  TrialSubscriptionDocument,
} from '../../trial/schemas/trial-subscription.schema';
import {
  SellerSubscription,
  SellerSubscriptionDocument,
} from '../../payments/schemas/seller-subscription.schema';
import { EmailService } from '../../email/email.service';
import { EmailType } from '../../email/email.types';
import { NotificationsService } from '../../notifications/notifications.service';
import { generatePublicId } from '../../common/public-id';
import {
  ONBOARDING_CHECKOUT_TYPE,
  ONBOARDING_TIMELINE_EVENTS,
} from '../constants/onboarding-status';
import {
  TRIAL_DURATION_DAYS,
  TRIAL_GST_SLOTS,
  TRIAL_PAN_SLOTS,
  addDays,
  computeTrialPayable,
} from '../../trial/trial.constants';
import { OnboardingStateMachineService } from './onboarding-state-machine.service';
import { OnboardingTimelineService } from './onboarding-timeline.service';
import { Inject } from '@nestjs/common';
import type { PaymentGateway } from '../../payments/gateways/payment-gateway.interface';
import { PAYMENT_GATEWAY } from '../../payments/gateways/payment-gateway.interface';

@Injectable()
export class OnboardingActivationService {
  private readonly logger = new Logger(OnboardingActivationService.name);

  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(PaymentOrder.name)
    private readonly orderModel: Model<PaymentOrderDocument>,
    @InjectModel(TrialSubscription.name)
    private readonly trialModel: Model<TrialSubscriptionDocument>,
    @InjectModel(SellerSubscription.name)
    private readonly subscriptionModel: Model<SellerSubscriptionDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(PAYMENT_GATEWAY)
    private readonly gateway: PaymentGateway,
    private readonly stateMachine: OnboardingStateMachineService,
    private readonly timeline: OnboardingTimelineService,
    private readonly emailService: EmailService,
    private readonly notifications: NotificationsService,
  ) {}

  isOnboardingOrder(order: PaymentOrderDocument) {
    const checkoutType = (order.metadata as Record<string, unknown>)
      ?.checkoutType;
    return checkoutType === ONBOARDING_CHECKOUT_TYPE;
  }

  async activateFromPayment(orderId: string, activatedBy = 'system') {
    const order = await this.orderModel.findOne({ orderId }).exec();
    if (!order) {
      throw new NotFoundException('Payment order not found');
    }
    if (!this.isOnboardingOrder(order)) {
      return { success: false, message: 'Not an onboarding order' };
    }
    if (order.paymentStatus === 'paid') {
      const existing = await this.userModel
        .findById(order.userId)
        .lean()
        .exec();
      if (existing?.onboardingUserStatus === 'ACTIVE') {
        return {
          success: true,
          message: 'Already activated',
          alreadyActive: true,
        };
      }
    }

    const status = await this.gateway.getOrderStatus(order.orderId);
    if (status.paymentStatus !== 'paid') {
      return {
        success: false,
        message: 'Payment not verified',
        payment_status: status.paymentStatus,
      };
    }

    order.paymentStatus = 'paid';
    order.orderStatus = 'paid';
    order.signatureVerified = true;
    order.webhookProcessedAt = new Date();
    if (status.paymentMethod) {
      order.paymentMethod = status.paymentMethod;
    }
    await order.save();

    const userId = String(order.userId ?? order.sellerId);
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('Onboarding user not found');
    }

    const lead = user.leadId
      ? await this.leadModel.findById(user.leadId).exec()
      : order.leadId
        ? await this.leadModel.findById(order.leadId).exec()
        : null;
    if (!lead) {
      throw new NotFoundException('Lead not found for activation');
    }

    const metadata = (lead.metadata ?? {}) as Record<string, unknown>;
    const panNumber = String(metadata.panNumber ?? lead.panNumber ?? '')
      .trim()
      .toUpperCase();
    const gstNumber = String(lead.gstNumber ?? '')
      .trim()
      .toUpperCase();
    const pricing = computeTrialPayable();
    const now = new Date();
    const trialEnd = addDays(now, TRIAL_DURATION_DAYS);

    const session = await this.connection.startSession();
    let seller: SellerDocument;
    try {
      session.startTransaction();

      const existingSeller = user.sellerId
        ? await this.sellerModel.findById(user.sellerId).session(session)
        : null;

      if (existingSeller) {
        seller = existingSeller;
      } else {
        const created = await this.sellerModel.create(
          [
            {
              publicId: generatePublicId('seller', user.email),
              fullName: lead.fullName ?? user.fullName,
              firmName: lead.firmName ?? user.companyName,
              contactNumber: lead.contactNumber,
              email: user.email,
              gstNumber,
              panNumber,
              password: user.password,
              username: user.email,
              leadId: String(lead._id),
              leadSource: lead.source ?? 'self_service_trial',
              isTrial: true,
              trialStatus: 'active',
              trialStart: now,
              trialEnd,
              convertedToPaid: false,
              gstSlots: TRIAL_GST_SLOTS,
              gstSlotsPurchased: TRIAL_GST_SLOTS,
              allocatedPanSlots: TRIAL_PAN_SLOTS,
              totalPanSlots: TRIAL_PAN_SLOTS,
              onboardingStatus: 'active',
              accountStatus: 'active',
              paymentStatus: 'paid',
              paymentAmount: pricing.totalPayable,
              paymentId: order.orderId,
              paymentCompletedAt: now,
              paymentVerifiedAt: now,
              subscriptionStartsAt: now,
              subscriptionEndsAt: trialEnd,
            },
          ],
          { session },
        );
        seller = created[0];
      }

      const trialExisting = await this.trialModel
        .findOne({ sellerId: seller._id })
        .session(session)
        .exec();
      if (!trialExisting) {
        await this.trialModel.create(
          [
            {
              sellerId: seller._id,
              panNumber,
              gstNumber,
              email: user.email,
              mobile: lead.contactNumber,
              companyName: lead.firmName ?? user.companyName ?? '',
              ownerName: lead.fullName ?? user.fullName,
              status: 'active',
              basePrice: pricing.basePrice,
              gstPercentage: pricing.gstPercentage,
              gstAmount: pricing.gstAmount,
              totalPayable: pricing.totalPayable,
              paymentStatus: 'paid',
              paidAt: now,
              paymentId: order.orderId,
              trialStart: now,
              trialEnd,
              cleanupDate: addDays(trialEnd, 90),
            },
          ],
          { session },
        );
      }

      if (order.subscriptionPlanId) {
        const subscriptionExisting = await this.subscriptionModel
          .findOne({ paymentOrderId: order._id })
          .session(session)
          .exec();
        if (!subscriptionExisting) {
          await this.subscriptionModel.create(
            [
              {
                sellerId: String(seller._id),
                userId: String(user._id),
                planId: order.subscriptionPlanId,
                paymentOrderId: order._id,
                subscriptionType: 'trial',
                startDate: now,
                endDate: trialEnd,
                status: 'active',
                trial: true,
                activatedAt: now,
                activatedBy,
              },
            ],
            { session },
          );
        }
      }

      order.sellerId = String(seller._id);
      await order.save({ session });

      user.sellerId = seller._id;
      user.onboardingUserStatus = 'ACTIVE';
      user.status = 'approved';
      await user.save({ session });

      const fromStatus = (lead.onboardingStatus ??
        'PAYMENT_PENDING') as Parameters<
        OnboardingStateMachineService['assertTransition']
      >[0];
      this.stateMachine.assertTransition(fromStatus, 'TRIAL_ACTIVE');
      lead.onboardingStatus = 'TRIAL_ACTIVE';
      lead.sellerId = String(seller._id);
      lead.userId = user._id;
      lead.convertedAt = now;
      await lead.save({ session });

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }

    await this.timeline.record({
      leadId: lead._id,
      userId: user._id,
      eventType: ONBOARDING_TIMELINE_EVENTS.PAYMENT_SUCCESS,
      message: 'Payment verified successfully',
      payload: { orderId: order.orderId },
    });
    await this.timeline.record({
      leadId: lead._id,
      userId: user._id,
      eventType: ONBOARDING_TIMELINE_EVENTS.TRIAL_ACTIVATED,
      message: `Trial active until ${trialEnd.toISOString().slice(0, 10)}`,
      payload: { sellerId: String(seller._id), trialEnd },
    });

    void this.emailService
      .sendEmail({
        to: user.email,
        type: EmailType.SUBSCRIPTION,
        subject: 'Your EcommReco Trial Has Started',
        payload: {
          name: user.fullName,
          trialEnd: trialEnd.toISOString().slice(0, 10),
          days: TRIAL_DURATION_DAYS,
        },
      })
      .catch(() => undefined);

    void this.notifications
      .createNotification({
        event: 'trial_activated',
        recipientRole: 'super_admin',
        message: `Trial activated: ${lead.firmName ?? user.fullName} (${user.email})`,
      })
      .catch(() => undefined);

    return {
      success: true,
      sellerId: String(seller._id),
      userId: String(user._id),
      trialEnd,
    };
  }

  async handlePaymentFailed(orderId: string, failureReason?: string) {
    const order = await this.orderModel.findOne({ orderId }).exec();
    if (!order || !this.isOnboardingOrder(order)) {
      return { success: false };
    }

    order.paymentStatus = 'failed';
    order.orderStatus = 'failed';
    order.failureReason = failureReason;
    await order.save();

    const userId = String(order.userId ?? '');
    const leadId = String(order.leadId ?? '');

    if (leadId) {
      await this.leadModel.updateOne(
        { _id: leadId },
        { $set: { onboardingStatus: 'PAYMENT_FAILED' } },
      );
    }
    if (userId) {
      await this.userModel.updateOne(
        { _id: userId },
        { $set: { onboardingUserStatus: 'PENDING_PAYMENT' } },
      );
    }

    await this.timeline.record({
      leadId: leadId || undefined,
      userId: userId || undefined,
      eventType: ONBOARDING_TIMELINE_EVENTS.PAYMENT_FAILED,
      message: failureReason ?? 'Payment failed',
      payload: { orderId },
    });

    const failureMessage = `Trial payment failed for order ${orderId}`;
    void this.notifications
      .createNotification({
        event: 'trial_payment_failed',
        recipientRole: 'sales_manager',
        message: failureMessage,
      })
      .catch(() => undefined);
    void this.notifications
      .createNotification({
        event: 'trial_payment_failed',
        recipientRole: 'super_admin',
        message: failureMessage,
      })
      .catch(() => undefined);

    return { success: true };
  }
}
