import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserActivityLogDocument = UserActivityLog & Document;

@Schema({ timestamps: false, collection: 'user_activity_logs' })
export class UserActivityLog {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  action: string;

  @Prop()
  ipAddress?: string;

  @Prop()
  device?: string;

  @Prop({ required: true, default: () => new Date() })
  timestamp: Date;
}

export const UserActivityLogSchema =
  SchemaFactory.createForClass(UserActivityLog);
