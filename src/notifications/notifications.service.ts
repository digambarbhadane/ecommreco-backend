import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  async createNotification(params: {
    event: string;
    recipientRole: string;
    message: string;
  }) {
    return this.notificationModel.create({
      event: params.event,
      recipientRole: params.recipientRole,
      message: params.message,
      isRead: false,
    });
  }

  async listNotifications(params: {
    recipientRole?: string;
    limit?: number;
    skip?: number;
    search?: string;
  }) {
    const limit = Math.max(0, params.limit ?? 20);
    const skip = Math.max(0, params.skip ?? 0);

    const filter: Record<string, unknown> = {};
    if (params.recipientRole) {
      filter.recipientRole = params.recipientRole;
    }
    if (params.search) {
      const pattern = new RegExp(params.search, 'i');
      filter.$or = [{ event: pattern }, { message: pattern }];
    }

    const data = await this.notificationModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();
    const total = await this.notificationModel.countDocuments(filter);

    return {
      success: true,
      data,
      total,
      limit,
      skip,
    };
  }
}
