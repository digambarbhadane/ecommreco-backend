import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserPreferencesDocument = UserPreferences & Document;

@Schema({ timestamps: true, collection: 'user_preferences' })
export class UserPreferences {
  @Prop({ required: true, unique: true, index: true })
  userId: string;

  @Prop({ default: 'light' })
  theme: 'light' | 'dark';

  @Prop()
  language?: string;

  @Prop()
  dateFormat?: string;

  @Prop()
  timeFormat?: string;

  @Prop({ default: true })
  notificationEmail: boolean;

  @Prop({ default: false })
  notificationSms: boolean;

  @Prop({ default: true })
  notificationInApp: boolean;

  @Prop({ default: false })
  notificationPush: boolean;

  @Prop({ default: true })
  eventSellerApproved: boolean;

  @Prop({ default: true })
  eventSupportTicketAssigned: boolean;

  @Prop({ default: true })
  eventSystemAlerts: boolean;

  @Prop()
  dashboardLayout?: string;
}

export const UserPreferencesSchema =
  SchemaFactory.createForClass(UserPreferences);
