import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ unique: true, index: true })
  publicId?: string;

  @Prop({ unique: true, sparse: true, index: true })
  username?: string;

  @Prop({ required: true })
  fullName: string;

  @Prop({ required: true, unique: true, index: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true, index: true })
  role: string;

  @Prop()
  companyName?: string;

  @Prop()
  mobile?: string;

  @Prop()
  address?: string;

  @Prop()
  bio?: string;

  @Prop({ default: 'approved' })
  status: 'pending' | 'approved' | 'rejected' | 'blocked';

  @Prop({ default: true })
  profileCompleted: boolean;

  @Prop({ default: false })
  mustChangePassword: boolean;

  @Prop()
  credentialsGeneratedAt?: Date;

  @Prop()
  credentialsGeneratedBy?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
