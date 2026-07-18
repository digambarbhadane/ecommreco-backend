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

  /** Hashed refresh tokens keyed by jti for revocation. */
  @Prop({
    type: [
      {
        _id: false,
        jti: { type: String, required: true },
        sessionId: { type: String, required: true },
        tokenHash: { type: String, required: true },
        expiresAt: { type: Date, required: true },
        createdAt: { type: Date, required: true },
      },
    ],
    default: [],
  })
  refreshTokens?: Array<{
    jti: string;
    sessionId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
  }>;
}

export const UserSecuritySchema = SchemaFactory.createForClass(UserSecurity);
