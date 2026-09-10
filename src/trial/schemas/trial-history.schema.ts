import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type TrialHistoryDocument = HydratedDocument<TrialHistory>;

@Schema({ timestamps: true, collection: 'trial_histories' })
export class TrialHistory {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Seller',
    required: true,
    index: true,
  })
  sellerId!: Types.ObjectId;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'TrialSubscription',
    required: true,
    index: true,
  })
  trialSubscriptionId!: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  event!: string;

  @Prop({ trim: true })
  message?: string;

  @Prop({ type: SchemaTypes.Mixed })
  payload?: Record<string, unknown>;

  @Prop({ trim: true })
  actorId?: string;

  @Prop({ trim: true })
  actorRole?: string;
}

export const TrialHistorySchema = SchemaFactory.createForClass(TrialHistory);
TrialHistorySchema.index({ sellerId: 1, createdAt: -1 });
