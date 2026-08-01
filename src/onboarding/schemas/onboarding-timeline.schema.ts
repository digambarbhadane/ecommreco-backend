import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type OnboardingTimelineDocument = HydratedDocument<OnboardingTimeline>;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'onboarding_timeline' })
export class OnboardingTimeline {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Lead', index: true })
  leadId?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  @Prop({ required: true, index: true })
  eventType!: string;

  @Prop({ required: true })
  message!: string;

  @Prop({ type: SchemaTypes.Mixed })
  payload?: Record<string, unknown>;

  @Prop()
  actorId?: string;

  @Prop()
  actorRole?: string;
}

export const OnboardingTimelineSchema =
  SchemaFactory.createForClass(OnboardingTimeline);

OnboardingTimelineSchema.index({ leadId: 1, createdAt: -1 });
OnboardingTimelineSchema.index({ userId: 1, createdAt: -1 });
