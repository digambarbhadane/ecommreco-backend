import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { PaymentStatus } from './payment-order.schema';
import { PAYMENT_STATUSES } from './payment-order.schema';

export type PaymentTransactionDocument = HydratedDocument<PaymentTransaction>;

@Schema({ timestamps: true, collection: 'payment_transactions' })
export class PaymentTransaction {
  @Prop({ required: true, type: Types.ObjectId, ref: 'PaymentOrder', index: true })
  paymentOrderId: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  transactionId: string;

  @Prop({ index: true })
  cashfreePaymentId?: string;

  @Prop()
  paymentMethod?: string;

  @Prop()
  bankReference?: string;

  @Prop()
  utrNumber?: string;

  @Prop({ type: Object })
  gatewayResponse?: Record<string, unknown>;

  @Prop({
    required: true,
    enum: PAYMENT_STATUSES,
    default: 'pending',
    index: true,
  })
  paymentStatus: PaymentStatus;

  @Prop()
  paymentTime?: Date;

  @Prop()
  remarks?: string;
}

export const PaymentTransactionSchema =
  SchemaFactory.createForClass(PaymentTransaction);

PaymentTransactionSchema.index({ paymentOrderId: 1, createdAt: -1 });
