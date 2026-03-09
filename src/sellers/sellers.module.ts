import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadsModule } from '../leads/leads.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SellersController } from './sellers.controller';
import { SellersService } from './sellers.service';
import { Seller, SellerSchema } from './schemas/seller.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Seller.name, schema: SellerSchema }]),
    LeadsModule,
    NotificationsModule,
  ],
  controllers: [SellersController],
  providers: [SellersService],
})
export class SellersModule {}
