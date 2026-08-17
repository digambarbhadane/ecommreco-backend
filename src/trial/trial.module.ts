import { Module, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  SubscriptionPackage,
  SubscriptionPackageSchema,
} from '../subscription/schemas/subscription-package.schema';
import {
  TrialCleanupLog,
  TrialCleanupLogSchema,
} from './schemas/trial-cleanup-log.schema';
import {
  TrialHistory,
  TrialHistorySchema,
} from './schemas/trial-history.schema';
import {
  TrialSubscription,
  TrialSubscriptionSchema,
} from './schemas/trial-subscription.schema';
import { Gst, GstSchema } from '../gsts/schemas/gst.schema';
import {
  SellerSubscription,
  SellerSubscriptionSchema,
} from '../payments/schemas/seller-subscription.schema';
import { TrialController } from './trial.controller';
import { TrialHistoryService } from './trial-history.service';
import { TrialSchedulerService } from './trial-scheduler.service';
import { TrialService } from './trial.service';
import { TrialValidationService } from './trial-validation.service';
import { SellerOperationalGuard } from './seller-operational.guard';
import { PaymentsModule } from '../payments/payments.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { GstsModule } from '../gsts/gsts.module';
import { MarketplacesModule } from '../marketplaces/marketplaces.module';
import { OtpModule } from '../otp/otp.module';
import { SmsModule } from '../sms/sms.module';
import {
  TrialContactOtp,
  TrialContactOtpSchema,
} from './schemas/trial-contact-otp.schema';
import { TrialOtpService } from './trial-otp.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: TrialSubscription.name, schema: TrialSubscriptionSchema },
      { name: TrialHistory.name, schema: TrialHistorySchema },
      { name: TrialCleanupLog.name, schema: TrialCleanupLogSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: User.name, schema: UserSchema },
      { name: SubscriptionPackage.name, schema: SubscriptionPackageSchema },
      { name: Gst.name, schema: GstSchema },
      { name: SellerSubscription.name, schema: SellerSubscriptionSchema },
      { name: TrialContactOtp.name, schema: TrialContactOtpSchema },
    ]),
    EmailModule,
    OtpModule,
    SmsModule,
    NotificationsModule,
    forwardRef(() => PaymentsModule),
    forwardRef(() => OnboardingModule),
    SubscriptionModule,
    forwardRef(() => GstsModule),
    forwardRef(() => MarketplacesModule),
  ],
  controllers: [TrialController],
  providers: [
    TrialService,
    TrialOtpService,
    TrialValidationService,
    TrialHistoryService,
    TrialSchedulerService,
    {
      provide: APP_GUARD,
      useClass: SellerOperationalGuard,
    },
  ],
  exports: [TrialService, TrialValidationService],
})
export class TrialModule {}
