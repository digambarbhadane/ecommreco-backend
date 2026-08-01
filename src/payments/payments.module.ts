import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  SubscriptionPackage,
  SubscriptionPackageSchema,
} from '../subscription/schemas/subscription-package.schema';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { CashfreeGateway } from './gateways/cashfree.gateway';
import { PAYMENT_GATEWAY } from './gateways/payment-gateway.interface';
import { PaymentActivationService } from './payment-activation.service';
import { PaymentInvoiceService } from './payment-invoice.service';
import { PaymentLogService } from './payment-log.service';
import { PaymentPricingService } from './payment-pricing.service';
import { PaymentWebhookService } from './payment-webhook.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RenewalReminderScheduler } from './renewal-reminder.scheduler';
import { Coupon, CouponSchema } from './schemas/coupon.schema';
import {
  PaymentInvoice,
  PaymentInvoiceSchema,
} from './schemas/payment-invoice.schema';
import { PaymentLog, PaymentLogSchema } from './schemas/payment-log.schema';
import {
  PaymentOrder,
  PaymentOrderSchema,
} from './schemas/payment-order.schema';
import {
  PaymentTransaction,
  PaymentTransactionSchema,
} from './schemas/payment-transaction.schema';
import {
  SellerSubscription,
  SellerSubscriptionSchema,
} from './schemas/seller-subscription.schema';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [
    HttpModule,
    ScheduleModule.forRoot(),
    EmailModule,
    NotificationsModule,
    forwardRef(() => OnboardingModule),
    MongooseModule.forFeature([
      { name: PaymentOrder.name, schema: PaymentOrderSchema },
      { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
      { name: SellerSubscription.name, schema: SellerSubscriptionSchema },
      { name: PaymentInvoice.name, schema: PaymentInvoiceSchema },
      { name: PaymentLog.name, schema: PaymentLogSchema },
      { name: Coupon.name, schema: CouponSchema },
      { name: SubscriptionPackage.name, schema: SubscriptionPackageSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [
    CashfreeGateway,
  {
      provide: PAYMENT_GATEWAY,
      useExisting: CashfreeGateway,
    },
    PaymentsService,
    PaymentPricingService,
    PaymentLogService,
    PaymentInvoiceService,
    PaymentActivationService,
    PaymentWebhookService,
    RenewalReminderScheduler,
  ],
  exports: [
    PaymentsService,
    PaymentPricingService,
    PaymentActivationService,
    PaymentWebhookService,
    PaymentLogService,
    PAYMENT_GATEWAY,
  ],
})
export class PaymentsModule {}
