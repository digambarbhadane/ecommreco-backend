import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SubscriptionDocument = HydratedDocument<Subscription>;

@Schema({ timestamps: true, collection: 'subscriptions' })
export class Subscription {
  @Prop({ required: true, index: true })
  leadId: string;

  @Prop()
  sellerId?: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'SubscriptionPackage' })
  packageId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  selectedPrice: number;

  @Prop({ required: true, min: 0 })
  gstAmount: number;

  @Prop({ required: true, min: 0 })
  totalAmount: number;

  @Prop({ required: true, min: 1 })
  duration: number;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({
    required: true,
    enum: ['pending', 'paid', 'failed'],
    default: 'pending',
    index: true,
  })
  paymentStatus: 'pending' | 'paid' | 'failed';

  @Prop()
  paymentLink?: string;

  @Prop()
  createdBy?: string;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

SubscriptionSchema.index({ leadId: 1, createdAt: -1 });
