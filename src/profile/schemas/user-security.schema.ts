import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserSecurityDocument = UserSecurity & Document;

@Schema({ _id: false })
export class UserSession {
  @Prop({ required: true })
  sessionId: string;

  @Prop()
  ipAddress?: string;

  @Prop()
  device?: string;

  @Prop({ required: true })
  createdAt: Date;

  @Prop({ required: true })
  lastSeenAt: Date;
}

const UserSessionSchema = SchemaFactory.createForClass(UserSession);

@Schema({ timestamps: true, collection: 'user_security' })
export class UserSecurity {
  @Prop({ required: true, unique: true, index: true })
  userId: string;

  @Prop()
  passwordHash?: string;

  @Prop({ default: false })
  twoFactorEnabled: boolean;

  @Prop()
  lastPasswordChange?: Date;

  @Prop({ default: 0 })
  tokenVersion: number;

  @Prop({ type: [UserSessionSchema], default: [] })
  activeSessions: UserSession[];
}

export const UserSecuritySchema = SchemaFactory.createForClass(UserSecurity);
