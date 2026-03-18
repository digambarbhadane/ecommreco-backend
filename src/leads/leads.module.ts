import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../notifications/notifications.module';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { Gst, GstSchema } from '../gsts/schemas/gst.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { Lead, LeadSchema } from './schemas/lead.schema';
import { Counter, CounterSchema } from './schemas/counter.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: Gst.name, schema: GstSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
