import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  TrialHistory,
  TrialHistoryDocument,
} from './schemas/trial-history.schema';

@Injectable()
export class TrialHistoryService {
  private readonly logger = new Logger(TrialHistoryService.name);

  constructor(
    @InjectModel(TrialHistory.name)
    private readonly historyModel: Model<TrialHistoryDocument>,
  ) {}

  async record(input: {
    sellerId: string | Types.ObjectId;
    trialSubscriptionId: string | Types.ObjectId;
    event: string;
    message?: string;
    payload?: Record<string, unknown>;
    actorId?: string;
    actorRole?: string;
  }) {
    try {
      await this.historyModel.create({
        sellerId: new Types.ObjectId(String(input.sellerId)),
        trialSubscriptionId: new Types.ObjectId(
          String(input.trialSubscriptionId),
        ),
        event: input.event,
        message: input.message,
        payload: input.payload,
        actorId: input.actorId,
        actorRole: input.actorRole,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record trial history ${input.event}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async listForSeller(sellerId: string) {
    return this.historyModel
      .find({ sellerId: new Types.ObjectId(sellerId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }
}
