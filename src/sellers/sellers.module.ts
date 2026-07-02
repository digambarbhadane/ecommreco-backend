import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadsModule } from '../leads/leads.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../email/email.module';
import { SellersController } from './sellers.controller';
import { SellersService } from './sellers.service';
import { Seller, SellerSchema } from './schemas/seller.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Seller.name, schema: SellerSchema },
      { name: User.name, schema: UserSchema },
    ]),
    LeadsModule,
    NotificationsModule,
    EmailModule,
  ],
  controllers: [SellersController],
  providers: [SellersService],
})
export class SellersModule {}
