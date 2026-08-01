import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import {
  PaymentOrder,
  PaymentOrderSchema,
} from '../payments/schemas/payment-order.schema';
import {
  SubscriptionPackage,
  SubscriptionPackageSchema,
} from '../subscription/schemas/subscription-package.schema';
import {
  TrialSubscription,
  TrialSubscriptionSchema,
} from '../trial/schemas/trial-subscription.schema';
import {
  SellerSubscription,
  SellerSubscriptionSchema,
} from '../payments/schemas/seller-subscription.schema';
import {
  OnboardingTimeline,
  OnboardingTimelineSchema,
} from './schemas/onboarding-timeline.schema';
import {
  OnboardingPaymentLink,
  OnboardingPaymentLinkSchema,
} from './schemas/onboarding-payment-link.schema';
import { OnboardingController } from './onboarding.controller';
import { OnboardingAdminController } from './onboarding-admin.controller';
import { OnboardingService } from './services/onboarding.service';
import { OnboardingRegistrationService } from './services/onboarding-registration.service';
import { OnboardingPaymentService } from './services/onboarding-payment.service';
import { OnboardingActivationService } from './services/onboarding-activation.service';
import { OnboardingTimelineService } from './services/onboarding-timeline.service';
import { OnboardingPaymentLinkService } from './services/onboarding-payment-link.service';
import { OnboardingStateMachineService } from './services/onboarding-state-machine.service';
import { OnboardingPaymentReminderScheduler } from './onboarding-payment-reminder.scheduler';

@Module({
  imports: [
    EmailModule,
    NotificationsModule,
    ScheduleModule.forRoot(),
    forwardRef(() => PaymentsModule),
    MongooseModule.forFeature([
      { name: OnboardingTimeline.name, schema: OnboardingTimelineSchema },
      { name: OnboardingPaymentLink.name, schema: OnboardingPaymentLinkSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: User.name, schema: UserSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: PaymentOrder.name, schema: PaymentOrderSchema },
      { name: SubscriptionPackage.name, schema: SubscriptionPackageSchema },
      { name: TrialSubscription.name, schema: TrialSubscriptionSchema },
      { name: SellerSubscription.name, schema: SellerSubscriptionSchema },
    ]),
  ],
  controllers: [OnboardingController, OnboardingAdminController],
  providers: [
    OnboardingService,
    OnboardingRegistrationService,
    OnboardingPaymentService,
    OnboardingActivationService,
    OnboardingTimelineService,
    OnboardingPaymentLinkService,
    OnboardingStateMachineService,
    OnboardingPaymentReminderScheduler,
  ],
  exports: [
    OnboardingService,
    OnboardingActivationService,
    OnboardingRegistrationService,
  ],
})
export class OnboardingModule {}
