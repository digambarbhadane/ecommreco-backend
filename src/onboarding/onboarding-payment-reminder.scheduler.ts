import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { resolvePaymentReturnBaseUrl } from '../config/payment-urls';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import { NotificationsService } from '../notifications/notifications.service';
import {
  isOnboardingV2Enabled,
  ONBOARDING_TIMELINE_EVENTS,
} from './constants/onboarding-status';
import { OnboardingTimelineService } from './services/onboarding-timeline.service';

const REMINDER_HOURS = [24, 48, 72] as const;

@Injectable()
export class OnboardingPaymentReminderScheduler {
  private readonly logger = new Logger(OnboardingPaymentReminderScheduler.name);

  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly emailService: EmailService,
    private readonly notifications: NotificationsService,
    private readonly timeline: OnboardingTimelineService,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 10 * * *')
  async sendAbandonedPaymentReminders() {
    if (!isOnboardingV2Enabled(this.config.get<string>('ONBOARDING_V2_ENABLED'))) {
      return;
    }

    for (const hours of REMINDER_HOURS) {
      await this.processReminderWindow(hours);
    }
  }

  private async processReminderWindow(hoursAfter: number) {
    const cutoff = new Date(Date.now() - hoursAfter * 60 * 60 * 1000);
    const reminderKey = `reminder_${hoursAfter}h`;

    const leads = await this.leadModel
      .find({
        onboardingStatus: {
          $in: ['REGISTERED', 'PAYMENT_PENDING', 'PAYMENT_FAILED'],
        },
        email: { $exists: true, $ne: '' },
        $or: [
          { lastPaymentAttemptAt: { $lte: cutoff } },
          {
            lastPaymentAttemptAt: { $exists: false },
            createdAt: { $lte: cutoff },
          },
        ],
        [`metadata.onboardingReminders.${reminderKey}`]: { $exists: false },
      })
      .limit(100)
      .exec();

    for (const lead of leads) {
      const anchor = lead.lastPaymentAttemptAt ?? (lead as { createdAt?: Date }).createdAt;
      if (!anchor || anchor.getTime() > cutoff.getTime()) {
        continue;
      }

      const email = String(lead.email ?? '').trim().toLowerCase();
      if (!email) continue;

      const user = lead.userId
        ? await this.userModel.findById(lead.userId).lean().exec()
        : await this.userModel.findOne({ email, role: 'seller' }).lean().exec();

      if (!user || user.onboardingUserStatus === 'ACTIVE') {
        continue;
      }

      const frontendUrl = resolvePaymentReturnBaseUrl(this.config);
      const paymentUrl = `${frontendUrl.replace(/\/+$/, '')}/login`;

      const message =
        hoursAfter === 72
          ? 'Your EcommReco trial registration is still waiting for payment. Complete checkout today to activate your account.'
          : `Your EcommReco trial payment is still pending (${hoursAfter}h). Complete checkout to activate your trial.`;

      try {
        await this.emailService.sendEmail({
          to: email,
          type: EmailType.NOTIFICATION,
          subject: `Complete your EcommReco trial payment`,
          payload: {
            name: lead.fullName ?? user.fullName ?? 'there',
            message,
            actionUrl: paymentUrl,
            ctaLabel: 'Complete payment',
          },
        });
      } catch (err: unknown) {
        this.logger.warn(
          `Reminder email failed for ${email}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      await this.notifications
        .createNotification({
          event: 'onboarding_payment_reminder',
          recipientRole: 'sales_manager',
          message: `Payment reminder (${hoursAfter}h): ${lead.firmName ?? lead.fullName ?? email}`,
        })
        .catch(() => undefined);

      await this.timeline.record({
        leadId: lead._id,
        userId: lead.userId,
        eventType: ONBOARDING_TIMELINE_EVENTS.PAYMENT_REMINDER_SENT,
        message: `Payment reminder sent (${hoursAfter}h)`,
        payload: { hoursAfter, paymentUrl },
        actorId: 'system',
        actorRole: 'system',
      });

      await this.leadModel.updateOne(
        { _id: lead._id },
        {
          $set: {
            [`metadata.onboardingReminders.${reminderKey}`]: new Date().toISOString(),
          },
        },
      );

      this.logger.log(`Sent ${hoursAfter}h payment reminder to ${email}`);
    }
  }
}
