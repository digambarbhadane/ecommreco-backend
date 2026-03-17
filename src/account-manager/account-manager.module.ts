import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountManagerController } from './account-manager.controller';
import { AccountManagerService } from './account-manager.service';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Seller.name, schema: SellerSchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [AccountManagerController],
  providers: [AccountManagerService],
})
export class AccountManagerModule {}
