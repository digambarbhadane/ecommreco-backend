import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  OnboardingTimeline,
  OnboardingTimelineDocument,
} from '../schemas/onboarding-timeline.schema';

@Injectable()
export class OnboardingTimelineService {
  constructor(
    @InjectModel(OnboardingTimeline.name)
    private readonly timelineModel: Model<OnboardingTimelineDocument>,
  ) {}

  async record(input: {
    leadId?: Types.ObjectId | string;
    userId?: Types.ObjectId | string;
    eventType: string;
    message: string;
    payload?: Record<string, unknown>;
    actorId?: string;
    actorRole?: string;
  }) {
    return this.timelineModel.create({
      leadId: input.leadId
        ? new Types.ObjectId(String(input.leadId))
        : undefined,
      userId: input.userId
        ? new Types.ObjectId(String(input.userId))
        : undefined,
      eventType: input.eventType,
      message: input.message,
      payload: input.payload,
      actorId: input.actorId,
      actorRole: input.actorRole,
    });
  }

  async listForLead(leadId: string, limit = 50) {
    return this.timelineModel
      .find({ leadId: new Types.ObjectId(leadId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }
}
