import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type TrialCleanupLogDocument = HydratedDocument<TrialCleanupLog>;

@Schema({ timestamps: true, collection: 'trial_cleanup_logs' })
export class TrialCleanupLog {
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

  @Prop({ required: true, default: 'trial_data_cleanup' })
  jobType!: string;

  @Prop({
    type: String,
    enum: ['started', 'completed', 'failed'],
    default: 'started',
  })
  status!: 'started' | 'completed' | 'failed';

  @Prop({ type: SchemaTypes.Mixed })
  deletedCounts?: Record<string, number>;

  @Prop()
  errorMessage?: string;

  @Prop()
  completedAt?: Date;
}

export const TrialCleanupLogSchema =
  SchemaFactory.createForClass(TrialCleanupLog);
