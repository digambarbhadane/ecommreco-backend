import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type OnboardingPaymentLinkDocument =
  HydratedDocument<OnboardingPaymentLink>;

@Schema({ timestamps: true, collection: 'onboarding_payment_links' })
export class OnboardingPaymentLink {
  @Prop({ required: true, unique: true, index: true })
  token!: string;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Lead',
    required: true,
    index: true,
  })
  leadId!: Types.ObjectId;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'SubscriptionPackage' })
  planId?: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['trial', 'subscription', 'custom'],
    default: 'trial',
  })
  linkType!: 'trial' | 'subscription' | 'custom';

  @Prop()
  customAmount?: number;

  @Prop({ required: true })
  nonce!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop()
  usedAt?: Date;

  @Prop()
  revokedAt?: Date;

  @Prop({ required: true })
  signature!: string;

  @Prop()
  createdBy?: string;

  @Prop({ type: SchemaTypes.Mixed })
  metadata?: Record<string, unknown>;
}

export const OnboardingPaymentLinkSchema = SchemaFactory.createForClass(
  OnboardingPaymentLink,
);

OnboardingPaymentLinkSchema.index({ expiresAt: 1 });
