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

  async findAll(recipientRole: string) {
    return this.notificationModel
      .find({ recipientRole })
      .sort({ createdAt: -1 })
      .limit(20)
      .exec();
  }

  async markAsRead(id: string) {
    return this.notificationModel.findByIdAndUpdate(
      id,
      { isRead: true },
      { new: true },
    );
  }

  async markAllAsRead(recipientRole: string) {
    return this.notificationModel.updateMany(
      { recipientRole, isRead: false },
      { isRead: true },
    );
  }
}
