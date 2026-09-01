import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { Lead, LeadDocument } from '../../leads/schemas/lead.schema';
import { OnboardingRegisterDto } from '../dto/onboarding.dto';
import { OnboardingRegistrationService } from './onboarding-registration.service';
import { OnboardingPaymentService } from './onboarding-payment.service';
import { OnboardingActivationService } from './onboarding-activation.service';
import { OnboardingTimelineService } from './onboarding-timeline.service';
import { OnboardingPaymentLinkService } from './onboarding-payment-link.service';
import {
  PaymentOrder,
  PaymentOrderDocument,
} from '../../payments/schemas/payment-order.schema';
import { ONBOARDING_TIMELINE_EVENTS } from '../constants/onboarding-status';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly registration: OnboardingRegistrationService,
    private readonly payment: OnboardingPaymentService,
    private readonly activation: OnboardingActivationService,
    private readonly timeline: OnboardingTimelineService,
    private readonly paymentLinks: OnboardingPaymentLinkService,
    private readonly notifications: NotificationsService,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(PaymentOrder.name)
    private readonly orderModel: Model<PaymentOrderDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  register(dto: OnboardingRegisterDto) {
    return this.registration.register(dto);
  }

  resumePayment(userId: string) {
    return this.registration.resumePayment(userId);
  }

  async resumePaymentByEmail(email: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      throw new UnauthorizedException('Email is required');
    }
    const user = await this.userModel.findOne({ email: normalized }).exec();
    if (!user || user.onboardingUserStatus !== 'PENDING_PAYMENT') {
      throw new UnauthorizedException(
        'No pending payment found for this email',
      );
    }
    return this.registration.resumePayment(String(user._id));
  }

  async verifyAndActivate(userId: string, orderId: string) {
    await this.registration.confirmPayment(userId, orderId);
    return this.activation.activateFromPayment(orderId, userId);
  }

  async verifyAndActivateByEmail(orderId: string, email: string) {
    const order = await this.orderModel.findOne({ orderId }).exec();
    if (!order) {
      throw new NotFoundException('Payment order not found');
    }
    const user = await this.userModel.findById(order.userId).exec();
    if (
      !user ||
      user.email.trim().toLowerCase() !== email.trim().toLowerCase()
    ) {
      throw new UnauthorizedException(
        'Unable to verify payment for this order',
      );
    }
    return this.activation.activateFromPayment(orderId, 'confirm_public');
  }

  getMyStatus(userId: string) {
    return this.registration.getStatus(userId);
  }

  getPaymentHistory(userId: string) {
    return this.payment.getPaymentHistory(userId);
  }

  async contactSales(userId: string, message?: string) {
    const status = await this.registration.getStatus(userId);
    await this.timeline.record({
      userId,
      leadId: status.leadNumber ? undefined : undefined,
      eventType: ONBOARDING_TIMELINE_EVENTS.CONTACT_SALES,
      message: message?.trim() || 'User requested sales contact',
      payload: { userId },
      actorId: userId,
      actorRole: 'seller',
    });
    void this.notifications
      .createNotification({
        event: 'onboarding_contact_sales',
        recipientRole: 'sales_manager',
        message: `Seller requested contact: ${message ?? 'Payment assistance needed'}`,
      })
      .catch(() => undefined);
    return {
      success: true,
      message: 'Our sales team will contact you shortly.',
    };
  }

  createPaymentLink(
    input: Parameters<OnboardingPaymentLinkService['createLink']>[0],
  ) {
    return this.paymentLinks.createLink(input);
  }

  validatePaymentLink(token: string) {
    return this.paymentLinks.validateToken(token).then(async (link) => {
      const lead = await this.leadModel.findById(link.leadId).lean().exec();
      return {
        valid: true,
        leadName: lead?.fullName ?? lead?.firmName,
        firmName: lead?.firmName,
        amount: link.customAmount,
        expiresAt: link.expiresAt,
        linkType: link.linkType,
      };
    });
  }

  async checkoutFromPaymentLink(token: string) {
    const link = await this.paymentLinks.validateToken(token);
    const lead = await this.leadModel.findById(link.leadId).lean().exec();
    if (!lead) {
      throw new Error('Lead not found');
    }
    const payment = await this.payment.createPaymentAttempt({
      leadId: String(link.leadId),
      userId: String(link.userId),
      email: String(lead.email ?? ''),
      mobile: String(lead.contactNumber ?? ''),
      fullName: String(lead.fullName ?? ''),
    });
    await this.paymentLinks.markUsed(token);
    return payment;
  }

  getLeadTimeline(leadId: string) {
    return this.timeline.listForLead(leadId);
  }

  getLeadPayments(leadId: string) {
    return this.orderModel
      .find({ leadId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async getFunnelAnalytics() {
    const statuses = [
      'REGISTERED',
      'PAYMENT_PENDING',
      'PAYMENT_FAILED',
      'PAYMENT_LINK_SENT',
      'TRIAL_ACTIVE',
      'TRIAL_EXPIRED',
      'SUBSCRIBED',
      'LOST',
    ] as const;
    const counts = await Promise.all(
      statuses.map(async (status) => ({
        status,
        count: await this.leadModel.countDocuments({
          onboardingStatus: status,
        }),
      })),
    );
    const totalRegistrations = await this.leadModel.countDocuments({
      onboardingStatus: { $exists: true },
    });
    const trialActive =
      counts.find((c) => c.status === 'TRIAL_ACTIVE')?.count ?? 0;
    const paymentPending =
      counts.find((c) => c.status === 'PAYMENT_PENDING')?.count ?? 0;
    const paymentFailed =
      counts.find((c) => c.status === 'PAYMENT_FAILED')?.count ?? 0;
    const paymentLinkSent =
      counts.find((c) => c.status === 'PAYMENT_LINK_SENT')?.count ?? 0;

    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const abandonedOver72h = await this.leadModel.countDocuments({
      onboardingStatus: {
        $in: ['PAYMENT_PENDING', 'PAYMENT_FAILED', 'REGISTERED'],
      },
      $or: [
        { lastPaymentAttemptAt: { $lte: seventyTwoHoursAgo } },
        {
          lastPaymentAttemptAt: { $exists: false },
          createdAt: { $lte: seventyTwoHoursAgo },
        },
      ],
    });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentRegistrations7d = await this.leadModel.countDocuments({
      onboardingStatus: { $exists: true },
      createdAt: { $gte: sevenDaysAgo },
    });

    const paidOrders = await this.orderModel.countDocuments({
      paymentStatus: 'paid',
      'metadata.checkoutType': 'onboarding_trial',
    });
    const failedOrders = await this.orderModel.countDocuments({
      paymentStatus: 'failed',
      'metadata.checkoutType': 'onboarding_trial',
    });

    return {
      totalRegistrations,
      counts,
      conversionToTrial:
        totalRegistrations > 0
          ? Number(((trialActive / totalRegistrations) * 100).toFixed(1))
          : 0,
      paymentPending,
      paymentFailed,
      paymentLinkSent,
      abandonedOver72h,
      recentRegistrations7d,
      paymentAttempts: { paid: paidOrders, failed: failedOrders },
    };
  }
}
