import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PanSlotRequest, PanSlotRequestSchema } from '../pan-slot-requests/schemas/pan-slot-request.schema';
import {
  PanSlotTransaction,
  PanSlotTransactionSchema,
} from '../pan-slot-requests/schemas/pan-slot-transaction.schema';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Subscription,
  SubscriptionSchema,
} from '../subscription/schemas/subscription.schema';
import {
  SubscriptionPackage,
  SubscriptionPackageSchema,
} from '../subscription/schemas/subscription-package.schema';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: SubscriptionPackage.name, schema: SubscriptionPackageSchema },
      { name: PanSlotTransaction.name, schema: PanSlotTransactionSchema },
      { name: PanSlotRequest.name, schema: PanSlotRequestSchema },
    ]),
  ],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
