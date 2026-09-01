import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SellerSubscriptionDocument = HydratedDocument<SellerSubscription>;

export const SUBSCRIPTION_STATUSES = [
  'pending',
  'active',
  'expired',
  'cancelled',
  'suspended',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_TYPES = [
  'trial',
  'monthly',
  'quarterly',
  'half_yearly',
  'yearly',
  'custom',
] as const;

export type SubscriptionType = (typeof SUBSCRIPTION_TYPES)[number];

@Schema({ timestamps: true, collection: 'seller_subscriptions' })
export class SellerSubscription {
  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop({ index: true })
  userId?: string;

  @Prop({ index: true })
  organisationId?: string;

  @Prop({ type: Types.ObjectId, ref: 'PaymentOrder', index: true })
  paymentOrderId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SubscriptionPackage', index: true })
  planId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: SUBSCRIPTION_TYPES,
    default: 'monthly',
    index: true,
  })
  subscriptionType: SubscriptionType;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true, index: true })
  endDate: Date;

  @Prop({ index: true })
  renewalDate?: Date;

  @Prop({
    type: String,
    required: true,
    enum: SUBSCRIPTION_STATUSES,
    default: 'pending',
    index: true,
  })
  status: SubscriptionStatus;

  @Prop({ default: false })
  autoRenew: boolean;

  @Prop({ default: false, index: true })
  trial: boolean;

  @Prop()
  activatedAt?: Date;

  @Prop()
  activatedBy?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const SellerSubscriptionSchema =
  SchemaFactory.createForClass(SellerSubscription);

SellerSubscriptionSchema.index({ sellerId: 1, status: 1, endDate: -1 });
SellerSubscriptionSchema.index({ endDate: 1, status: 1 });
SellerSubscriptionSchema.index({ renewalDate: 1, status: 1 });
