import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

@Schema({ timestamps: true, collection: 'notifications' })
export class Notification {
  @Prop({ required: true })
  event: string;

  @Prop({ required: true })
  recipientRole: string;

  @Prop({ required: true })
  message: string;

  @Prop({ default: false })
  isRead: boolean;

  @Prop({ index: true })
  userId?: string;

  @Prop()
  userName?: string;

  @Prop({ index: true })
  userEmail?: string;

  @Prop({ index: true })
  userRole?: string;

  @Prop({ index: true })
  sellerId?: string;

  @Prop()
  sellerName?: string;

  @Prop()
  module?: string;

  @Prop()
  ipAddress?: string;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ createdAt: -1 });
NotificationSchema.index({ recipientRole: 1, createdAt: -1 });
NotificationSchema.index({ event: 1, createdAt: -1 });
