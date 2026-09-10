import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import type { TrialStatus } from '../trial.constants';

export type TrialSubscriptionDocument = HydratedDocument<TrialSubscription>;

@Schema({ timestamps: true, collection: 'trial_subscriptions' })
export class TrialSubscription {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Seller',
    required: true,
    index: true,
  })
  sellerId!: Types.ObjectId;

  @Prop({ required: true, trim: true, uppercase: true })
  panNumber!: string;

  @Prop({ required: true, trim: true, uppercase: true })
  gstNumber!: string;

  @Prop({ required: true, trim: true, lowercase: true })
  email!: string;

  @Prop({ required: true, trim: true, index: true })
  mobile!: string;

  @Prop({ required: true, trim: true })
  companyName!: string;

  @Prop({ required: true, trim: true })
  ownerName!: string;

  @Prop({
    type: String,
    required: true,
    enum: [
      'pending_payment',
      'active',
      'expired',
      'converted',
      'suspended',
      'data_deleted',
    ],
    default: 'pending_payment',
    index: true,
  })
  status!: TrialStatus;

  @Prop({ required: true, default: 499 })
  basePrice!: number;

  @Prop({ required: true, default: 18 })
  gstPercentage!: number;

  @Prop({ required: true })
  gstAmount!: number;

  @Prop({ required: true })
  totalPayable!: number;

  @Prop({
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending',
    index: true,
  })
  paymentStatus!: 'pending' | 'paid' | 'failed' | 'refunded';

  @Prop()
  paymentLink?: string;

  @Prop()
  paymentId?: string;

  @Prop()
  transactionId?: string;

  @Prop()
  paidAt?: Date;

  @Prop()
  trialStart?: Date;

  @Prop()
  trialEnd?: Date;

  @Prop({ default: false, index: true })
  convertedToPaid!: boolean;

  @Prop()
  convertedAt?: Date;

  @Prop()
  convertedSubscriptionId?: string;

  @Prop()
  cleanupDate?: Date;

  @Prop({ default: false })
  dataDeleted!: boolean;

  @Prop()
  dataDeletedAt?: Date;

  @Prop({ type: SchemaTypes.Mixed })
  metadata?: Record<string, unknown>;
}

export const TrialSubscriptionSchema =
  SchemaFactory.createForClass(TrialSubscription);

TrialSubscriptionSchema.index({ panNumber: 1 }, { unique: true });
TrialSubscriptionSchema.index({ gstNumber: 1 }, { unique: true });
TrialSubscriptionSchema.index({ status: 1, trialEnd: 1 });
TrialSubscriptionSchema.index({ email: 1 });
