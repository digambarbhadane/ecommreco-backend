import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsModule } from '../payments/payments.module';
import {
  PaymentOrder,
  PaymentOrderSchema,
} from '../payments/schemas/payment-order.schema';
import {
  SubscriptionPackage,
  SubscriptionPackageSchema,
} from '../subscription/schemas/subscription-package.schema';
import { Lead, LeadSchema } from './schemas/lead.schema';
import { LeadConversionPublicController } from './lead-conversion-public.controller';
import { LeadConversionPaymentService } from './lead-conversion-payment.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: PaymentOrder.name, schema: PaymentOrderSchema },
      { name: SubscriptionPackage.name, schema: SubscriptionPackageSchema },
    ]),
    forwardRef(() => PaymentsModule),
  ],
  controllers: [LeadConversionPublicController],
  providers: [LeadConversionPaymentService],
  exports: [LeadConversionPaymentService],
})
export class LeadConversionModule {}
