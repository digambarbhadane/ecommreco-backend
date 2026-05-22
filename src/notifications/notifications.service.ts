import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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

  async markAsRead(id: string, recipientRole?: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid notification id');
    }

    const filter: Record<string, unknown> = { _id: id };
    if (recipientRole) {
      filter.recipientRole = recipientRole;
    }

    const notification = await this.notificationModel.findOne(filter).exec();
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.isRead) {
      return {
        success: true,
        message: 'Notification already marked as read',
      };
    }

    notification.isRead = true;
    await notification.save();

    return {
      success: true,
      message: 'Notification marked as read',
    };
  }

  async markAllAsRead(recipientRole?: string) {
    const filter: Record<string, unknown> = { isRead: false };
    if (recipientRole) {
      filter.recipientRole = recipientRole;
    }

    const result = await this.notificationModel
      .updateMany(filter, { $set: { isRead: true } })
      .exec();

    return {
      success: true,
      message: 'All notifications marked as read',
      updatedCount: result.modifiedCount,
    };
  }
}
