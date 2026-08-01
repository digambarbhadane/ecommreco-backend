import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import { NotificationsService } from '../notifications/notifications.service';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import {
  SellerSubscription,
  SellerSubscriptionDocument,
} from './schemas/seller-subscription.schema';
import { PaymentLogService } from './payment-log.service';

const REMINDER_DAYS = [30, 15, 7, 3, 0] as const;

@Injectable()
export class RenewalReminderScheduler {
  private readonly logger = new Logger(RenewalReminderScheduler.name);

  constructor(
    @InjectModel(SellerSubscription.name)
    private readonly subscriptionModel: Model<SellerSubscriptionDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    private readonly emailService: EmailService,
    private readonly notifications: NotificationsService,
    private readonly paymentLog: PaymentLogService,
  ) {}

  @Cron('0 9 * * *')
  async sendRenewalReminders() {
    for (const days of REMINDER_DAYS) {
      await this.processRemindersForDays(days);
    }
    await this.expireSubscriptions();
  }

  private async processRemindersForDays(daysBefore: number) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysBefore);
    const start = new Date(targetDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(targetDate);
    end.setHours(23, 59, 59, 999);

    const subscriptions = await this.subscriptionModel
      .find({
        status: 'active',
        endDate: { $gte: start, $lte: end },
      })
      .lean()
      .exec();

    for (const sub of subscriptions) {
      const reminderKey = `reminder_${daysBefore}d`;
      const metadata = (sub.metadata ?? {}) as Record<string, unknown>;
      if (metadata[reminderKey]) continue;

      const seller = await this.sellerModel.findById(sub.sellerId).lean().exec();
      if (!seller?.email) continue;

      const message =
        daysBefore === 0
          ? 'Your EcommReco subscription expires today. Renew now to avoid interruption.'
          : `Your EcommReco subscription expires in ${daysBefore} day(s). Renew to continue access.`;

      try {
        await this.emailService.sendEmail({
          to: seller.email,
          type: EmailType.SUBSCRIPTION,
          subject:
            daysBefore === 0
              ? 'Subscription Expires Today'
              : `Subscription Renewal Reminder — ${daysBefore} days left`,
          payload: {
            name: seller.fullName || 'there',
            planName: 'EcommReco Subscription',
            amount: seller.paymentAmount ?? 0,
            period: `${daysBefore} days remaining`,
            paymentLink: seller.paymentLink ?? '',
          },
        });
      } catch (err: unknown) {
        this.logger.warn(
          `Renewal email failed for ${sub.sellerId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      await this.notifications.createNotification({
        event: 'subscription_renewal_reminder',
        recipientRole: 'seller',
        message,
      });

      await this.subscriptionModel.updateOne(
        { _id: sub._id },
        { $set: { [`metadata.${reminderKey}`]: new Date().toISOString() } },
      );

      await this.paymentLog.log({
        eventType: 'email',
        sellerId: sub.sellerId,
        message: `Renewal reminder sent (${daysBefore} days)`,
        success: true,
      });
    }
  }

  private async expireSubscriptions() {
    const now = new Date();
    const expired = await this.subscriptionModel
      .find({ status: 'active', endDate: { $lt: now } })
      .lean()
      .exec();

    for (const sub of expired) {
      await this.subscriptionModel.updateOne(
        { _id: sub._id },
        { $set: { status: 'expired' } },
      );
      await this.sellerModel.updateOne(
        { _id: sub.sellerId },
        { $set: { accountStatus: 'suspended', onboardingStatus: 'payment_pending' } },
      );
    }

    if (expired.length > 0) {
      this.logger.log(`Expired ${expired.length} subscription(s)`);
    }
  }
}
