import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadsModule } from '../leads/leads.module';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import {
  SubscriptionPackage,
  SubscriptionPackageSchema,
} from './schemas/subscription-package.schema';
import {
  Subscription,
  SubscriptionSchema,
} from './schemas/subscription.schema';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SubscriptionPackage.name, schema: SubscriptionPackageSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
    LeadsModule,
  ],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
