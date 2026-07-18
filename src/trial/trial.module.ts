import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
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
import { TrialController } from './trial.controller';
import { TrialHistoryService } from './trial-history.service';
import { TrialSchedulerService } from './trial-scheduler.service';
import { TrialService } from './trial.service';
import { TrialValidationService } from './trial-validation.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: TrialSubscription.name, schema: TrialSubscriptionSchema },
      { name: TrialHistory.name, schema: TrialHistorySchema },
      { name: TrialCleanupLog.name, schema: TrialCleanupLogSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: SubscriptionPackage.name, schema: SubscriptionPackageSchema },
      { name: Gst.name, schema: GstSchema },
    ]),
    EmailModule,
    NotificationsModule,
  ],
  controllers: [TrialController],
  providers: [
    TrialService,
    TrialValidationService,
    TrialHistoryService,
    TrialSchedulerService,
  ],
  exports: [TrialService, TrialValidationService],
})
export class TrialModule {}
