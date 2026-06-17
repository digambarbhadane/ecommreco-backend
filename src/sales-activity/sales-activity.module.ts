import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SalesActivityController } from './sales-activity.controller';
import { SalesActivityService } from './sales-activity.service';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { SalesTarget, SalesTargetSchema } from './schemas/sales-target.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: SalesTarget.name, schema: SalesTargetSchema },
    ]),
  ],
  controllers: [SalesActivityController],
  providers: [SalesActivityService],
  exports: [SalesActivityService],
})
export class SalesActivityModule {}
