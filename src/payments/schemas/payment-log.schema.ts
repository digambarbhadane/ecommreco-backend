import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PaymentLogDocument = HydratedDocument<PaymentLog>;

export const PAYMENT_LOG_EVENTS = [
  'api_call',
  'webhook',
  'verification',
  'retry',
  'failure',
  'refund',
  'activation',
  'invoice',
  'email',
] as const;

export type PaymentLogEvent = (typeof PAYMENT_LOG_EVENTS)[number];

@Schema({ timestamps: true, collection: 'payment_logs' })
export class PaymentLog {
  @Prop({ required: true, enum: PAYMENT_LOG_EVENTS, index: true })
  eventType: PaymentLogEvent;

  @Prop({ index: true })
  orderId?: string;

  @Prop({ index: true })
  sellerId?: string;

  @Prop({ index: true })
  transactionId?: string;

  @Prop()
  gateway?: string;

  @Prop()
  message?: string;

  @Prop({ type: Object })
  request?: Record<string, unknown>;

  @Prop({ type: Object })
  response?: Record<string, unknown>;

  @Prop({ default: false })
  success: boolean;

  @Prop()
  errorCode?: string;
}

export const PaymentLogSchema = SchemaFactory.createForClass(PaymentLog);

PaymentLogSchema.index({ eventType: 1, createdAt: -1 });
PaymentLogSchema.index({ orderId: 1, createdAt: -1 });
PaymentLogSchema.index({ sellerId: 1, createdAt: -1 });
