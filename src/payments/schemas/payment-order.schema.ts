import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, SchemaTypes } from 'mongoose';

export type PaymentOrderDocument = HydratedDocument<PaymentOrder>;

export const PAYMENT_STATUSES = [
  'pending',
  'processing',
  'paid',
  'failed',
  'expired',
  'refunded',
  'partially_refunded',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_STATUSES = [
  'created',
  'active',
  'paid',
  'failed',
  'expired',
  'cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

@Schema({ timestamps: true, collection: 'payment_orders' })
export class PaymentOrder {
  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop({ index: true })
  organisationId?: string;

  @Prop({ type: Types.ObjectId, ref: 'SubscriptionPackage', index: true })
  subscriptionPlanId?: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  orderId: string;

  @Prop({ index: true })
  cashfreeOrderId?: string;

  @Prop()
  paymentSessionId?: string;

  @Prop({ default: 'cashfree', index: true })
  paymentGateway: string;

  @Prop()
  paymentMethod?: string;

  @Prop({ default: 'INR' })
  currency: string;

  @Prop({ required: true, min: 0 })
  baseAmount: number;

  @Prop({ required: true, default: 0, min: 0 })
  discountAmount: number;

  @Prop({ required: true, default: 18 })
  gstPercentage: number;

  @Prop({ required: true, min: 0 })
  gstAmount: number;

  @Prop({ required: true, min: 0 })
  totalAmount: number;

  @Prop({
    required: true,
    enum: PAYMENT_STATUSES,
    default: 'pending',
    index: true,
  })
  paymentStatus: PaymentStatus;

  @Prop({
    required: true,
    enum: ORDER_STATUSES,
    default: 'created',
    index: true,
  })
  orderStatus: OrderStatus;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  @Prop()
  couponCode?: string;

  @Prop()
  idempotencyKey?: string;

  @Prop()
  createdBy?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Lead', index: true })
  leadId?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  @Prop({ default: 1, min: 1 })
  attemptNumber?: number;

  @Prop()
  failureReason?: string;

  @Prop({ type: Object })
  paymentResponse?: Record<string, unknown>;

  @Prop({ default: false })
  signatureVerified?: boolean;

  @Prop()
  webhookProcessedAt?: Date;

  @Prop({ index: true })
  paidAt?: Date;
}

export const PaymentOrderSchema = SchemaFactory.createForClass(PaymentOrder);

PaymentOrderSchema.index({ sellerId: 1, createdAt: -1 });
PaymentOrderSchema.index({ paymentStatus: 1, createdAt: -1 });
PaymentOrderSchema.index({ idempotencyKey: 1 }, { sparse: true });
PaymentOrderSchema.index({ leadId: 1, attemptNumber: 1 });
PaymentOrderSchema.index({ userId: 1, createdAt: -1 });
