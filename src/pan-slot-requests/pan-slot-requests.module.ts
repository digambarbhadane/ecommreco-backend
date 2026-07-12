import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  PanSlotPricing,
  PanSlotPricingSchema,
} from './schemas/pan-slot-pricing.schema';
import {
  PanSlotRequest,
  PanSlotRequestSchema,
} from './schemas/pan-slot-request.schema';
import {
  PanSlotTransaction,
  PanSlotTransactionSchema,
} from './schemas/pan-slot-transaction.schema';
import { PanSlotRequestsController } from './pan-slot-requests.controller';
import {
  PanSlotPricingAdminController,
  PanSlotRequestsAdminController,
  PanSlotTransactionsAdminController,
} from './pan-slot-requests-admin.controller';
import { PanSlotRequestsService } from './pan-slot-requests.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PanSlotRequest.name, schema: PanSlotRequestSchema },
      { name: PanSlotTransaction.name, schema: PanSlotTransactionSchema },
      { name: PanSlotPricing.name, schema: PanSlotPricingSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationsModule,
    EmailModule,
  ],
  controllers: [
    PanSlotRequestsController,
    PanSlotRequestsAdminController,
    PanSlotTransactionsAdminController,
    PanSlotPricingAdminController,
  ],
  providers: [PanSlotRequestsService],
  exports: [PanSlotRequestsService],
})
export class PanSlotRequestsModule {}
